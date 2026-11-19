'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AttachmentsPanel } from '@/components/files/attachments-panel';
import { AssetPicker, type AssetRef } from '@/components/registry/asset-picker';
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
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ActionDialog, type FieldErrors } from '@/components/w2/action-dialog';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { today } from '@/lib/custody/helpers';
import { moneyInputValue, parseMoney } from '@/lib/money';
import { useLookups } from '@/lib/registry/queries';
import {
  REPAIR_KINDS,
  repairsApi,
  type Repair,
  type RepairCompleteRequest,
  type RepairCreate,
  type RepairKind,
} from '@/lib/repairs/api';
import { dayToInstant, instantToDay } from '@/lib/repairs/helpers';

const NONE = '__none__';

const useRepairRefresh = () => {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: ['repairs'] });
    // the asset's status, history and list change with a repair
    await client.invalidateQueries({ queryKey: ['asset'] });
    await client.invalidateQueries({ queryKey: ['asset-history'] });
    await client.invalidateQueries({ queryKey: ['assets'] });
  };
};

/**
 * Log a repair (WEB-17): the asset (fixed when opened from its page), what is wrong, who fixes it,
 * a quoted cost and the status the asset takes while it is in repair. When the repair is saved the
 * dialog moves on to the files step, so quotes and photos can go in right away.
 */
export function LogRepairDialog({
  open,
  onOpenChange,
  asset,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The asset the repair is for, when the dialog is opened from the asset's page. */
  asset?: { id: string; asset_tag: string };
  onLogged?: (repair: Repair) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { me } = useAuth();
  const lookups = useLookups();
  const refresh = useRepairRefresh();
  const currency = me?.tenant.base_currency ?? 'USD';
  const [picked, setPicked] = useState<AssetRef | null>(null);
  const [kind, setKind] = useState<RepairKind>('repair');
  const [what, setWhat] = useState('');
  const [description, setDescription] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [ticket, setTicket] = useState('');
  const [cost, setCost] = useState('');
  const [reported, setReported] = useState(today());
  const [statusId, setStatusId] = useState('');
  const [logged, setLogged] = useState<Repair | null>(null);

  // The files step belongs to one run of the dialog; the next opening starts from the form again.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when closed
    if (!open) setLogged(null);
  }, [open]);

  const inRepairStatuses = lookups.statuses.filter(
    (s) => !s.archived_at && s.state_type === 'undeployable',
  );
  const assetId = asset?.id ?? picked?.id ?? '';

  const reset = () => {
    setPicked(null);
    setKind('repair');
    setWhat('');
    setDescription('');
    setVendorId('');
    setTicket('');
    setCost('');
    setReported(today());
    setStatusId(inRepairStatuses[0]?.id ?? NONE);
    setLogged(null);
  };

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!assetId) errors.asset_id = t('repairForm.errors.asset');
    if (!what.trim()) errors.title = t('repairForm.errors.title');
    if (parseMoney(cost, currency) === 'invalid') errors.cost = t('repairForm.errors.cost');
    if (!reported) errors.reported_at = t('repairForm.errors.date');
    return errors;
  };

  return (
    <>
      <ActionDialog
        open={open && !logged}
        onOpenChange={onOpenChange}
        size="lg"
        title={asset ? t('repairForm.titleFor', { tag: asset.asset_tag }) : t('repairForm.title')}
        description={t('repairForm.description')}
        submitLabel={t('repairForm.submit')}
        closeOnSuccess={false}
        onOpen={reset}
        validate={validate}
        onSubmit={async () => {
          const money = parseMoney(cost, currency);
          const body: RepairCreate = {
            asset_id: assetId,
            kind,
            title: what.trim(),
            reported_at: dayToInstant(reported),
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(vendorId ? { vendor_id: vendorId } : {}),
            ...(ticket.trim() ? { ticket_ref: ticket.trim() } : {}),
            ...(money && money !== 'invalid' ? { cost: money } : {}),
            ...(statusId && statusId !== NONE ? { set_status_id: statusId } : {}),
          };
          const created = await repairsApi.create(body);
          await refresh();
          toast({
            variant: 'success',
            title: t('repairForm.logged', { tag: created.value.asset_tag ?? asset?.asset_tag ?? picked?.label ?? '' }),
          });
          setLogged(created.value);
          onLogged?.(created.value);
        }}
      >
        {({ errors }) => (
          <>
            {asset ? null : (
              <Field label={t('repairForm.asset')} required error={errors.asset_id}>
                {(control) => (
                  <AssetPicker {...control} invalid={!!errors.asset_id} value={picked} onChange={setPicked} />
                )}
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('repairForm.kind')}>
                {(control) => (
                  <Select
                    {...control}
                    value={kind}
                    onValueChange={(v) => setKind(v as RepairKind)}
                    options={REPAIR_KINDS.map((k) => ({ value: k, label: t(`repairs.kinds.${k}`) }))}
                  />
                )}
              </Field>
              <Field label={t('repairForm.reported')} required error={errors.reported_at}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    max={today()}
                    value={reported}
                    onChange={(event) => setReported(event.target.value)}
                    className="w-44"
                  />
                )}
              </Field>
            </div>
            <Field label={t('repairForm.what')} required hint={t('repairForm.whatHint')} error={errors.title}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={200}
                  value={what}
                  onChange={(event) => setWhat(event.target.value)}
                />
              )}
            </Field>
            <Field label={t('repairForm.details')} error={errors.description}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('repairForm.vendor')} error={errors.vendor_id}>
                {(control) => (
                  <Select
                    {...control}
                    value={vendorId || NONE}
                    onValueChange={(v) => setVendorId(v === NONE ? '' : v)}
                    options={[
                      { value: NONE, label: t('repairForm.noVendor') },
                      ...lookups.vendors
                        .filter((v) => !v.archived_at)
                        .map((v) => ({ value: v.id, label: v.name })),
                    ]}
                  />
                )}
              </Field>
              <Field label={t('repairForm.ticket')} error={errors.ticket_ref}>
                {(control) => (
                  <Input
                    {...control}
                    value={ticket}
                    maxLength={100}
                    onChange={(event) => setTicket(event.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('repairForm.cost')}
                hint={t('repairForm.costHint', { currency })}
                error={errors.cost}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    value={cost}
                    placeholder="0.00"
                    onChange={(event) => setCost(event.target.value)}
                    className="w-40"
                  />
                )}
              </Field>
              <Field
                label={t('repairForm.statusWhile')}
                hint={t('repairForm.statusHint')}
                error={errors.set_status_id}
              >
                {(control) => (
                  <Select
                    {...control}
                    value={statusId || NONE}
                    onValueChange={setStatusId}
                    options={[
                      { value: NONE, label: t('repairForm.keepStatus') },
                      ...inRepairStatuses.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                )}
              </Field>
            </div>
          </>
        )}
      </ActionDialog>

      <Dialog open={open && !!logged} onOpenChange={onOpenChange}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t('repairForm.savedTitle')}</DialogTitle>
            <DialogDescription>{t('repairForm.savedDescription')}</DialogDescription>
          </DialogHeader>
          {logged ? (
            <AttachmentsPanel entityType="maintenance_record" entityId={logged.id} canWrite />
          ) : null}
          <DialogFooter>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t('repairForm.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Close a repair (WEB-17): the finishing date, what was done, the final cost, the status the asset
 * goes back to, and the receipts and photos (attachments). `POST /v1/repairs/{id}/complete`.
 */
export function CompleteRepairDialog({
  open,
  onOpenChange,
  repair,
  etag,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repair: Repair | null;
  etag?: string;
  onDone?: (repair: Repair) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { me, can } = useAuth();
  const lookups = useLookups();
  const refresh = useRepairRefresh();
  const currency = repair?.cost?.currency ?? me?.tenant.base_currency ?? 'USD';
  const [finished, setFinished] = useState(today());
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState('');
  const [statusId, setStatusId] = useState(NONE);

  const afterStatuses = lookups.statuses.filter((s) => !s.archived_at && s.state_type === 'deployable');

  return (
    <ActionDialog
      open={open && !!repair}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('repairClose.title', { title: repair?.title ?? '' })}
      description={t('repairClose.description')}
      submitLabel={t('repairClose.submit')}
      onOpen={() => {
        setFinished(today());
        setResolution(repair?.resolution_notes ?? '');
        setCost(moneyInputValue(repair?.cost));
        setStatusId(repair?.restore_status_id ?? NONE);
      }}
      validate={() => {
        const errors: FieldErrors = {};
        if (parseMoney(cost, currency) === 'invalid') errors.cost = t('repairClose.errors.cost');
        if (!finished) errors.completed_at = t('repairClose.errors.date');
        return errors;
      }}
      onSubmit={async () => {
        if (!repair) return;
        const money = parseMoney(cost, currency);
        const body: RepairCompleteRequest = {
          completed_at: dayToInstant(finished),
          ...(resolution.trim() ? { resolution_notes: resolution.trim() } : {}),
          ...(money && money !== 'invalid' ? { cost: money } : {}),
          ...(statusId !== NONE ? { restore_status_id: statusId } : {}),
        };
        const done = await repairsApi.complete(repair.id, body, etag);
        await refresh();
        toast({ variant: 'success', title: t('repairClose.closed') });
        onDone?.(done.value);
      }}
    >
      {({ errors }) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('repairClose.completed')} required error={errors.completed_at}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  min={instantToDay(repair?.reported_at)}
                  max={today()}
                  value={finished}
                  onChange={(event) => setFinished(event.target.value)}
                  className="w-44"
                />
              )}
            </Field>
            <Field
              label={t('repairClose.cost')}
              hint={t('repairClose.costHint', { currency })}
              error={errors.cost}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="decimal"
                  value={cost}
                  placeholder="0.00"
                  onChange={(event) => setCost(event.target.value)}
                  className="w-40"
                />
              )}
            </Field>
          </div>
          <Field label={t('repairClose.resolution')} error={errors.resolution_notes}>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={4000}
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
              />
            )}
          </Field>
          <Field label={t('repairClose.statusAfter')} error={errors.restore_status_id}>
            {(control) => (
              <Select
                {...control}
                value={statusId}
                onValueChange={setStatusId}
                options={[
                  { value: NONE, label: t('repairClose.statusDefault') },
                  ...afterStatuses.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            )}
          </Field>
          {repair && can('attachment:read') ? (
            <section aria-label={t('repairClose.files')} className="flex flex-col gap-2">
              <h3 className="text-base font-medium">{t('repairClose.files')}</h3>
              <AttachmentsPanel
                entityType="maintenance_record"
                entityId={repair.id}
                canWrite={can('attachment:write')}
              />
            </section>
          ) : null}
        </>
      )}
    </ActionDialog>
  );
}
