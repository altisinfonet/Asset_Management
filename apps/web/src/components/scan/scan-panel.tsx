'use client';

import { CircleAlert, CircleCheck, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PersonPicker } from '@/components/registry/person-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/auth/auth-context';
import { useI18n } from '@/i18n';
import { useScan, type ScanMode } from './scan-provider';

/**
 * The scan panel (WEB-13 "scan next", M2-LIFE-08): a field that keeps focus for repeated scans, and
 * batch modes. "Open asset" opens each scanned asset; "Check out to a person" and "Check in" apply
 * the action to every scan and list what happened (also announced to screen readers; the sound is
 * optional and never the only signal). Opened from the top bar, the palette or a phone.
 */
export function ScanPanel() {
  const { t } = useI18n();
  const { can } = useAuth();
  const scan = useScan();
  const { batch } = scan;
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');

  const modes: Array<{ value: ScanMode; label: string }> = [
    { value: 'open', label: t('scan.modes.open') },
    ...(can('asset:checkout')
      ? [{ value: 'checkout' as const, label: t('scan.modes.checkout') }]
      : []),
    ...(can('asset:checkin')
      ? [{ value: 'checkin' as const, label: t('scan.modes.checkin') }]
      : []),
  ];

  const focusInput = () => requestAnimationFrame(() => input.current?.focus());
  useEffect(() => {
    if (scan.panelOpen) focusInput();
  }, [scan.panelOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText('');
    try {
      await scan.scan(value, 'panel');
    } finally {
      focusInput();
    }
  };

  return (
    <Dialog
      open={scan.panelOpen}
      onOpenChange={(open) => (open ? scan.openPanel() : scan.closePanel())}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('scan.panel.title')}</DialogTitle>
          <DialogDescription>{t('scan.panel.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('scan.panel.mode')}>
            {(control) => (
              <Select
                {...control}
                value={batch.mode}
                onValueChange={(value) => {
                  scan.setMode(value as ScanMode);
                  focusInput();
                }}
                options={modes}
              />
            )}
          </Field>
          {batch.mode === 'checkout' ? (
            <Field label={t('scan.panel.person')} required>
              {(control) => (
                <PersonPicker
                  {...control}
                  value={batch.person}
                  onChange={(person) => {
                    scan.setPerson(person);
                    if (person) focusInput();
                  }}
                />
              )}
            </Field>
          ) : null}
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-2"
          role="search"
        >
          <label htmlFor="scan-panel-input" className="text-base font-medium">
            {t('topbar.scanLabel')}
          </label>
          <div className="relative flex items-center">
            <ScanLine
              aria-hidden
              className="pointer-events-none absolute left-2.5 size-4 text-muted"
            />
            <Input
              ref={input}
              id="scan-panel-input"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={text}
              placeholder={t('topbar.scanPlaceholder')}
              onChange={(event) => setText(event.target.value)}
              className="pl-8 font-tag"
            />
          </div>
          <p className="text-sm text-muted">{t('scan.panel.hint')}</p>
        </form>

        <Checkbox
          label={t('scan.panel.sound')}
          checked={batch.sound}
          onCheckedChange={(value) => scan.setSound(value === true)}
        />

        <section aria-label={t('scan.panel.results')} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-muted">{t('scan.panel.results')}</h3>
          <ol
            aria-live="polite"
            aria-relevant="additions"
            className="flex max-h-56 flex-col gap-1 overflow-auto"
            data-testid="scan-log"
          >
            {batch.log.length === 0 ? (
              <li className="text-base text-muted">{t('scan.panel.noResults')}</li>
            ) : (
              batch.log.map((entry) => (
                <li
                  key={entry.id}
                  className={
                    entry.ok
                      ? 'flex items-start gap-2 rounded-md bg-success-subtle p-2 text-base text-success-text'
                      : 'flex items-start gap-2 rounded-md bg-danger-subtle p-2 text-base text-danger-text'
                  }
                >
                  {entry.ok ? (
                    <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="min-w-0 break-words">
                    {entry.message}
                    {entry.tag ? null : <span className="font-tag"> ({entry.code})</span>}
                  </span>
                </li>
              ))
            )}
          </ol>
        </section>

        <DialogFooter>
          {batch.log.length > 0 ? (
            <Button onClick={scan.clearLog}>{t('scan.panel.clear')}</Button>
          ) : null}
          <Button variant="primary" onClick={scan.closePanel}>
            {t('common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
