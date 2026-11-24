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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { cn } from '@/lib/cn';
import { createKeyKeeper, dateAfter, isoDate } from '@/lib/custody/helpers';
import { loanersApi } from '@/lib/loaners/api';
import {
  defaultDueDate,
  latestDueDate,
  loanFailure,
  lendVerdict,
  pickBorrower,
  returnVerdict,
  type LendVerdict,
} from '@/lib/loaners/helpers';
import { useLoanSettings, usePools, useRefreshAfterLoan } from '@/lib/loaners/queries';
import { uiErrorText } from '@/lib/error-text';
import { custodyApi, peopleApi } from '@/lib/registry/api';
import type { Asset, Person } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import { beep } from '@/lib/scan/beep';
import { resolveScan } from '@/lib/scan/resolve';

type Mode = 'lend' | 'return';

interface Device {
  asset: Asset;
  poolId: string;
}

interface Feedback {
  kind: 'ok' | 'error';
  message: string;
  /** A device that is on loan can be returned from the message (lend mode). */
  returnTag?: string;
}

interface LogEntry {
  id: number;
  ok: boolean;
  message: string;
}

const LOG_LIMIT = 40;

/**
 * The loaner desk (WEB-16 quick check-out and bulk check-in, M2-LOAN-02): one screen for the counter.
 * Lend: scan the device, scan or find the borrower, the pool's due date is filled in, Enter lends;
 * the borrower stays for the next device. Return: every scan returns the device at once. A USB
 * keyboard-wedge scanner works from anywhere on the page (the scan provider hands it the scans), the
 * fields accept typing, targets are large, and every result is shown in words and an icon, with an
 * optional sound.
 */
export function DeskScreen() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const refresh = useRefreshAfterLoan();
  const mode: Mode = params.get('mode') === 'return' ? 'return' : 'lend';
  const canReturn = can('asset:checkin');

  const pools = usePools();
  const settings = useLoanSettings();
  const loan = settings.data?.value ?? null;

  const [device, setDevice] = useState<Device | null>(null);
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

  const pool = useMemo(
    () => pools.data?.find((candidate) => candidate.id === device?.poolId) ?? null,
    [pools.data, device],
  );
  const latest = latestDueDate(pool, loan);
  const today = isoDate(new Date());

  // The due date follows the pool of the scanned device until the person picks one themselves.
  useEffect(() => {
    if (dueTouched) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived default, replaced once the user edits it
    setDue(defaultDueDate(pool, loan));
  }, [pool, loan, dueTouched]);

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

  const failureText = useCallback(
    (error: UiError, tag: string, name?: string | null) => {
      switch (loanFailure(error)) {
        case 'no_device':
          return t('loanerDesk.errors.noDevice');
        case 'limit':
          return name
            ? t('loanerDesk.errors.limit', { name })
            : t('loanerDesk.errors.limitAnonymous');
        case 'already_out':
          return t('loanerDesk.errors.onLoanAnonymous', { tag });
        case 'not_deployable':
          return t('loanerDesk.errors.unavailableNoStatus', { tag });
        case 'inactive_person':
          return t('loanerDesk.errors.inactivePerson', { name: name ?? '' });
        default:
          return uiErrorText(t, error);
      }
    },
    [t],
  );

  const verdictText = useCallback(
    (verdict: Exclude<LendVerdict, { kind: 'ok' }>, tag: string) => {
      switch (verdict.kind) {
        case 'not_in_pool':
          return t('loanerDesk.errors.notInPool', { tag });
        case 'on_loan':
          return verdict.holder && verdict.due
            ? t('loanerDesk.errors.onLoan', {
                tag,
                name: verdict.holder,
                date: formatDate(`${verdict.due}T00:00:00Z`, { timeZone: 'UTC' }),
              })
            : t('loanerDesk.errors.onLoanAnonymous', { tag });
        case 'unavailable':
          return verdict.status
            ? t('loanerDesk.errors.unavailable', { tag, status: verdict.status })
            : t('loanerDesk.errors.unavailableNoStatus', { tag });
      }
    },
    [t, formatDate],
  );

  // ---- lend ---------------------------------------------------------------------------------------

  /** Resolves a typed or scanned tag; returns whether it was a device (so a scan can fall back to a person). */
  const lookupDevice = useCallback(
    async (raw: string, options: { quiet?: boolean } = {}): Promise<boolean> => {
      const code = raw.trim();
      if (!code) return false;
      setBusy(true);
      try {
        const outcome = await resolveScan(code);
        if (outcome.kind !== 'found') {
          if (options.quiet) return false;
          announce({
            kind: 'error',
            message:
              outcome.kind === 'ambiguous'
                ? t('loanerDesk.errors.ambiguous', { code })
                : t('loanerDesk.errors.notFound', { code }),
          });
          return false;
        }
        const { asset } = outcome;
        const verdict = lendVerdict(asset, outcome.allowed.includes('checkout'));
        if (verdict.kind !== 'ok') {
          setDevice(null);
          setDeviceText('');
          announce({
            kind: 'error',
            message: verdictText(verdict, asset.asset_tag),
            returnTag: verdict.kind === 'on_loan' && canReturn ? asset.asset_tag : undefined,
          });
          deviceInput.current?.focus();
          return true;
        }
        setDevice({ asset, poolId: verdict.poolId });
        setDeviceText('');
        setFeedback(null);
        setDueError('');
        keys.current.renew();
        return true;
      } catch (err) {
        announce({ kind: 'error', message: uiErrorText(t, getApi().toUiError(err)) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [announce, canReturn, t, verdictText],
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
    if (!due) return t('loanerDesk.due.required');
    if (due < today) return t('loanerDesk.due.past');
    if (latest && due > latest) {
      return t('loanerDesk.due.tooLate', {
        date: formatDate(`${latest}T00:00:00Z`, { timeZone: 'UTC' }),
      });
    }
    return null;
  };

  const lend = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    if (!device) {
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
    const tag = device.asset.asset_tag;
    const body = { person_id: borrower.id, asset_id: device.asset.id, expected_return: due };
    setBusy(true);
    try {
      await loanersApi.checkout(device.poolId, body, keys.current.keyFor(body));
      keys.current.renew();
      announce({
        kind: 'ok',
        message: t('loanerDesk.result.lent', {
          tag,
          name: borrower.display_name,
          date: formatDate(`${due}T00:00:00Z`, { timeZone: 'UTC' }),
        }),
      });
      setDevice(null);
      if (!dueTouched) setDue(defaultDueDate(null, loan));
      await refresh();
      deviceInput.current?.focus();
    } catch (err) {
      const ui = getApi().toUiError(err);
      announce({ kind: 'error', message: failureText(ui, tag, borrower.display_name) });
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
        const outcome = await resolveScan(code);
        if (outcome.kind !== 'found') {
          announce({
            kind: 'error',
            message:
              outcome.kind === 'ambiguous'
                ? t('loanerDesk.errors.ambiguous', { code })
                : t('loanerDesk.errors.notFound', { code }),
          });
          return;
        }
        const { asset } = outcome;
        const tag = asset.asset_tag;
        const verdict = returnVerdict(asset);
        if (verdict.kind === 'not_in_pool') {
          announce({ kind: 'error', message: t('loanerDesk.errors.notInPool', { tag }) });
          return;
        }
        if (verdict.kind === 'not_on_loan') {
          announce({ kind: 'error', message: t('loanerDesk.errors.notOnLoan', { tag }) });
          return;
        }
        const key = createKeyKeeper().keyFor({ asset: asset.id, checkin: true });
        await custodyApi.checkin(asset.id, {}, { idempotencyKey: key });
        const late = t('loanerDesk.result.daysLate', { count: verdict.overdueDays });
        announce({
          kind: 'ok',
          message:
            verdict.overdueDays > 0
              ? verdict.holder
                ? t('loanerDesk.result.returnedLate', { tag, name: verdict.holder, days: late })
                : t('loanerDesk.result.returnedLateAnonymous', { tag, days: late })
              : verdict.holder
                ? t('loanerDesk.result.returnedFrom', { tag, name: verdict.holder })
                : t('loanerDesk.result.returned', { tag }),
        });
        await refresh();
      } catch (err) {
        announce({ kind: 'error', message: uiErrorText(t, getApi().toUiError(err)) });
      } finally {
        setBusy(false);
      }
    },
    [announce, refresh, t],
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
      const wasDevice = await lookupDevice(code, { quiet: true });
      if (wasDevice) return;
      const wasBorrower = await lookupBorrower(code);
      if (!wasBorrower) {
        announce({ kind: 'error', message: t('loanerDesk.errors.notFound', { code }) });
      }
    },
    [mode, returnDevice, lookupDevice, lookupBorrower, announce, t],
  );
  useScanTarget(onScan);

  // ---- focus: the next field the flow needs ----------------------------------------------------------

  useEffect(() => {
    if (mode !== 'lend') return;
    if (device && borrower) lendButton.current?.focus();
    else if (device && !borrower) borrowerInput.current?.focus();
  }, [device, borrower, mode]);

  useEffect(() => {
    (mode === 'return' ? returnInput : deviceInput).current?.focus();
  }, [mode]);

  const setMode = (next: Mode) => router.replace(routes.loanerDesk(next));

  const okCount = log.filter((entry) => entry.ok).length;
  const problemCount = log.length - okCount;
  const dueDefault = defaultDueDate(pool, loan);

  const ready = !device
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
          onReturn={(tag) => void returnDevice(tag)}
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
              <label htmlFor="desk-device" className="text-base font-medium text-text">
                {t('loanerDesk.device.label')}
              </label>
              {device ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-strong bg-sunken p-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-tag text-lg font-semibold text-text">
                      {device.asset.asset_tag}
                    </span>
                    <span className="text-sm text-muted">
                      {[
                        device.asset.name,
                        pool ? t('loanerDesk.device.inPool', { pool: pool.name }) : null,
                      ]
                        .filter(Boolean)
                        .join(' - ')}
                    </span>
                  </span>
                  <Button
                    type="button"
                    onClick={() => {
                      setDevice(null);
                      deviceInput.current?.focus();
                    }}
                  >
                    <X aria-hidden className="size-4" />
                    {t('loanerDesk.device.change')}
                  </Button>
                </div>
              ) : null}
              <div className={cn('flex gap-2', device && 'sr-only')}>
                <Input
                  id="desk-device"
                  ref={deviceInput}
                  value={deviceText}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder={t('loanerDesk.device.placeholder')}
                  className="min-h-12 flex-1 font-tag text-lg"
                  tabIndex={device ? -1 : undefined}
                  onChange={(event) => setDeviceText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void lookupDevice(deviceText);
                    }
                  }}
                />
                <Button
                  type="button"
                  className="min-h-12"
                  disabled={busy || !deviceText.trim()}
                  onClick={() => void lookupDevice(deviceText)}
                >
                  <ScanLine aria-hidden className="size-4" />
                  {t('loanerDesk.device.find')}
                </Button>
              </div>
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
                  value={due}
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
                      aria-pressed={due === preset.value}
                      variant={due === preset.value ? 'primary' : 'secondary'}
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
              {device && borrower && !validDue() ? (
                <p className="text-base text-text" data-testid="desk-summary">
                  {t('loanerDesk.summary', {
                    tag: device.asset.asset_tag,
                    name: borrower.display_name,
                    date: formatDate(`${due}T00:00:00Z`, { timeZone: 'UTC' }),
                  })}
                </p>
              ) : null}
              <Button
                ref={lendButton}
                type="submit"
                variant="primary"
                loading={busy}
                disabled={!device || !borrower}
                className="min-h-14 text-lg"
              >
                {t('loanerDesk.lend')}
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
  onReturn: (tag: string) => void;
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
      {feedback?.returnTag ? (
        <Button type="button" onClick={() => onReturn(feedback.returnTag!)}>
          {returnLabel}
        </Button>
      ) : null}
    </div>
  );
}
