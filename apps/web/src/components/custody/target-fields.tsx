'use client';

import { useId } from 'react';
import { AssetPicker, type AssetRef } from '@/components/registry/asset-picker';
import { LocationPicker } from '@/components/registry/location-picker';
import { PersonPicker, type PersonRef } from '@/components/registry/person-picker';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { dateAfter, today, type TargetType } from '@/lib/custody/helpers';

export interface TargetState {
  type: TargetType;
  person: PersonRef | null;
  location: string;
  asset: AssetRef | null;
}

export const EMPTY_TARGET: TargetState = {
  type: 'person',
  person: null,
  location: '',
  asset: null,
};

/** The id of the chosen target, whatever its type (empty when nothing is chosen). */
export function targetId(target: TargetState): string {
  return target.type === 'person'
    ? (target.person?.id ?? '')
    : target.type === 'location'
      ? target.location
      : (target.asset?.id ?? '');
}

/** The request member for the chosen target: exactly one of `person_id`, `location_id`, `target_asset_id`. */
export function targetBody(
  target: TargetState,
): { person_id: string } | { location_id: string } | { target_asset_id: string } {
  const id = targetId(target);
  return target.type === 'person'
    ? { person_id: id }
    : target.type === 'location'
      ? { location_id: id }
      : { target_asset_id: id };
}

const TYPES: TargetType[] = ['person', 'location', 'asset'];

/**
 * "Hand it to": person, location or another asset (radio group), then the matching picker. Used
 * by check-out and transfer (wireframe WEB-13).
 */
export function TargetFields({
  value,
  onChange,
  error,
  legend,
  excludeAssetId,
  autoFocus,
}: {
  value: TargetState;
  onChange: (next: TargetState) => void;
  error?: string;
  legend: string;
  excludeAssetId?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const group = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-base font-medium text-text">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {TYPES.map((type) => (
          <label
            key={type}
            className="inline-flex min-h-6 cursor-pointer items-center gap-2 text-base"
          >
            <input
              type="radio"
              name={`${group}-target`}
              value={type}
              checked={value.type === type}
              onChange={() => onChange({ ...value, type })}
              className="size-4 accent-(--color-primary)"
            />
            {t(`custody.target.${type}`)}
          </label>
        ))}
      </div>
      {value.type === 'person' ? (
        <Field
          label={t('custody.target.person')}
          required
          error={error}
          className="[&>label]:sr-only"
        >
          {(control) => (
            <PersonPicker
              {...control}
              autoFocus={autoFocus}
              value={value.person}
              onChange={(person) => onChange({ ...value, person })}
            />
          )}
        </Field>
      ) : value.type === 'location' ? (
        <Field
          label={t('custody.target.location')}
          required
          error={error}
          className="[&>label]:sr-only"
        >
          {(control) => (
            <LocationPicker
              {...control}
              invalid={!!error}
              value={value.location}
              onChange={(location) => onChange({ ...value, location })}
            />
          )}
        </Field>
      ) : (
        <Field
          label={t('custody.target.asset')}
          required
          error={error}
          className="[&>label]:sr-only"
        >
          {(control) => (
            <AssetPicker
              {...control}
              excludeId={excludeAssetId}
              value={value.asset}
              onChange={(asset) => onChange({ ...value, asset })}
            />
          )}
        </Field>
      )}
    </fieldset>
  );
}

/** Expected-return date with quick presets (tomorrow, in a week, in a month). */
export function ReturnDateField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label: string;
}) {
  const t = useT();
  return (
    <Field label={label} hint={t('custody.expectedReturnHint')} error={error}>
      {(control) => (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            {...control}
            type="date"
            min={today()}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="w-44"
          />
          <Button size="sm" onClick={() => onChange(dateAfter({ days: 1 }))}>
            {t('custody.presets.tomorrow')}
          </Button>
          <Button size="sm" onClick={() => onChange(dateAfter({ days: 7 }))}>
            {t('custody.presets.week')}
          </Button>
          <Button size="sm" onClick={() => onChange(dateAfter({ months: 1 }))}>
            {t('custody.presets.month')}
          </Button>
          {value ? (
            <Button size="sm" variant="ghost" onClick={() => onChange('')}>
              {t('custody.presets.clear')}
            </Button>
          ) : null}
        </div>
      )}
    </Field>
  );
}
