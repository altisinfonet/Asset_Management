import { describe, expect, it } from 'vitest';
import { departmentForPath, presetOf } from './presets.js';

const DEPTS = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Grade 5' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Staff / Library' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Science' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'science ' },
];

describe('Google Admin preset (ED-29)', () => {
  it('maps the org unit path to the department, not the location', () => {
    const google = presetOf('google_admin_chromeos')!;
    const ou = google.columns.find((c) => c.headers.includes('Org unit path'))!;
    expect(ou.target).toBe('department');
    expect(google.columns.some((c) => c.target === 'location')).toBe(false);
    expect(google.options.references).toMatchObject({ department: 'create' });
    expect(google.departmentPaths).toBe(true);
  });

  it('retires disabled and deprovisioned devices instead of putting them in repair', () => {
    const hints = presetOf('google_admin_chromeos')!.statusHints!;
    expect(hints.disabled).toBe('archived');
    expect(hints.deprovisioned).toBe('archived');
    expect(hints.active).toBe('deployable');
  });

  it('turns an org unit path into a department name, using an existing one when it fits', () => {
    // a new unit: created under its path
    expect(departmentForPath('/Students/Grade 6', DEPTS)).toEqual({
      create: true,
      name: 'Students / Grade 6',
    });
    expect(departmentForPath('/Spare  pool/', DEPTS)).toEqual({ create: true, name: 'Spare pool' });
    // the exact path name, ignoring case
    expect(departmentForPath('/staff/library', DEPTS)).toEqual({ id: DEPTS[1]!.id });
    // the one department named like the last segment
    expect(departmentForPath('/Students/Grade 5', DEPTS)).toEqual({ id: DEPTS[0]!.id });
    // two departments of that name: never guessed
    expect(departmentForPath('/Staff/Science', DEPTS)).toEqual({
      create: true,
      name: 'Staff / Science',
    });
    // the root unit names no department
    expect(departmentForPath('/', DEPTS)).toEqual({ skip: true });
  });
});
