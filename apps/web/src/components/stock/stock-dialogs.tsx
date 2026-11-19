'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  EMPTY_TARGET,
  ReturnDateField,
  TargetFields,
  targetBody,
  targetId,
  type TargetState,
} from '@/components/custody/target-fields';
import { PersonPicker, type PersonRef } from '@/components/registry/person-picker';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ActionDialog, type FieldErrors } from '@/components/w2/action-dialog';
import { useI18n } from '@/i18n';
import { createKeyKeeper, today } from '@/lib/custody/helpers';
import { useLookups } from '@/lib/registry/queries';
import {
  accessoriesApi,
  consumablesApi,
  type Accessory,
  type AccessoryCheckoutRequest,
  type Assignment,
  type Consumable,
  type StockKind,
  type StockMovementCreate,
} from '@/lib/stock/api';
import { adjustmentDelta, outstanding, parseCount } from '@/lib/stock/helpers';

const useStockRefresh = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ['stock'] });
};

function QuantityField({
  label,
  hint,
  value,
  onChange,
  error,
  min = 1,
  max,
  autoFocus,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  min?: number;
  max?: number;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} required hint={hint} error={error}>
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-40"
        />
      )}
    </Field>
  );
}

function NoteField({
  label,
  hint,
  value,
  onChange,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(control) => (
        <Textarea
          {...control}
          rows={2}
          maxLength={2000}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

// ---- accessories: hand out and take back ---------------------------------------------------------

/** Check out N units of an accessory to a person, a location or an asset (`Idempotency-Key` per attempt). */
export function CheckoutAccessoryDialog({
  open,
  onOpenChange,
  accessory,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessory: Accessory | null;
  onDone?: (assignment: Assignment) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const lookups = useLookups();
  const refresh = useStockRefresh();
  const keys = useRef(createKeyKeeper());
  const [target, setTarget] = useState<TargetState>(EMPTY_TARGET);
  const [quantity, setQuantity] = useState('1');
  const [expected, setExpected] = useState('');
  const [note, setNote] = useState('');
  const available = accessory?.qty_available ?? 0;
  const name = accessory?.name ?? '';

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (!targetId(target)) errors.target = t('stockActions.checkout.errors.target');
    const count = parseCount(quantity);
    if (count === null || count < 1 || count > available) {
      errors.quantity = t('stockActions.checkout.errors.quantity', { max: available });
    }
    if (expected && expected < today()) {
      errors.expected_return = t('stockActions.checkout.errors.pastDate');
    }
    return errors;
  };

  return (
    <ActionDialog
      open={open && !!accessory}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('stockActions.checkout.title', { name })}
      description={
        available > 0
          ? t('stockActions.checkout.description', { available })
          : t('stockActions.checkout.noneAvailable')
      }
      submitLabel={t('stockActions.checkout.submit')}
      submitDisabled={available < 1}
      onOpen={() => {
        setTarget(EMPTY_TARGET);
        setQuantity('1');
        setExpected('');
        setNote('');
        keys.current.renew();
      }}
      validate={validate}
      onSubmit={async () => {
        if (!accessory) return;
        const count = parseCount(quantity) ?? 1;
        const body: AccessoryCheckoutRequest = {
          ...targetBody(target),
          quantity: count,
          ...(expected ? { expected_return: expected } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const assignment = await accessoriesApi.checkout(
          accessory.id,
          body,
          keys.current.keyFor(body),
        );
        const who =
          target.type === 'person'
            ? (target.person?.display_name ?? '')
            : target.type === 'location'
              ? lookups.locationLabel(target.location)
              : (target.asset?.label ?? '');
        await refresh();
        toast({ variant: 'success', title: t('stockActions.checkout.done', { count, name, who }) });
        onDone?.(assignment);
      }}
    >
      {({ errors }) => (
        <>
          <TargetFields
            legend={t('stockActions.checkout.to')}
            value={target}
            onChange={setTarget}
            error={
              errors.target ?? errors.person_id ?? errors.location_id ?? errors.target_asset_id
            }
            autoFocus
          />
          <QuantityField
            label={t('stockActions.checkout.quantity')}
            hint={t('stockActions.checkout.quantityHint', { max: available })}
            value={quantity}
            onChange={setQuantity}
            error={errors.quantity}
            max={available}
          />
          <ReturnDateField
            label={t('stockActions.checkout.expectedReturn')}
            value={expected}
            onChange={setExpected}
            error={errors.expected_return}
          />
          <NoteField
            label={t('stockActions.checkout.note')}
            value={note}
            onChange={setNote}
            error={errors.note}
          />
        </>
      )}
    </ActionDialog>
  );
}

/** Take some or all of the outstanding units of one hand-out back (a partial return leaves it open). */
export function ReturnAccessoryDialog({
  open,
  onOpenChange,
  accessory,
  assignment,
  holder,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessory: Accessory | null;
  assignment: Assignment | null;
  holder: string;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useStockRefresh();
  const keys = useRef(createKeyKeeper());
  const left = assignment ? outstanding(assignment) : 0;
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');

  return (
    <ActionDialog
      open={open && !!accessory && !!assignment}
      onOpenChange={onOpenChange}
      title={t('stockActions.checkin.title', { name: accessory?.name ?? '' })}
      description={t('stockActions.checkin.description', { who: holder, count: left })}
      submitLabel={t('stockActions.checkin.submit')}
      onOpen={() => {
        setQuantity(String(left));
        setNote('');
        keys.current.renew();
      }}
      validate={(): FieldErrors => {
        const count = parseCount(quantity);
        return count === null || count < 1 || count > left
          ? { quantity: t('stockActions.checkin.errors.quantity', { max: left }) }
          : {};
      }}
      onSubmit={async () => {
        if (!accessory || !assignment) return;
        const count = parseCount(quantity) ?? left;
        const body = {
          assignment_id: assignment.id,
          quantity: count,
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const result = await accessoriesApi.checkin(accessory.id, body, keys.current.keyFor(body));
        await refresh();
        const stillOut = outstanding(result);
        toast({
          variant: 'success',
          title:
            stillOut > 0
              ? t('stockActions.checkin.partial', { count, left: stillOut })
              : t('stockActions.checkin.full'),
        });
        onDone?.();
      }}
    >
      {({ errors }) => (
        <>
          <QuantityField
            label={t('stockActions.checkin.quantity')}
            hint={t('stockActions.checkin.quantityHint', { max: left })}
            value={quantity}
            onChange={setQuantity}
            error={errors.quantity}
            max={left}
            autoFocus
          />
          <NoteField
            label={t('stockActions.checkin.note')}
            value={note}
            onChange={setNote}
            error={errors.note}
          />
        </>
      )}
    </ActionDialog>
  );
}

// ---- consumables: receive, use, count ----------------------------------------------------------

export type MovementMode = 'receive' | 'consume' | 'adjust';

/** Receive, use or count a consumable; each is one append to its stock ledger. */
export function MovementDialog({
  open,
  onOpenChange,
  consumable,
  mode,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consumable: Consumable | null;
  mode: MovementMode;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useStockRefresh();
  const keys = useRef(createKeyKeeper());
  const [quantity, setQuantity] = useState('');
  const [person, setPerson] = useState<PersonRef | null>(null);
  const [note, setNote] = useState('');
  const onHand = consumable?.qty_on_hand ?? 0;
  const name = consumable?.name ?? '';

  const title =
    mode === 'receive'
      ? t('stockActions.movement.receive.title', { name })
      : mode === 'consume'
        ? t('stockActions.movement.consume.title', { name })
        : t('stockActions.movement.adjust.title', { name });
  const description =
    mode === 'receive'
      ? t('stockActions.movement.receive.description')
      : mode === 'consume'
        ? t('stockActions.movement.consume.description')
        : t('stockActions.movement.adjust.description');
  const quantityLabel =
    mode === 'receive'
      ? t('stockActions.movement.receive.quantity')
      : mode === 'consume'
        ? t('stockActions.movement.consume.quantity')
        : t('stockActions.movement.adjust.quantity');
  const submitLabel =
    mode === 'receive'
      ? t('stockActions.movement.receive.submit')
      : mode === 'consume'
        ? t('stockActions.movement.consume.submit')
        : t('stockActions.movement.adjust.submit');

  const counted = parseCount(quantity);
  const delta = mode === 'adjust' && counted !== null ? adjustmentDelta(onHand, counted) : null;

  const validate = (): FieldErrors => {
    const count = parseCount(quantity);
    if (mode === 'adjust') {
      if (count === null) return { quantity: t('stockActions.movement.errors.count') };
      if (adjustmentDelta(onHand, count) === 0) {
        return { quantity: t('stockActions.movement.errors.noChange') };
      }
      return {};
    }
    if (count === null || count < 1)
      return { quantity: t('stockActions.movement.errors.quantity') };
    if (mode === 'consume' && count > onHand) {
      return { quantity: t('stockActions.movement.errors.tooMany', { max: onHand }) };
    }
    return {};
  };

  return (
    <ActionDialog
      open={open && !!consumable}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      submitLabel={submitLabel}
      onOpen={() => {
        setQuantity('');
        setPerson(null);
        setNote('');
        keys.current.renew();
      }}
      validate={validate}
      onSubmit={async () => {
        if (!consumable) return;
        const count = parseCount(quantity) ?? 0;
        const body: StockMovementCreate = {
          qty_delta: mode === 'receive' ? count : mode === 'consume' ? -count : count - onHand,
          reason: mode === 'receive' ? 'receive' : mode === 'consume' ? 'issue' : 'adjust',
          ...(mode === 'consume' && person ? { person_id: person.id } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        const movement = await consumablesApi.addMovement(
          consumable.id,
          body,
          keys.current.keyFor(body),
        );
        await refresh();
        toast({
          variant: 'success',
          title:
            mode === 'receive'
              ? t('stockActions.movement.receive.done', {
                  count,
                  balance: movement.balance_after,
                })
              : mode === 'consume'
                ? t('stockActions.movement.consume.done', {
                    count,
                    balance: movement.balance_after,
                  })
                : t('stockActions.movement.adjust.done', { balance: movement.balance_after }),
        });
        onDone?.();
      }}
    >
      {({ errors }) => (
        <>
          <QuantityField
            label={quantityLabel}
            hint={
              mode === 'consume'
                ? t('stockActions.movement.consume.quantityHint', { max: onHand })
                : undefined
            }
            value={quantity}
            onChange={setQuantity}
            error={errors.quantity ?? errors.qty_delta}
            min={mode === 'adjust' ? 0 : 1}
            autoFocus
          />
          {mode === 'adjust' && delta !== null && delta !== 0 ? (
            <p role="status" className="text-base" data-testid="count-delta">
              {t('stockActions.movement.adjust.change', {
                delta: delta > 0 ? `+${delta}` : String(delta),
              })}
            </p>
          ) : null}
          {mode === 'consume' ? (
            <Field
              label={t('stockActions.movement.consume.person')}
              hint={t('stockActions.movement.consume.personHint')}
              error={errors.person_id}
            >
              {(control) => (
                <PersonPicker {...control} clearable value={person} onChange={setPerson} />
              )}
            </Field>
          ) : null}
          <NoteField
            label={t('stockActions.movement.note')}
            hint={t('stockActions.movement.noteHint')}
            value={note}
            onChange={setNote}
            error={errors.note}
          />
        </>
      )}
    </ActionDialog>
  );
}

// ---- the minimum-stock setting -------------------------------------------------------------------

/** Set the low-stock threshold of an accessory or a consumable (`min_qty`). */
export function MinimumDialog({
  open,
  onOpenChange,
  kind,
  item,
  etag,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: StockKind;
  item: Accessory | Consumable | null;
  etag: string | undefined;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useStockRefresh();
  const [value, setValue] = useState('0');

  return (
    <ActionDialog
      open={open && !!item}
      onOpenChange={onOpenChange}
      title={t('stockActions.minimum.title', { name: item?.name ?? '' })}
      description={t('stockActions.minimum.description')}
      submitLabel={t('stockActions.minimum.submit')}
      onOpen={() => setValue(String(item?.min_qty ?? 0))}
      validate={(): FieldErrors =>
        parseCount(value) === null ? { min_qty: t('stockActions.minimum.error') } : {}
      }
      onSubmit={async () => {
        if (!item) return;
        const min = parseCount(value) ?? 0;
        if (kind === 'accessory') await accessoriesApi.update(item.id, { min_qty: min }, etag);
        else await consumablesApi.update(item.id, { min_qty: min }, etag);
        await refresh();
        toast({ variant: 'success', title: t('stockActions.minimum.saved', { count: min }) });
        onDone?.();
      }}
    >
      {({ errors }) => (
        <QuantityField
          label={t('stockActions.minimum.label')}
          value={value}
          onChange={setValue}
          error={errors.min_qty}
          min={0}
          autoFocus
        />
      )}
    </ActionDialog>
  );
}
