'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { peopleApi } from '@/lib/registry/api';
import type { Person } from '@/lib/registry/types';

export type PersonArchiveOutcome = 'archived' | 'deactivated';

export interface PersonArchiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The person as loaded, with the ETag every write sends as `If-Match`. */
  person: { value: Person; etag: string | undefined };
  onDone: (outcome: PersonArchiveOutcome) => Promise<void> | void;
}

/**
 * Archive a person. One who still holds assets is refused by the API (`409`, `usage.open_assignments`);
 * the dialog then says how many and offers the audited way out of the API: deactivate the person
 * anyway (`PATCH status: inactive` with `force` and a required `reason`). They stay on record and the
 * assets stay with them until they are checked in.
 */
export function PersonArchiveDialog({
  open,
  onOpenChange,
  person,
  onDone,
}: PersonArchiveDialogProps) {
  const { t } = useI18n();
  const name = person.value.display_name;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  /** Set once the archive was refused because of open assignments: how many assets they hold. */
  const [holding, setHolding] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
      setBusy(false);
      setError(null);
      setHolding(null);
      setReason('');
      setReasonError(undefined);
    }
  }, [open]);

  const archive = async () => {
    setBusy(true);
    setError(null);
    try {
      await peopleApi.archive(person.value.id, person.etag);
      await onDone('archived');
      onOpenChange(false);
    } catch (err) {
      const ui = getApi().toUiError(err);
      const count = ui.status === 409 ? ui.usage?.open_assignments : undefined;
      if (count) setHolding(count);
      else setError(ui);
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) {
      setReasonError(t('form.required'));
      return;
    }
    setBusy(true);
    setError(null);
    setReasonError(undefined);
    try {
      await peopleApi.deactivate(
        person.value.id,
        { force: true, reason: reason.trim() },
        person.etag,
      );
      await onDone('deactivated');
      onOpenChange(false);
    } catch (err) {
      const ui = getApi().toUiError(err);
      const onReason = ui.fieldErrors.find((fe) => fe.pointer === '/reason');
      if (onReason) setReasonError(onReason.message);
      else setError(ui);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('personView.archiveTitle', { name })}</DialogTitle>
          <DialogDescription>
            {holding === null
              ? t('personView.archiveDescription')
              : t('personView.forceDescription')}
          </DialogDescription>
        </DialogHeader>
        {holding === null ? (
          <>
            {error ? (
              <FormError message={uiErrorText(t, error)} requestId={error.requestId} />
            ) : null}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button variant="danger" loading={busy} onClick={() => void archive()}>
                {t('common.archive')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => void deactivate(event)}
            noValidate
            className="flex flex-col gap-4"
          >
            <Banner tone="warning" title={t('personView.holdsTitle', { name })}>
              {t('personView.holds', { count: holding })}
            </Banner>
            <Field
              label={t('personView.forceReason')}
              hint={t('personView.forceReasonHint')}
              required
              error={reasonError}
            >
              {(control) => (
                <Textarea
                  {...control}
                  invalid={!!reasonError}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(undefined);
                  }}
                />
              )}
            </Field>
            {error ? (
              <FormError message={uiErrorText(t, error)} requestId={error.requestId} />
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="danger" loading={busy}>
                {t('personView.deactivateAnyway')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
