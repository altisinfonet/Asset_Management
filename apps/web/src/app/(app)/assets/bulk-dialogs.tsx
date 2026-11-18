'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/banner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useT } from '@/i18n';
import type { BulkItem, BulkResult } from '@/lib/registry/bulk';
import type { Lookups } from '@/lib/registry/queries';
import { uiErrorText } from '@/lib/error-text';

/** What a bulk edit may change (the contract's `changes` of `POST /v1/assets/bulk-update`). */
export type BulkEditPatch = { status_id: string } | { category_id: string } | { vendor_id: string };
type BulkField = 'status_id' | 'category_id' | 'vendor_id';

/** "Edit N assets" (wireframe WEB-07): choose a field and a value, preview the tags, apply. */
export function BulkEditDialog({
  open,
  onOpenChange,
  items,
  lookups,
  progress,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: BulkItem[];
  lookups: Lookups;
  progress: { done: number; total: number } | null;
  onApply: (patch: BulkEditPatch) => void;
}) {
  const t = useT();
  const [field, setField] = useState<BulkField>('status_id');
  const [value, setValue] = useState('');
  const active = <T extends { id: string; name: string; archived_at?: string | null }>(list: T[]) =>
    list.filter((x) => !x.archived_at).map((x) => ({ value: x.id, label: x.name }));
  const options =
    field === 'status_id'
      ? active(lookups.statuses)
      : field === 'category_id'
        ? active(lookups.categories)
        : active(lookups.vendors);
  const preview = items
    .slice(0, 5)
    .map((i) => i.label)
    .join(', ');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assets.bulk.editTitle', { count: items.length })}</DialogTitle>
          <DialogDescription>{t('assets.bulk.editDescription')}</DialogDescription>
        </DialogHeader>
        <Field label={t('assets.bulk.field')}>
          {(c) => (
            <Select
              {...c}
              value={field}
              onValueChange={(v) => {
                setField(v as typeof field);
                setValue('');
              }}
              options={[
                { value: 'status_id', label: t('assets.columns.status') },
                { value: 'category_id', label: t('assets.columns.category') },
                { value: 'vendor_id', label: t('assets.columns.vendor') },
              ]}
            />
          )}
        </Field>
        <Field label={t('assets.bulk.newValue')}>
          {(c) => (
            <Select
              {...c}
              value={value}
              placeholder={t('common.choose')}
              onValueChange={setValue}
              options={options}
            />
          )}
        </Field>
        <Banner tone="info" title={t('assets.bulk.previewTitle')}>
          {t('assets.bulk.preview', {
            tags: items.length > 5 ? `${preview}, ...` : preview,
            count: items.length,
          })}
        </Banner>
        {progress ? (
          <p role="status" className="text-sm text-muted">
            {t('assets.bulk.progress', { done: progress.done, total: progress.total })}
          </p>
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!value}
            loading={progress !== null}
            onClick={() =>
              onApply(
                field === 'status_id'
                  ? { status_id: value }
                  : field === 'category_id'
                    ? { category_id: value }
                    : { vendor_id: value },
              )
            }
          >
            {t('assets.bulk.apply', { count: items.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What happened to each asset of a bulk action: successes counted, failures listed with the reason. */
export function BulkResultsDialog({
  results,
  title,
  onClose,
}: {
  results: BulkResult[] | null;
  title: string;
  onClose: () => void;
}) {
  const t = useT();
  const failed = (results ?? []).filter((r) => !r.ok);
  const succeeded = (results ?? []).length - failed.length;
  return (
    <Dialog open={results !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription role="status">
            {t('assets.bulk.summary', { succeeded, failed: failed.length })}
          </DialogDescription>
        </DialogHeader>
        {failed.length > 0 ? (
          <ul
            aria-label={t('assets.bulk.failures')}
            className="flex max-h-60 flex-col gap-2 overflow-auto"
          >
            {failed.map((r) => (
              <li
                key={r.item.id}
                className="rounded-md bg-danger-subtle p-2 text-sm text-danger-text"
              >
                <span className="font-tag font-medium">{r.item.label}</span>{' '}
                {r.error ? uiErrorText(t, r.error) : ''}
                {r.error?.requestId ? (
                  <span className="block font-tag text-xs">
                    {t('access.requestId', { id: r.error.requestId })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
