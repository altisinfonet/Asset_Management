'use client';

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  ScanLine,
  UserRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { useScanTarget } from '@/components/scan/scan-provider';
import { Button, IconButton } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import { createKeyKeeper, dateAfter, isoDate } from '@/lib/custody/helpers';
import { uiErrorText } from '@/lib/error-text';
import { loanersApi, type ProblemBody } from '@/lib/loaners/api';
import {
  defaultDueDate,
  itemFailure,
  lateDays,
  latestDueDate,
  pickBorrower,
  requestFailure,
} from '@/lib/loaners/helpers';
import { usePools, useRefreshAfterLoan } from '@/lib/loaners/queries';
import { peopleApi } from '@/lib/registry/api';
import type { Person } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import { beep } from '@/lib/scan/beep';
import { resolveScan } from '@/lib/scan/resolve';

type Mode = 'lend' | 'return';

/** A device waiting to be lent: what is sent (`code`), what is shown (`tag`), and why it was refused. */
interface Queued {
  code: string;
  tag: string;
  problem?: string;
}

interface Feedback {
  kind: 'ok' | 'error';
  message: string;
  /** A device that is out can be returned from the message (lend mode). */
  returnCode?: string;
}

interface LogEntry {
  id: number;
  ok: boolean;
  message: string;
}

const LOG_LIMIT = 40;
const POOL_KEY = 'at-loaner-desk-pool';

const readPool = () => {
  try {
    return window.localStorage.getItem(POOL_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * The loaner desk (WEB-16 quick check-out and bulk check-in, M2-LOAN-02): one screen for the counter.
 * Lend: pick the pool, scan the devices, scan or find the borrower, the pool's due date is filled in,
 * Enter lends them all in one request (each device answered on its own: one that is not in the pool or
 * already out stays in the list with its problem while the others go). Return: every scan returns the
 * device at once. A USB keyboard-wedge scanner works from anywhere on the page (the scan provider hands
 * it the scans), the fields accept typing, targets are large, and every result is shown in words and an
 * icon, with an optional sound.
 */
export function DeskScreen() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const refresh = useRefreshAfterLoan();
  const mode: Mode = params.get('mode') === 'return' ? 'return' : 'lend';
  const canReturn = can('loaner:checkout');

  const pools = usePools();
  const activePools = useMemo(
    () => (pools.data ?? []).filter((candidate) => candidate.is_active !== false),
    [pools.data],
  );
  const [chosenPool, setChosenPool] = useState('');
  const pool =
    activePools.find((candidate) => candidate.id === (chosenPool || readPool())) ??
    activePools[0] ??
    null;

  const [queue, setQueue] = useState<Queued[]>([]);
  const [borrower, setBorrower] = useState<Person | null>(null);
  const [candidates, setCandidates] = useState<Person[] | null>(null);
  const [deviceText, setDeviceText] = useState('');
  const [borrowerText, setBorrowerText] = useState('');
  const [due, setDue] = useState('');
  const [dueTouched, setDueTouched] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(true);
  const [dueError, setDueError] = useState('');

  const deviceInput = useRef<HTMLInputElement>(null);
  const borrowerInput = useRef<HTMLInputElement>(null);
  const lendButton = useRef<HTMLButtonElement>(null);
  const returnInput = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const keys = useRef(createKeyKeeper());
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  });

  const latest = latestDueDate(pool);
  // until the effect below has filled the field, the pool's own default is the date
  const dueValue = due || defaultDueDate(pool);
  const today = isoDate(new Date());

  // The due date follows the pool until the person picks one themselves.
  useEffect(() => {
    if (dueTouched) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived default, replaced once the user edits it
    setDue(defaultDueDate(pool));
  }, [pool, dueTouched]);

  const remember = useCallback((ok: boolean, message: string) => {
    counter.current += 1;
    setLog((current) => [{ id: counter.current, ok, message }, ...current].slice(0, LOG_LIMIT));
  }, []);

  const announce = useCallback(
    (next: Feedback) => {
      setFeedback(next);
      remember(next.kind === 'ok', next.message);
      if (soundRef.current) beep(next.kind === 'ok' ? 'ok' : 'error');
    },
    [remember],
  );

  /** The words for what stopped one device (its own problem). */
  const itemText = useCallback(
    (code: string, status: number, error: ProblemBody | undefined, name?: string) => {
      switch (itemFailure(error, status)) {
        case 'not_found':
          return t('loanerDesk.errors.notFound', { code });
        case 'ambiguous':
          return t('loanerDesk.errors.ambiguous', { code });
        case 'not_in_pool':
          return t('loanerDesk.errors.notInPool', { code });
        case 'already_out':
          return t('loanerDesk.errors.alreadyOut', { code });
        case 'not_deployable':
          return t('loanerDesk.errors.notDeployable', { code });
        case 'limit':
          return t('loanerDesk.errors.limit', { code, name: name ?? '' });
        case 'not_checked_out':
          return t('loanerDesk.errors.notCheckedOut', { code });
        default:
          return error?.detail ?? t('loanerDesk.errors.itemGeneric', { code });
      }
    },
    [t],
  );

  // ---- lend ---------------------------------------------------------------------------------------

  /** Adds a device to the list: it has to exist; whether it is in the pool is the server's to say. */
  const addDevice = useCallback(
    async (raw: string, options: { quiet?: boolean } = {}): Promise<boolean> => {
      const code = raw.trim();
      if (!code) return false;
      setBusy(true);
      try {
        const outcome = await resolveScan(code);
        if (outcome.kind !== 'found') {
          if (!options.quiet) {
            announce({
              kind: 'error',
              message:
                outcome.kind === 'ambiguous'
                  ? t('loanerDesk.errors.ambiguous', { code })
                  : t('loanerDesk.errors.notFound', { code }),
            });
          }
          return false;
        }
        const tag = outcome.asset.asset_tag;
        setQueue((current) =>
          current.some((entry) => entry.code === tag) ? current : [...current, { code: tag, tag }],
        );
        setFeedback(null);
        keys.current.renew();
        return true;
      } catch (err) {
        announce({ kind: 'error', message: uiErrorText(t, getApi().toUiError(err)) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [announce, t],
  );

  const chooseBorrower = useCallback((person: Person) => {
    setBorrower(person);
    setCandidates(null);
    setBorrowerText('');
    setFeedback(null);
  }, []);

  /** Finds a borrower by name, email or number; a single or exact match is chosen straight away. */
  const lookupBorrower = useCallback(
    async (raw: string): Promise<boolean> => {
      const query = raw.trim();
      if (!query) return false;
      setBusy(true);
      try {
        const page = await peopleApi.list({ q: query, limit: 6, status: 'active' });
        const found = pickBorrower(page.data, query);
        if (found) {
          chooseBorrower(found);
          return true;
        }
        if (page.data.length === 0) {
          setCandidates([]);
          announce({ kind: 'error', message: t('loanerDesk.borrower.noMatch', { query }) });
          return false;
        }
        setCandidates(page.data);
        return true;
      } catch (err) {
        announce({ kind: 'error', message: uiErrorText(t, getApi().toUiError(err)) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [announce, chooseBorrower, t],
  );

  const validDue = (): string | null => {
    if (!dueValue) return t('loanerDesk.due.required');
    if (dueValue < today) return t('loanerDesk.due.past');
    if (latest && dueValue > latest) {
      return t('loanerDesk.due.tooLate', {
        date: formatDate(`${latest}T00:00:00Z`, { timeZone: 'UTC' }),
      });
    }
    return null;
  };

  const lend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!pool) {
      announce({ kind: 'error', message: t('loanerDesk.errors.noPool') });
      return;
    }
    if (queue.length === 0) {
      announce({ kind: 'error', message: t('loanerDesk.errors.noCodes') });
      deviceInput.current?.focus();
      return;
    }
    if (!borrower) {
      announce({ kind: 'error', message: t('loanerDesk.errors.noPerson') });
      borrowerInput.current?.focus();
      return;
    }
    const problem = validDue();
    setDueError(problem ?? '');
    if (problem) return;
    const body = {
      person_id: borrower.id,
      codes: queue.map((entry) => entry.code),
      expected_return: dueValue,
    };
    setBusy(true);
    try {
      const result = await loanersApi.quickCheckout(pool.id, body, keys.current.keyFor(body));
      keys.current.renew();
      const name = result.person.display_name;
      const date = formatDate(`${result.expected_return}T00:00:00Z`, { timeZone: 'UTC' });
      const failed = new Map<string, string>();
      let returnCode: string | undefined;
      for (const item of result.results) {
        if (item.status === 201) continue;
        failed.set(item.code, itemText(item.code, item.status, item.error, name));
        if (itemFailure(item.error, item.status) === 'already_out' && canReturn) {
          returnCode = item.code;
        }
      }
      const lent = result.results.filter((item) => item.status === 201);
      for (const message of failed.values()) remember(false, message);
      // what went through leaves the list; what did not stays with its problem
      setQueue((current) =>
        current
          .filter((entry) => failed.has(entry.code))
          .map((entry) => ({ ...entry, problem: failed.get(entry.code) })),
      );
      if (failed.size === 0) {
        announce({
          kind: 'ok',
          message:
            lent.length === 1
              ? t('loanerDesk.result.lentOne', {
                  tag: lent[0]!.data?.asset.asset_tag ?? lent[0]!.code,
                  name,
                  date,
                })
              : t('loanerDesk.result.lentMany', { count: lent.length, name, date }),
        });
      } else {
        announce({
          kind: 'error',
          message:
            lent.length === 0
              ? t('loanerDesk.result.noneLent')
              : t('loanerDesk.result.someFailed', {
                  ok: lent.length,
                  total: result.results.length,
                  name,
                  failed: failed.size,
                }),
          returnCode,
        });
      }
      if (!dueTouched) setDue(defaultDueDate(pool));
      await refresh();
      deviceInput.current?.focus();
    } catch (err) {
      const ui = getApi().toUiError(err);
      const name = borrower.display_name;
      const message = (() => {
        switch (requestFailure(ui)) {
          case 'pool_inactive':
            return t('loanerDesk.errors.poolInactive');
          case 'not_eligible':
            return t('loanerDesk.errors.notEligible', { name });
          case 'borrower_inactive':
            return t('loanerDesk.errors.borrowerInactive', { name });
          case 'borrower_not_found':
            return t('loanerDesk.errors.borrowerNotFound');
          case 'borrower_ambiguous':
            return t('loanerDesk.errors.borrowerAmbiguous');
          case 'no_device':
            return t('loanerDesk.errors.noDevice');
          default:
            return uiErrorText(t, ui);
        }
      })();
      announce({ kind: 'error', message });
    } finally {
      setBusy(false);
    }
  };

  // ---- return -------------------------------------------------------------------------------------

  const returnDevice = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setBusy(true);
      try {
        const body = { codes: [code] };
        const result = await loanersApi.returnLoans(body, createKeyKeeper().keyFor(body));
        const item = result.results[0]!;
        if (item.status !== 200) {
          announce({ kind: 'error', message: itemText(code, item.status, item.error) });
          return;
        }
        const tag = item.data?.asset.asset_tag ?? code;
        const days = lateDays(item.data?.assignment.expected_return);
        announce({
          kind: 'ok',
          message:
            days > 0
              ? t('loanerDesk.result.returnedLate', {
                  tag,
                  days: t('loanerDesk.result.daysLate', { count: days }),
                })
              : t('loanerDesk.result.returned', { tag }),
        });
        await refresh();
      } catch (err) {
        announce({ kind: 'error', message: uiErrorText(t, getApi().toUiError(err)) });
      } finally {
        setBusy(false);
      }
    },
    [announce, itemText, refresh, t],
  );

  // ---- scans from a wedge scanner (anywhere on the page) --------------------------------------------

  const onScan = useCallback(
    async (code: string) => {
      if (mode === 'return') {
        await returnDevice(code);
        returnInput.current?.focus();
        return;
      }
      // a code is a device first; what no device matches may be the borrower's card
      if (await addDevice(code, { quiet: true })) return;
      if (!(await lookupBorrower(code))) {
        announce({ kind: 'error', message: t('loanerDesk.errors.notFound', { code }) });
      }
    },
    [mode, returnDevice, addDevice, lookupBorrower, announce, t],
  );
  useScanTarget(onScan);

  // ---- focus: the next field the flow needs ----------------------------------------------------------

  const hasQueue = queue.length > 0;
  // with devices waiting, a chosen borrower makes the next key the confirmation
  useEffect(() => {
    if (borrower && hasQueue) lendButton.current?.focus();
    // only choosing (or changing) the borrower moves focus, not scanning another device
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrower]);
  useEffect(() => {
    (mode === 'return' ? returnInput : deviceInput).current?.focus();
  }, [mode]);

  const setMode = (next: Mode) => router.replace(routes.loanerDesk(next));

  const okCount = log.filter((entry) => entry.ok).length;
  const problemCount = log.length - okCount;
  const dueDefault = defaultDueDate(pool);
  const ready = !hasQueue
    ? t('loanerDesk.ready.device')
    : !borrower
      ? t('loanerDesk.ready.borrower')
      : t('loanerDesk.ready.confirm');

  return (
    <>
      <PageTitle title={t('loanerDesk.title')} />
      <PageHeader
        title={t('loanerDesk.title')}
        description={t('loanerDesk.description')}
        actions={
          <Button asChild>
            <Link href={routes.loaners}>
              <ArrowLeft aria-hidden className="size-4" />
              {t('loanerDesk.back')}
            </Link>
          </Button>
        }
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div role="group" aria-label={t('loanerDesk.modeLabel')} className="grid grid-cols-2 gap-2">
          {(['lend', 'return'] as const).map((option) => (
            <Button
              key={option}
              variant={mode === option ? 'primary' : 'secondary'}
              aria-pressed={mode === option}
              disabled={option === 'return' && !canReturn}
              className="min-h-14 text-lg"
              onClick={() => setMode(option)}
            >
              {option === 'lend' ? (
                <ArrowUpRight aria-hidden className="size-5" />
              ) : (
                <ArrowDownLeft aria-hidden className="size-5" />
              )}
              {t(`loanerDesk.modes.${option}`)}
            </Button>
          ))}
        </div>

        <FeedbackPanel
          feedback={feedback}
          idle={mode === 'return' ? t('loanerDesk.ready.device') : ready}
          onReturn={(code) => void returnDevice(code)}
          returnLabel={t('loanerDesk.returnInstead')}
        />

        {mode === 'lend' ? (
          <form
            onSubmit={(event) => void lend(event)}
            noValidate
            aria-label={t('loanerDesk.modes.lend')}
            className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4 sm:p-6"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="desk-pool" className="text-base font-medium text-text">
                {t('loanerDesk.pool.label')}
              </label>
              {activePools.length === 0 && !pools.isPending ? (
                <p className="text-base text-muted">{t('loanerDesk.pool.none')}</p>
              ) : (
                <Select
                  id="desk-pool"
                  value={pool?.id ?? ''}
                  placeholder={t('loanerDesk.pool.label')}
                  options={activePools.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                  }))}
                  onValueChange={(id) => {
                    setChosenPool(id);
                    setDueTouched(false);
                    try {
                      window.localStorage.setItem(POOL_KEY, id);
                    } catch {
                      // storage unavailable: the choice lasts for this visit
                    }
                  }}
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="desk-device" className="text-base font-medium text-text">
                {t('loanerDesk.device.label')}
              </label>
              <div className="flex gap-2">
                <Input
                  id="desk-device"
                  ref={deviceInput}
                  value={deviceText}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={t('loanerDesk.device.placeholder')}
                  aria-describedby="desk-device-hint"
                  className="min-h-12 flex-1 font-tag text-lg"
                  onChange={(event) => setDeviceText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    // a code is a device first, else the borrower's card; Enter on an empty field lends the list
                    if (deviceText.trim()) {
                      const code = deviceText;
                      setDeviceText('');
                      void onScan(code);
                    } else void lend();
                  }}
                />
                <Button
                  type="button"
                  className="min-h-12"
                  disabled={busy || !deviceText.trim()}
                  onClick={() => {
                    const code = deviceText;
                    setDeviceText('');
                    void onScan(code);
                  }}
                >
                  <ScanLine aria-hidden className="size-4" />
                  {t('loanerDesk.device.find')}
                </Button>
              </div>
              <p id="desk-device-hint" className="text-sm text-muted">
                {t('loanerDesk.device.hint')}
              </p>
              {hasQueue ? (
                <ul
                  aria-label={t('loanerDesk.queue.label')}
                  className="mt-1 flex flex-col overflow-hidden rounded-md border border-border-strong"
                  data-testid="desk-queue"
                >
                  {queue.map((entry) => (
                    <li
                      key={entry.code}
                      className="flex items-center gap-2 border-t border-border bg-sunken px-3 py-2 first:border-t-0"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-tag text-base font-semibold text-text">
                          {entry.tag}
                        </span>
                        {entry.problem ? (
                          <span className="flex items-start gap-1.5 text-sm text-danger-text">
                            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                            <span>
                              <span className="sr-only">{`${t('loanerDesk.queue.problem')}: `}</span>
                              {entry.problem}
                            </span>
                          </span>
                        ) : null}
                      </span>
                      <IconButton
                        icon={X}
                        size="icon-sm"
                        label={t('loanerDesk.queue.remove', { tag: entry.tag })}
                        onClick={() => {
                          setQueue((current) =>
                            current.filter((other) => other.code !== entry.code),
                          );
                          deviceInput.current?.focus();
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="desk-borrower" className="text-base font-medium text-text">
                {t('loanerDesk.borrower.label')}
              </label>
              {borrower ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-strong bg-sunken p-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <UserRound aria-hidden className="size-5 shrink-0 text-muted" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-lg font-semibold text-text">
                        {borrower.display_name}
                      </span>
                      <span className="truncate text-sm text-muted">
                        {[borrower.email, borrower.employee_ref].filter(Boolean).join(' - ')}
                      </span>
                    </span>
                  </span>
                  <Button
                    type="button"
                    onClick={() => {
                      setBorrower(null);
                      requestAnimationFrame(() => borrowerInput.current?.focus());
                    }}
                  >
                    <X aria-hidden className="size-4" />
                    {t('loanerDesk.borrower.change')}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="desk-borrower"
                    ref={borrowerInput}
                    value={borrowerText}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('loanerDesk.borrower.placeholder')}
                    className="min-h-12 flex-1 text-lg"
                    onChange={(event) => {
                      setBorrowerText(event.target.value);
                      setCandidates(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void lookupBorrower(borrowerText);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    className="min-h-12"
                    disabled={busy || !borrowerText.trim()}
                    onClick={() => void lookupBorrower(borrowerText)}
                  >
                    {t('loanerDesk.borrower.find')}
                  </Button>
                </div>
              )}
              {candidates && candidates.length > 0 ? (
                <ul
                  aria-label={t('loanerDesk.borrower.matches')}
                  className="mt-1 flex flex-col overflow-hidden rounded-md border border-border-strong"
                >
                  {candidates.map((person) => (
                    <li key={person.id} className="border-t border-border first:border-t-0">
                      <button
                        type="button"
                        aria-label={t('loanerDesk.borrower.choose', { name: person.display_name })}
                        className="flex min-h-14 w-full flex-col items-start justify-center px-3 py-2 text-left hover:bg-sunken"
                        onClick={() => chooseBorrower(person)}
                      >
                        <span className="text-base font-medium text-text">
                          {person.display_name}
                        </span>
                        <span className="text-sm text-muted">
                          {[person.email, person.employee_ref, person.department]
                            .filter(Boolean)
                            .join(' - ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="desk-due" className="text-base font-medium text-text">
                {t('loanerDesk.due.label')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="desk-due"
                  type="date"
                  value={dueValue}
                  min={today}
                  max={latest ?? undefined}
                  invalid={!!dueError}
                  aria-describedby="desk-due-hint"
                  className="min-h-12 w-auto text-lg"
                  onChange={(event) => {
                    setDue(event.target.value);
                    setDueTouched(true);
                    setDueError('');
                  }}
                />
                {[
                  { key: 'tomorrow', value: dateAfter({ days: 1 }) },
                  { key: 'week', value: dateAfter({ days: 7 }) },
                  { key: 'default', value: dueDefault },
                ]
                  .filter((preset) => !latest || preset.value <= latest)
                  .map((preset) => (
                    <Button
                      key={preset.key}
                      type="button"
                      className="min-h-12"
                      aria-pressed={dueValue === preset.value}
                      variant={dueValue === preset.value ? 'primary' : 'secondary'}
                      onClick={() => {
                        setDue(preset.value);
                        setDueTouched(true);
                        setDueError('');
                      }}
                    >
                      {t(`loanerDesk.presets.${preset.key as 'tomorrow' | 'week' | 'default'}`)}
                    </Button>
                  ))}
              </div>
              <p id="desk-due-hint" className="text-sm text-muted">
                {pool
                  ? t('loanerDesk.due.poolDefault', { days: pool.default_loan_days ?? 7 })
                  : null}
                {latest
                  ? ` ${t('loanerDesk.due.latest', {
                      date: formatDate(`${latest}T00:00:00Z`, { timeZone: 'UTC' }),
                    })}`
                  : null}
              </p>
              {dueError ? (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {dueError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              {hasQueue && borrower && !validDue() ? (
                <p className="text-base text-text" data-testid="desk-summary">
                  {t('loanerDesk.summary', {
                    count: queue.length,
                    name: borrower.display_name,
                    date: formatDate(`${dueValue}T00:00:00Z`, { timeZone: 'UTC' }),
                  })}
                </p>
              ) : null}
              <Button
                ref={lendButton}
                type="submit"
                variant="primary"
                loading={busy}
                disabled={!hasQueue || !borrower || !pool}
                className="min-h-14 text-lg"
              >
                {hasQueue
                  ? t('loanerDesk.lendCount', { count: queue.length })
                  : t('loanerDesk.lendNone')}
              </Button>
              <p className="text-sm text-muted">{t('loanerDesk.lendHint')}</p>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const code = deviceText;
              setDeviceText('');
              void returnDevice(code);
            }}
            noValidate
            aria-labelledby="desk-return-heading"
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:p-6"
          >
            <div>
              <h2 id="desk-return-heading" className="text-lg font-semibold text-text">
                {t('loanerDesk.returnMode.heading')}
              </h2>
              <p className="text-base text-muted">{t('loanerDesk.returnMode.description')}</p>
            </div>
            <label htmlFor="desk-return" className="text-base font-medium text-text">
              {t('loanerDesk.returnMode.label')}
            </label>
            <div className="flex gap-2">
              <Input
                id="desk-return"
                ref={returnInput}
                value={deviceText}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder={t('loanerDesk.returnMode.placeholder')}
                className="min-h-12 flex-1 font-tag text-lg"
                onChange={(event) => setDeviceText(event.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                className="min-h-12"
                loading={busy}
                disabled={!deviceText.trim()}
              >
                {t('loanerDesk.returnMode.submit')}
              </Button>
            </div>
            <p className="text-base font-medium text-text" data-testid="desk-return-summary">
              {t('loanerDesk.returnMode.summary', { count: okCount })}
              {problemCount > 0
                ? `, ${t('loanerDesk.returnMode.problems', { count: problemCount })}`
                : ''}
            </p>
          </form>
        )}

        <div className="flex flex-col gap-2">
          <Checkbox
            label={t('loanerDesk.sound')}
            checked={sound}
            onCheckedChange={(v) => setSound(v === true)}
          />
          <p className="text-sm text-muted">{t('loanerDesk.scannerHint')}</p>
        </div>

        <section aria-labelledby="desk-log" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="desk-log" className="text-lg font-semibold text-text">
              {t('loanerDesk.log.heading')}
            </h2>
            {log.length > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setLog([])}>
                {t('loanerDesk.log.clear')}
              </Button>
            ) : null}
          </div>
          {log.length === 0 ? (
            <p className="text-base text-muted">{t('loanerDesk.log.empty')}</p>
          ) : (
            <ol
              className="flex flex-col rounded-lg border border-border bg-surface"
              data-testid="desk-log"
            >
              {log.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-2 border-t border-border px-3 py-2 first:border-t-0"
                >
                  {entry.ok ? (
                    <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-text" />
                  ) : (
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />
                  )}
                  <span className="text-base text-text">
                    <span className="sr-only">
                      {entry.ok ? t('loanerDesk.log.ok') : t('loanerDesk.log.problem')}
                      {': '}
                    </span>
                    {entry.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * What just happened, large and in words: a success or a problem (never colour alone). The region is
 * always present so a screen reader announces each change; a problem is an alert.
 */
function FeedbackPanel({
  feedback,
  idle,
  onReturn,
  returnLabel,
}: {
  feedback: Feedback | null;
  idle: string;
  onReturn: (code: string) => void;
  returnLabel: string;
}) {
  const ok = feedback?.kind === 'ok';
  const error = feedback?.kind === 'error';
  const Icon = ok ? CircleCheck : error ? CircleAlert : ScanLine;
  return (
    <div
      role={error ? 'alert' : 'status'}
      data-testid="desk-feedback"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border p-4 text-lg',
        ok && 'border-success bg-success-subtle text-success-text',
        error && 'border-danger bg-danger-subtle text-danger-text',
        !feedback && 'border-border bg-sunken text-muted',
      )}
    >
      <Icon aria-hidden className="size-7 shrink-0" />
      <span className="min-w-0 flex-1 font-medium">{feedback?.message ?? idle}</span>
      {feedback?.returnCode ? (
        <Button type="button" onClick={() => onReturn(feedback.returnCode!)}>
          {returnLabel}
        </Button>
      ) : null}
    </div>
  );
}
