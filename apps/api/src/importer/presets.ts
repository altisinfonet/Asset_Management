import type { Tx } from '../tenancy/index.js';
import { type EntityType, FIELD_SPECS } from './fields.js';
import { looseKey, normKey } from './values.js';
import type { ImportOptions, Mapping, ValueMap } from './types.js';

/**
 * Built-in import presets (M2-IMP-06, M2-IMP-07): the downloadable templates of the four entity types and
 * the one-click mapping preset of the Google Admin ChromeOS device export. Code, not data: a preset is
 * matched to a file by header text, so a column that is missing from the file is simply not mapped.
 */

export interface PresetColumn {
  /** Header texts of the file this column may carry (any case or punctuation). */
  headers: readonly string[];
  target: string;
  /** The header used in the downloadable template (the first of `headers` when omitted). */
  template?: string;
}

export interface Preset {
  key: string;
  label: string;
  description: string;
  entity_type: EntityType;
  source: 'csv' | 'google_admin_csv';
  /** Columns of the downloadable template, in order; their headers are what the mapping recognises. */
  columns: readonly PresetColumn[];
  /** Example rows of the template (cells in column order). */
  examples: readonly (readonly string[])[];
  options: Partial<ImportOptions>;
  /** Texts for targets without a column. */
  constants?: Record<string, string>;
  /** Source status text (normalised) -> the state type of the label it should map to. */
  statusHints?: Record<string, string>;
  /**
   * The department column holds organisational-unit paths (`/Students/Grade 5`): the value map gets one
   * entry per path (ED-29), an existing department or one to create with the path's name.
   */
  departmentPaths?: boolean;
  /** Reference data the preset needs before it can run (created when the job is created). */
  setup?: {
    category: string;
    customFields: ReadonlyArray<{
      key: string;
      label: string;
      data_type: 'text' | 'date';
      help?: string;
    }>;
  };
  notes: readonly string[];
}

const col = (target: string, ...headers: string[]): PresetColumn => ({
  target,
  headers,
  template: headers[0],
});

export const GOOGLE_CHROMEBOOK_CATEGORY = 'Chromebook';
export const GOOGLE_CUSTOM_FIELDS = [
  { key: 'os_version', label: 'OS version', data_type: 'text' as const },
  { key: 'platform_version', label: 'Platform version', data_type: 'text' as const },
  { key: 'firmware_version', label: 'Firmware version', data_type: 'text' as const },
  {
    key: 'last_sync',
    label: 'Last sync',
    data_type: 'date' as const,
    help: 'Date of the last sync with Google Admin (time of day is not kept).',
  },
  { key: 'annotated_location', label: 'Annotated location', data_type: 'text' as const },
  { key: 'org_unit_path', label: 'Org unit path', data_type: 'text' as const },
  { key: 'mac_address', label: 'MAC address', data_type: 'text' as const },
  { key: 'ethernet_mac_address', label: 'Ethernet MAC address', data_type: 'text' as const },
  { key: 'ip_address', label: 'Last known IP address', data_type: 'text' as const },
  { key: 'boot_mode', label: 'Boot mode', data_type: 'text' as const },
  { key: 'auto_update_expiration', label: 'Auto update expiration', data_type: 'date' as const },
];

export const PRESETS: readonly Preset[] = [
  {
    key: 'assets',
    label: 'Assets',
    description:
      'One row per asset. Custom fields of your categories are added to the template as `cf:<key>` columns.',
    entity_type: 'asset',
    source: 'csv',
    columns: [
      col('asset_tag', 'Asset tag'),
      col('name', 'Name'),
      col('serial', 'Serial number'),
      col('category', 'Category'),
      col('manufacturer', 'Manufacturer'),
      col('model', 'Model'),
      col('status', 'Status'),
      col('location', 'Location'),
      col('department', 'Department'),
      col('vendor', 'Vendor'),
      col('assigned_to', 'Assigned to'),
      col('purchase_date', 'Purchase date'),
      col('purchase_cost', 'Purchase cost'),
      col('currency', 'Currency'),
      col('order_number', 'Order number'),
      col('warranty_end', 'Warranty end'),
      col('notes', 'Notes'),
    ],
    examples: [
      [
        'LAP-00101',
        "Anna's laptop",
        'C02XK0ABJGH5',
        'Laptops',
        'Dell',
        'Latitude 5440',
        'Ready to deploy',
        'HQ > Building 2 > Room 14',
        'Finance',
        'CDW',
        'anna.berg@example.com',
        '2024-03-07',
        '1249.00',
        'USD',
        'PO-2024-117',
        '2027-03-07',
        '',
      ],
      [
        '',
        'Meeting room display',
        'SN-77120-X',
        'Displays',
        'Samsung',
        'QM55B',
        'Ready to deploy',
        'HQ > Building 1 > Meeting room',
        '',
        'CDW',
        '',
        '2023-11-02',
        '899.00',
        'USD',
        'PO-2023-433',
        '2026-11-02',
        'Wall mounted',
      ],
    ],
    options: { match_on: 'auto', on_match: 'skip' },
    notes: [
      'Recommended order: locations, departments, people, then assets, so every reference exists. Missing categories, manufacturers, models, locations, departments and vendors can be created by the import; people and status labels must exist.',
      'An empty asset tag gets the next tag of the numbering template. An existing tag or serial number is skipped, updated or reported, as the import option says.',
    ],
  },
  {
    key: 'people',
    label: 'People',
    description: 'One row per person (no login is created).',
    entity_type: 'person',
    source: 'csv',
    columns: [
      col('display_name', 'Name'),
      col('first_name', 'First name'),
      col('last_name', 'Last name'),
      col('email', 'Email'),
      col('phone', 'Phone'),
      col('employee_ref', 'Employee number'),
      col('department', 'Department'),
      col('job_title', 'Job title'),
      col('kind', 'Kind'),
      col('status', 'Status'),
      col('location', 'Location'),
      col('notes', 'Notes'),
    ],
    examples: [
      [
        'Anna Berg',
        'Anna',
        'Berg',
        'anna.berg@example.com',
        '+47 22 00 00 01',
        'E-10442',
        'Finance',
        'Accountant',
        'employee',
        'active',
        'HQ > Building 2',
        '',
      ],
      [
        'Omar Haddad',
        'Omar',
        'Haddad',
        'omar.haddad@example.com',
        '',
        'E-10518',
        'IT',
        'Technician',
        'contractor',
        'active',
        'HQ',
        'Contract until 2026-12-31',
      ],
    ],
    options: { match_on: 'auto', on_match: 'skip' },
    notes: [
      'Matched by email, else by employee number. Departments and locations can be created by the import.',
    ],
  },
  {
    key: 'locations',
    label: 'Locations',
    description: 'One row per location; the tree is built from the path.',
    entity_type: 'location',
    source: 'csv',
    columns: [
      col('path', 'Path'),
      col('kind', 'Kind'),
      col('code', 'Code'),
      col('address_line1', 'Address line 1'),
      col('city', 'City'),
      col('postal_code', 'Postal code'),
      col('country', 'Country'),
      col('notes', 'Notes'),
    ],
    examples: [
      ['HQ', 'site', 'HQ', '1 Main Street', 'Oslo', '0150', 'NO', ''],
      ['HQ > Building 2', 'building', 'HQ-B2', '', '', '', '', ''],
      ['HQ > Building 2 > Room 14', 'room', 'HQ-B2-14', '', '', '', '', 'Store room'],
    ],
    options: { on_match: 'skip' },
    notes: [
      'The path lists the parents from the top, separated by ">". Missing parents are created, so the order of the rows does not matter. At most ten levels.',
    ],
  },
  {
    key: 'departments',
    label: 'Departments',
    description: 'One row per department.',
    entity_type: 'department',
    source: 'csv',
    columns: [
      col('name', 'Name'),
      col('code', 'Code'),
      col('description', 'Description'),
      col('manager', 'Manager'),
    ],
    examples: [
      ['Finance', 'CC-100', 'Accounting and payroll', 'anna.berg@example.com'],
      ['IT', 'CC-200', 'Support and infrastructure', ''],
    ],
    options: { on_match: 'skip' },
    notes: ['Matched by name (ignoring case). The manager is a person: import people first.'],
  },
  {
    key: 'google_admin_chromeos',
    label: 'Google Admin: ChromeOS devices',
    description:
      'The device list exported from the Google Admin console (Devices > Chrome > Devices > export). Devices become assets of the Chromebook category with their OS version, MAC addresses and last sync as custom fields; the organisational unit becomes the department; the annotated user is the person the device is checked out to; disabled and deprovisioned devices are Retired. Re-importing the same file updates the devices by serial number.',
    entity_type: 'asset',
    source: 'google_admin_csv',
    columns: [
      col('serial', 'Serial number', 'Serial'),
      col('asset_tag', 'Asset ID', 'Annotated asset ID'),
      col('status', 'Status'),
      col('model', 'Model'),
      col('cf:os_version', 'OS version'),
      col('cf:platform_version', 'Platform version'),
      col('cf:firmware_version', 'Firmware version'),
      col('cf:last_sync', 'Last sync', 'Last Sync Time'),
      col('assigned_to', 'User', 'Annotated user', 'Recent users'),
      col('cf:annotated_location', 'Location', 'Annotated location'),
      col('notes', 'Notes', 'Annotated notes'),
      col('department', 'Org unit path', 'Organizational unit path', 'OU path'),
      col('cf:mac_address', 'MAC address'),
      col('cf:ethernet_mac_address', 'Ethernet MAC address'),
      col('cf:ip_address', 'Last known IP address', 'Last known network'),
      col('external_id', 'Device ID', 'Directory API ID'),
      col('cf:boot_mode', 'Boot mode'),
      col(
        'cf:auto_update_expiration',
        'Auto update expiration',
        'Auto Update Expiration (Month/Year)',
      ),
    ],
    examples: [
      [
        '5CD1234ABC',
        'CHR-0001',
        'ACTIVE',
        'HP Chromebook 14 G6',
        '126.0.6478.222',
        '15886.65.0',
        'Google_Dedede.14505.440.0',
        '2026-11-20',
        'student.one@school.example',
        'Room 12',
        '',
        '/Students/Grade 5',
        '3C:E9:F7:12:34:56',
        '',
        '10.20.30.41',
        '8a1b2c3d-0001',
        'Verified',
        '2029-06-30',
      ],
      [
        '5CD1234ABD',
        '',
        'PROVISIONED',
        'HP Chromebook 14 G6',
        '126.0.6478.222',
        '15886.65.0',
        'Google_Dedede.14505.440.0',
        '2026-11-18',
        '',
        '',
        'Spare',
        '/Students/Grade 6',
        '3C:E9:F7:12:34:57',
        '3C:E9:F7:12:34:58',
        '',
        '8a1b2c3d-0002',
        'Verified',
        '2029-06-30',
      ],
    ],
    options: {
      match_on: 'serial',
      on_match: 'update',
      external_source: 'google_admin',
      references: {
        category: 'create',
        model: 'create',
        manufacturer: 'create',
        location: 'create',
        department: 'create',
        status: 'must_exist',
        person: 'must_exist',
      },
    },
    constants: { category: GOOGLE_CHROMEBOOK_CATEGORY },
    // ED-29: a disabled or deprovisioned Chromebook is out of service, not in repair: it is Retired
    statusHints: {
      active: 'deployable',
      provisioned: 'deployable',
      'in pipeline': 'deployable',
      disabled: 'archived',
      deprovisioned: 'archived',
      retired: 'archived',
    },
    departmentPaths: true,
    setup: { category: GOOGLE_CHROMEBOOK_CATEGORY, customFields: GOOGLE_CUSTOM_FIELDS },
    notes: [
      'Creating the import creates the Chromebook category and its custom fields if they do not exist yet.',
      'Status: Active and Provisioned map to your default deployable label; Disabled and Deprovisioned to Retired (your label of the archived type). Check the value mapping.',
      'The organisational unit becomes the department: "/Students/Grade 5" is the department "Students / Grade 5", or an existing department of that name or called "Grade 5". Unknown units are created as departments (this needs department:manage); map or skip them in the value mapping. No location is created from the unit; map a location column yourself if you want one.',
    ],
  },
];

export function presetOf(key: string): Preset | undefined {
  return PRESETS.find((p) => p.key === key);
}

/**
 * Applies a preset to the headers of an analysed file: every preset column whose header matches (ignoring
 * case and punctuation) is mapped; the remaining columns keep the heuristic suggestion unless their target
 * is already taken. `distinct` lists the values of a column, for the status hints.
 */
export async function applyPreset(
  tx: Tx,
  key: string,
  headers: readonly string[],
  suggested: Mapping,
  distinct?: (index: number) => Promise<string[]>,
): Promise<{ mapping: Mapping; options: Partial<ImportOptions>; valueMap: ValueMap } | null> {
  const preset = presetOf(key);
  if (!preset) return null;
  const columns = headers.map((_, index) => ({ index, target: null as string | null }));
  const used = new Set<string>();
  headers.forEach((h, index) => {
    const hit = preset.columns.find(
      (c) => !used.has(c.target) && c.headers.some((x) => looseKey(x) === looseKey(h)),
    );
    if (hit) {
      columns[index]!.target = hit.target;
      used.add(hit.target);
    }
  });
  for (const s of suggested.columns) {
    const mine = columns[s.index]!;
    if (
      mine.target === null &&
      s.target &&
      !used.has(s.target) &&
      !(preset.constants && s.target in preset.constants)
    ) {
      mine.target = s.target;
      used.add(s.target);
    }
  }
  const mapping: Mapping = {
    columns,
    ...(preset.constants ? { constants: { ...preset.constants } } : {}),
  };
  const valueMap: ValueMap = {};
  const departmentColumn = columns.find((c) => c.target === 'department');
  if (preset.departmentPaths && departmentColumn && distinct) {
    const departments = await tx.department.findMany({
      where: { archived_at: null },
      select: { id: true, name: true },
    });
    const entries: NonNullable<ValueMap['department']> = {};
    for (const value of await distinct(departmentColumn.index)) {
      const entry = departmentForPath(value, departments);
      if (entry) entries[normKey(value)] = entry;
    }
    if (Object.keys(entries).length > 0) valueMap.department = entries;
  }
  const statusColumn = columns.find((c) => c.target === 'status');
  if (preset.statusHints && statusColumn && distinct) {
    const labels = await tx.status_label.findMany({
      where: { archived_at: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, state_type: true, is_default: true },
    });
    const entries: Record<string, { id: string }> = {};
    for (const value of await distinct(statusColumn.index)) {
      const wanted = preset.statusHints[normKey(value)];
      if (!wanted) continue;
      const label =
        (wanted === 'deployable'
          ? labels.find((l) => l.is_default && l.state_type === 'deployable')
          : wanted === 'archived'
            ? labels.find((l) => l.state_type === 'archived' && normKey(l.name) === 'retired')
            : undefined) ?? labels.find((l) => l.state_type === wanted);
      if (label) entries[normKey(value)] = { id: label.id };
    }
    if (Object.keys(entries).length > 0) valueMap.status = entries;
  }
  return { mapping, options: preset.options, valueMap };
}

/**
 * The department an organisational-unit path stands for (ED-29): its segments joined by " / "
 * (`/Students/Grade 5` -> "Students / Grade 5"). An existing department of exactly that name, else the
 * one existing department named like the last segment ("Grade 5"), is used; otherwise the entry asks the
 * import to create it under that name (the reference policy and `department:manage` still apply). The
 * root unit `/` names no department: the cell is skipped.
 */
export function departmentForPath(
  path: string,
  departments: ReadonlyArray<{ id: string; name: string }>,
): { id: string } | { create: true; name: string } | { skip: true } | null {
  const parts = path
    .split('/')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length === 0) return path.trim() === '/' ? { skip: true } : null;
  const name = parts.join(' / ').slice(0, 200);
  const exact = departments.find((d) => normKey(d.name) === normKey(name));
  if (exact) return { id: exact.id };
  const last = departments.filter((d) => normKey(d.name) === normKey(parts[parts.length - 1]!));
  if (last.length === 1) return { id: last[0]!.id };
  return { create: true, name };
}

/** The template headers of a preset, and the data dictionary rows (all entity types share `FIELD_SPECS`). */
export function dictionary(preset: Preset): Array<{
  column: string;
  target: string;
  description: string;
  required: string;
  example: string;
}> {
  return preset.columns.map((c) => {
    const spec = FIELD_SPECS[preset.entity_type].find((s) => s.key === c.target);
    const required = spec?.required
      ? 'yes'
      : c.target === 'category'
        ? 'yes (or a default category)'
        : 'no';
    return {
      column: c.template ?? c.headers[0]!,
      target: c.target,
      description:
        spec?.description ??
        (c.target.startsWith('cf:') ? `Custom field "${c.target.slice(3)}".` : ''),
      required,
      example: spec?.example ?? '',
    };
  });
}
