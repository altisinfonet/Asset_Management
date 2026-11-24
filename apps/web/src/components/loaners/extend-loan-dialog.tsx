'use client';

import { useState } from 'react';
import { ActionDialog } from '@/components/w2/action-dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { dateAfter } from '@/lib/custody/helpers';
import { loanersApi } from '@/lib/loaners/api';
import { todayUtc } from '@/lib/loaners/helpers';
import { useRefreshAfterLoan } from '@/lib/loaners/queries';

/** The loan being extended: its id (the assignment), the device and the date it now ends. */
export interface ExtendTarget {
  loanId: string;
  tag: string;
  expectedReturn: string;
}

/**
 * Extend a loan (M2-LOAN-04, `POST /v1/loans/{id}/extend`): a later due date with an optional reason.
 * The pool's longest loan is the server's to enforce; its refusal is shown on the date field.
 */
export function ExtendLoanDialog({
  target,
  onOpenChange,
}: {
  target: ExtendTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, formatDate } = useI18n();
  const { toast } = useToast();
  const refresh = useRefreshAfterLoan();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const current = target?.expectedReturn ?? '';
  const day = (value: string) => formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC' });

  return (
    <ActionDialog
      open={target !== null}
      onOpenChange={onOpenChange}
      title={t('loaners.extend.title', { tag: target?.tag ?? '' })}
      description={t('loaners.extend.description', { date: current ? day(current) : '' })}
      submitLabel={t('loaners.extend.submit')}
      onOpen={() => {
        setDate(dateAfter({ days: 7 }) > current ? dateAfter({ days: 7 }) : '');
        setNote('');
      }}
      validate={() => {
        const errors: Record<string, string> = {};
        if (!date) errors.expected_return = t('loaners.extend.errors.required');
        else if (date <= current) errors.expected_return = t('loaners.extend.errors.notLater');
        else if (date < todayUtc()) errors.expected_return = t('loaners.extend.errors.past');
        return errors;
      }}
      onSubmit={async () => {
        await loanersApi.extend(target!.loanId, {
          expected_return: date,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        await refresh();
        toast({
          variant: 'success',
          title: t('loaners.extend.done', { tag: target!.tag, date: day(date) }),
        });
      }}
    >
      {({ errors }) => (
        <>
          <Field label={t('loaners.extend.date')} error={errors.expected_return} required>
            {(control) => (
              <Input
                {...control}
                type="date"
                value={date}
                min={todayUtc()}
                invalid={!!errors.expected_return}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('loaners.extend.note')} error={errors.note}>
            {(control) => (
              <Input
                {...control}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </>
      )}
    </ActionDialog>
  );
}
