'use client';

import { useCallback } from 'react';
import type { FormFieldSpec, FormValues } from '@/components/registry/form-dialog';
import { LocationPicker } from '@/components/registry/location-picker';
import { useT } from '@/i18n';
import { useLocations } from '@/lib/registry/queries';
import type { RegistryUser, Role } from '@/lib/registry/types';

/**
 * The role assignments of a login on the Users screen (M2-LOC-03, ED-26): each assignment is a role
 * plus where it applies, the whole organisation or one location and everything inside it. The form
 * fields of one assignment are `role_<i>`, `scope_<i>` and `location_<i>`; the API's problem pointers
 * (`/role_assignments/<i>/location_id` ...) land on them.
 */
export type Assignment = RegistryUser['role_assignments'][number];
type Scope = NonNullable<Assignment['scope_type']>;

const roleField = (i: number) => `role_${i}`;
const scopeField = (i: number) => `scope_${i}`;
const locationField = (i: number) => `location_${i}`;

/** Form values of `assignments` (one org-wide assignment of `defaultRoleId` when there are none). */
export function accessValues(assignments: readonly Assignment[], defaultRoleId = ''): FormValues {
  const list = assignments.length > 0 ? assignments : [{ role_id: defaultRoleId }];
  return Object.fromEntries(
    list.flatMap((a, i) => [
      [roleField(i), a.role_id],
      [scopeField(i), a.scope_type ?? 'tenant'],
      [locationField(i), a.location_id ?? ''],
    ]),
  );
}

/** The `role_assignments` body of the form values (`original` keeps the company of a company grant). */
export function assignmentsFrom(
  values: FormValues,
  count: number,
  original: readonly Assignment[] = [],
): Assignment[] {
  return Array.from({ length: count }, (_, i): Assignment => {
    const role_id = String(values[roleField(i)] ?? '');
    const scope = String(values[scopeField(i)] || 'tenant') as Scope;
    if (scope === 'location') {
      return { role_id, scope_type: 'location', location_id: String(values[locationField(i)]) };
    }
    if (scope === 'company') {
      return { role_id, scope_type: 'company', company_id: original[i]?.company_id ?? null };
    }
    return { role_id, scope_type: 'tenant' };
  });
}

/** The fields of `count` assignments: role, access (whole organisation / a location) and the location. */
export function useAccessFields(
  roles: readonly Role[],
  count: number,
  original: readonly Assignment[] = [],
  /** Where the problem pointers of assignment `i` start; `() => ''` when the body is one assignment (ED-27). */
  base: (i: number) => string = (i) => `/role_assignments/${i}`,
): FormFieldSpec[] {
  const t = useT();
  const numbered = (label: string, i: number) =>
    count > 1 ? t('locationScope.numbered', { label, n: i + 1 }) : label;
  return Array.from({ length: Math.max(count, 1) }, (_, i): FormFieldSpec[] => {
    const at = (field: string) => `${base(i)}/${field}`;
    const options = [
      { value: 'tenant', label: t('locationScope.wholeOrganisation') },
      { value: 'location', label: t('locationScope.limited') },
      // a company grant (enforced like the whole organisation until company scoping ships) stays one
      ...(original[i]?.scope_type === 'company'
        ? [{ value: 'company', label: t('locationScope.company') }]
        : []),
    ];
    return [
      {
        name: roleField(i),
        label: numbered(t('users.form.role'), i),
        kind: 'select',
        required: true,
        placeholder: t('common.choose'),
        options: roles.map((r) => ({ value: r.id, label: r.name })),
        pointers: [at('role_id')],
      },
      {
        name: scopeField(i),
        label: numbered(t('locationScope.access'), i),
        kind: 'select',
        required: true,
        hint: t('locationScope.accessHint'),
        options,
        pointers: [at('scope_type'), at('company_id')],
      },
      {
        name: locationField(i),
        label: numbered(t('locationScope.location'), i),
        kind: 'custom',
        required: true,
        hint: t('locationScope.locationHint'),
        visible: (values) => values[scopeField(i)] === 'location',
        pointers: [at('location_id')],
        render: ({ control, value, set, invalid }) => (
          <LocationPicker {...control} invalid={invalid} value={String(value)} onChange={set} />
        ),
      },
    ];
  }).flat();
}

/** "Technician at Room 101": the role and, for a scoped one, where it applies. */
export function useAssignmentLabel(roles: readonly Role[]) {
  const t = useT();
  const locations = useLocations();
  const locationName = useCallback(
    (id: string) =>
      locations.data?.find((l) => l.id === id)?.name ?? t('locationScope.archivedLocation'),
    [locations.data, t],
  );
  /** " at Room 101" for a scoped assignment, '' otherwise. */
  const where = useCallback(
    (a: Assignment) =>
      a.scope_type === 'location' && a.location_id
        ? t('locationScope.at', { location: locationName(a.location_id) })
        : '',
    [locationName, t],
  );
  const label = useCallback(
    (a: Assignment) => {
      const role = roles.find((r) => r.id === a.role_id)?.name ?? '';
      const place = where(a);
      return place ? `${role} ${place}` : role;
    },
    [roles, where],
  );
  return { label, where };
}
