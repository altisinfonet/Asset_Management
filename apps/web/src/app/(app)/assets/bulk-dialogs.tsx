'use client';

import { useState } from 'react';
import { DepartmentPicker } from '@/components/registry/department-picker';
import { LocationPicker } from '@/components/registry/location-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useT } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import type { BulkItem, BulkResult } from '@/lib/registry/bulk';
import { statusHintKind } from '@/lib/registry/lifecycle';
import type { Lookups } from '@/lib/registry/queries';
import { uiErrorText } from '@/lib/error-text';

/**
 * What a bulk edit may change: the contract's `changes` of `POST /v1/assets/bulk-update`, or the
 * location, which is a move (`POST /v1/assets/bulk-move`, with a history note).
 */
export type BulkEditPatch =
  | { status_id: string }
  | { category_id: string }
  | { vendor_id: string }
  | { department_id: string | null }
  | { location_id: string | null; note?: string };
type BulkField = 'status_id' | 'category_id' | 'vendor_id' | 'department_id' | 'location_id';

/**
 * "Edit N assets" (wireframe WEB-07): choose a field and a value, preview the tags, apply. Location
 * moves the assets; a location-scoped user (ED-26) picks only inside its scope (the picker lists
 * nothing else) and cannot clear the location.
 */
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
  const { can, locationScope } = useAuth();
  const [field, setField] = useState<BulkField>('status_id');
  const [note, setNote] = useState('');
  const [value, setValue] = useState('');
  /** Department and location: set "none" on every selected asset. */
  const [clearValue, setClearValue] = useState(false);
  const active = <T extends { id: string; name: string; archived_at?: string | null }>(list: T[]) =>
    list.filter((x) => !x.archived_at).map((x) => ({ value: x.id, label: x.name }));
  const options =
    field === 'status_id'
      ? active(lookups.statuses)
      : field === 'category_id'
        ? active(lookups.categories)
        : field === 'vendor_id'
          ? active(lookups.vendors)
          : [];
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
                setClearValue(false);
                setNote('');
              }}
              options={[
                { value: 'status_id', label: t('assets.columns.status') },
                { value: 'category_id', label: t('assets.columns.category') },
                { value: 'vendor_id', label: t('assets.columns.vendor') },
                { value: 'department_id', label: t('assets.columns.department') },
                { value: 'location_id', label: t('bulkMove.location') },
              ]}
            />
          )}
        </Field>
        <Field label={t('assets.bulk.newValue')}>
          {(c) =>
            field === 'location_id' ? (
              <div className="flex flex-col gap-2">
                <LocationPicker
                  {...c}
                  value={clearValue ? '' : value}
                  disabled={clearValue}
                  onChange={setValue}
                />
                {locationScope ? (
                  <p className="text-sm text-muted">{t('bulkMove.scopedHint')}</p>
                ) : (
                  <Checkbox
                    label={t('bulkMove.noLocation')}
                    checked={clearValue}
                    onCheckedChange={(v) => {
                      setClearValue(v === true);
                      if (v === true) setValue('');
                    }}
                  />
                )}
              </div>
            ) : field === 'department_id' ? (
              <div className="flex flex-col gap-2">
                <DepartmentPicker
                  {...c}
                  value={clearValue ? '' : value}
                  disabled={clearValue}
                  onChange={setValue}
                />
                <Checkbox
                  label={t('assets.bulk.noDepartment')}
                  checked={clearValue}
                  onCheckedChange={(v) => {
                    setClearValue(v === true);
                    if (v === true) setValue('');
                  }}
                />
              </div>
            ) : (
              <Select
                {...c}
                value={value}
                placeholder={t('common.choose')}
                onValueChange={setValue}
                options={options}
              />
            )
          }
        </Field>
        {field === 'location_id' ? (
          <Field label={t('bulkMove.note')}>
            {(c) => (
              <Textarea
                {...c}
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        {field === 'status_id' && statusHintKind(lookups.statusById.get(value)?.state_type) ? (
          <p className="text-sm text-muted" data-testid="bulk-lifecycle-note">
            {t('lifecycle.statusHint.bulk')}
          </p>
        ) : null}
        {can('repair:manage') &&
        field === 'status_id' &&
        lookups.statusById.get(value)?.state_type === 'undeployable' ? (
          <p className="text-sm text-muted" data-testid="bulk-no-repair-note">
            {t('repairs.noRepair.bulk')}
          </p>
        ) : null}
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
            disabled={!value && !clearValue}
            loading={progress !== null}
            onClick={() =>
              onApply(
                field === 'status_id'
                  ? { status_id: value }
                  : field === 'category_id'
                    ? { category_id: value }
                    : field === 'vendor_id'
                      ? { vendor_id: value }
                      : field === 'location_id'
                        ? {
                            location_id: clearValue ? null : value,
                            ...(note.trim() ? { note: note.trim() } : {}),
                          }
                        : { department_id: clearValue ? null : value },
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
