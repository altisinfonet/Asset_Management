/**
 * What the mock import worker knows about files and fields: a small CSV reader (BOM, quotes, quoted
 * newlines, delimiter sniffing, header row, blank rows), the target fields of every entity with their
 * header synonyms, the built-in presets and their data dictionary, the per-column profile, the date and
 * number readers and the template writers (CSV and a minimal XLSX). Mock-only; the real API does all of
 * this in `apps/api/src/importer` (fields.ts, presets.ts, reader.ts, values.ts, template-files.ts).
 */

/** The byte order mark Excel puts in front of a UTF-8 file (built from its code so no invisible character sits in the source). */
export const BOM = String.fromCharCode(0xfeff);

// ---- CSV -------------------------------------------------------------------------------------------------

export interface ParsedCsv {
  delimiter: string;
  /** 1-based line of the header row. */
  headerLine: number;
  headers: string[];
  /** The data rows, blank rows left out. */
  rows: string[][];
  /** The 1-based line each data row starts on. */
  lines: number[];
}

const DELIMITERS = [',', ';', '\t', '|'];

export function sniffDelimiter(firstLine: string): string {
  let best = ',';
  let count = -1;
  for (const delimiter of DELIMITERS) {
    const n = firstLine.split(delimiter).length - 1;
    if (n > count) {
      best = delimiter;
      count = n;
    }
  }
  return best;
}

/** Parses delimited text; throws a sentence with the line number for text that is not valid CSV. */
export function parseCsv(
  input: string,
  options: { delimiter?: string; headerLine?: number } = {},
): ParsedCsv {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = options.delimiter ?? sniffDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  const records: Array<{ cells: string[]; line: number }> = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
      quoteLine = line;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      records.push({ cells: row, line: rowLine });
      row = [];
      cell = '';
      line += 1;
      rowLine = line;
    } else cell += char;
  }
  if (quoted) {
    throw new Error(
      `Line ${quoteLine}: a quoted value is never closed. Check the quotes and try again.`,
    );
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    records.push({ cells: row, line: rowLine });
  }
  const blank = (cells: string[]) => cells.every((c) => c.trim() === '');
  const nonBlank = records.filter((r) => !blank(r.cells));
  if (nonBlank.length === 0) throw new Error('The file is empty.');
  // the header is the first non-blank line, or the line the caller named
  const headerAt = options.headerLine
    ? nonBlank.findIndex((r) => r.line >= options.headerLine!)
    : 0;
  const header = nonBlank[Math.max(0, headerAt)]!;
  const width = header.cells.length;
  const data = nonBlank.slice(Math.max(0, headerAt) + 1);
  if (data.length === 0) {
    throw new Error(`The file has a header row (row ${header.line}) but no data rows below it.`);
  }
  return {
    delimiter,
    headerLine: header.line,
    headers: header.cells.map((h, i) => h.trim() || `Column ${i + 1}`),
    rows: data.map((r) => (r.cells.length > width ? r.cells.slice(0, width) : r.cells)),
    lines: data.map((r) => r.line),
  };
}

/** CSV text with every cell quoted when it needs it (the error report and the templates), UTF-8 with a byte order mark. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${BOM}${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

// ---- helpers ------------------------------------------------------------------------------------------------

/** A header or value reduced to letters and digits: `Serial No.` and `serial_no` are the same. */
export const looseKey = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** Normalised key used to compare names across the file and the registry (the value-map key). */
export const normKey = (text: string | null | undefined): string =>
  (text ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

// ---- fields ---------------------------------------------------------------------------------------------------

export type EntityType = 'asset' | 'person' | 'location' | 'department';
export type RefKind =
  | 'category'
  | 'manufacturer'
  | 'model'
  | 'status'
  | 'location'
  | 'department'
  | 'vendor'
  | 'person';
export type FieldKind =
  | 'text'
  | 'long_text'
  | 'email'
  | 'integer'
  | 'number'
  | 'date'
  | 'money'
  | 'enum'
  | 'ref'
  | 'path';

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  description: string;
  example: string;
  /** Header names (any case or punctuation) that suggest this field. */
  synonyms: readonly string[];
  ref?: RefKind;
  values?: readonly string[];
  required?: boolean;
}

const f = (
  key: string,
  label: string,
  kind: FieldKind,
  description: string,
  example: string,
  synonyms: readonly string[] = [],
  extra: { ref?: RefKind; values?: readonly string[]; required?: boolean } = {},
): FieldSpec => ({ key, label, kind, description, example, synonyms, ...extra });

export const PERSON_KINDS = ['employee', 'student', 'contractor', 'external'] as const;
export const PERSON_STATUSES = ['active', 'inactive'] as const;
export const LOCATION_KINDS = [
  'site',
  'building',
  'floor',
  'room',
  'storage',
  'vehicle',
  'other',
] as const;

export const FIELD_SPECS: Record<EntityType, FieldSpec[]> = {
  asset: [
    f(
      'asset_tag',
      'Asset tag',
      'text',
      'The tag printed on the label. Left empty, the next tag of the numbering template is used. Never changed by an import.',
      'LAP-00042',
      ['tag', 'asset id', 'asset number', 'inventory number', 'annotated asset id', 'barcode'],
    ),
    f('name', 'Name', 'text', 'A display name for the asset.', "Anna's laptop", [
      'asset name',
      'device name',
      'hostname',
      'computer name',
      'description',
      'title',
    ]),
    f(
      'serial',
      'Serial number',
      'text',
      'The manufacturer serial number. Used to find existing assets when re-importing.',
      'C02XK0ABJGH5',
      ['serial', 'serial no', 's/n', 'sn', 'service tag', 'device serial number'],
    ),
    f(
      'category',
      'Category',
      'ref',
      'The asset category (must be an asset category). Created when missing if the import allows it.',
      'Laptops',
      ['type', 'asset type', 'device type'],
      { ref: 'category', required: true },
    ),
    f(
      'manufacturer',
      'Manufacturer',
      'ref',
      'The manufacturer; with the model it identifies the model.',
      'Dell',
      ['make', 'brand', 'vendor name'],
      { ref: 'manufacturer' },
    ),
    f(
      'model',
      'Model',
      'ref',
      'The model name, within the category (and manufacturer, when given).',
      'Latitude 5440',
      ['model name', 'device model', 'product', 'product name', 'model number'],
      { ref: 'model' },
    ),
    f(
      'status',
      'Status',
      'ref',
      'A status label. Map the names of the file to your labels on the value mapping step.',
      'Ready to deploy',
      ['state', 'asset status'],
      { ref: 'status' },
    ),
    f(
      'location',
      'Location',
      'path',
      'A location, or a path such as "HQ > Building 2 > Room 14".',
      'HQ > Building 2 > Room 14',
      ['site', 'room', 'building', 'place', 'location path', 'org unit path', 'annotated location'],
      { ref: 'location' },
    ),
    f(
      'department',
      'Department',
      'ref',
      'The owning or cost-centre department.',
      'Finance',
      ['dept', 'cost centre', 'cost center', 'team', 'division', 'org unit'],
      { ref: 'department' },
    ),
    f('vendor', 'Vendor', 'ref', 'Who the asset was bought from.', 'CDW', ['supplier'], {
      ref: 'vendor',
    }),
    f(
      'assigned_to',
      'Assigned to',
      'ref',
      'The person holding the asset (email address, employee number or full name). The asset is checked out to them.',
      'anna@example.com',
      ['assigned user', 'assignee', 'user', 'owner', 'user email', 'annotated user', 'borrower'],
      { ref: 'person' },
    ),
    f(
      'purchase_date',
      'Purchase date',
      'date',
      'When it was bought (2024-03-07 or day/month/year).',
      '2024-03-07',
      ['purchased', 'bought', 'date purchased', 'acquired', 'invoice date'],
    ),
    f(
      'purchase_cost',
      'Purchase cost',
      'money',
      'What it cost, in major units (1234.50).',
      '1249.00',
      ['cost', 'price', 'purchase price', 'value', 'amount'],
    ),
    f(
      'currency',
      'Currency',
      'text',
      'ISO 4217 code of the cost (USD). Defaults to the import option, then to the organisation currency.',
      'EUR',
    ),
    f('order_number', 'Order number', 'text', 'Purchase order or invoice number.', 'PO-2024-117', [
      'order no',
      'po',
      'po number',
      'purchase order',
      'invoice',
    ]),
    f('warranty_end', 'Warranty end', 'date', 'When the warranty ends.', '2027-03-07', [
      'warranty expires',
      'warranty expiry',
      'warranty until',
    ]),
    f('notes', 'Notes', 'long_text', 'Free text.', 'Replaced the keyboard', [
      'note',
      'comments',
      'remarks',
    ]),
    f(
      'external_id',
      'External id',
      'text',
      'The id of the asset in another system (with the `external_source` option).',
      '8a1b2c3d-0001',
      ['device id', 'directory api id'],
    ),
  ],
  person: [
    f(
      'display_name',
      'Name',
      'text',
      'The full name as it is shown.',
      'Anna Berg',
      ['full name', 'display name', 'person', 'student name'],
      { required: true },
    ),
    f('first_name', 'First name', 'text', 'Given name.', 'Anna', ['given name', 'forename']),
    f('last_name', 'Last name', 'text', 'Family name.', 'Berg', ['surname', 'family name']),
    f(
      'email',
      'Email',
      'email',
      'Used to find the person again when re-importing.',
      'anna.berg@example.com',
      ['email address', 'mail', 'e-mail'],
    ),
    f('phone', 'Phone', 'text', 'A phone number.', '+47 22 00 00 01', ['telephone', 'mobile']),
    f(
      'employee_ref',
      'Employee number',
      'text',
      'The employee or student number; also the badge number the loaner desk scans.',
      'E-10442',
      ['employee id', 'employee ref', 'student number', 'student id', 'staff id', 'badge'],
    ),
    f('department', 'Department', 'ref', 'The person’s department.', 'Finance', ['dept'], {
      ref: 'department',
    }),
    f('job_title', 'Job title', 'text', 'The role.', 'Accountant', ['title', 'position', 'role']),
    f(
      'kind',
      'Kind',
      'enum',
      'employee, student, contractor or external.',
      'employee',
      ['person type'],
      {
        values: PERSON_KINDS,
      },
    ),
    f('status', 'Status', 'enum', 'active or inactive.', 'active', [], { values: PERSON_STATUSES }),
    f(
      'location',
      'Location',
      'path',
      'The person’s location (a name or a path).',
      'HQ > Building 2',
      ['room', 'site'],
      { ref: 'location' },
    ),
    f('notes', 'Notes', 'long_text', 'Free text.', 'Contract until 2026-12-31', ['comments']),
  ],
  location: [
    f('name', 'Name', 'text', 'The name of the location.', 'Room 14', ['location', 'room']),
    f(
      'path',
      'Path',
      'path',
      'The whole path from the top, separated by ">"; missing parents are created.',
      'HQ > Building 2 > Room 14',
      ['full path', 'location path'],
    ),
    f(
      'parent_path',
      'Parent path',
      'path',
      'The path of the parent location (a name column stays the name).',
      'HQ > Building 2',
      ['parent', 'parent location', 'within', 'ancestors'],
      { ref: 'location' },
    ),
    f(
      'kind',
      'Kind',
      'enum',
      'site, building, floor, room, storage, vehicle or other.',
      'room',
      ['type'],
      {
        values: LOCATION_KINDS,
      },
    ),
    f('code', 'Code', 'text', 'A short code.', 'HQ-B2-14', ['room number']),
    f('address_line1', 'Address line 1', 'text', 'Street address.', '1 Main Street', ['address']),
    f('address_line2', 'Address line 2', 'text', 'Second address line.', 'Suite 4'),
    f('city', 'City', 'text', 'City.', 'Oslo', ['town']),
    f('region', 'Region', 'text', 'State or region.', 'Viken', ['state', 'province']),
    f('postal_code', 'Postal code', 'text', 'Postal code.', '0150', [
      'zip',
      'zip code',
      'postcode',
    ]),
    f('country', 'Country', 'text', 'Two-letter country code.', 'NO'),
    f('latitude', 'Latitude', 'number', 'Decimal degrees.', '59.9139', ['lat']),
    f('longitude', 'Longitude', 'number', 'Decimal degrees.', '10.7522', ['lng', 'lon', 'long']),
    f('notes', 'Notes', 'long_text', 'Free text.', 'Store room', ['comments']),
  ],
  department: [
    f(
      'name',
      'Name',
      'text',
      'The name; unique among departments ignoring case.',
      'Finance',
      ['department'],
      { required: true },
    ),
    f('code', 'Code', 'text', 'A cost centre or short code.', 'CC-100', [
      'cost centre',
      'cost center',
    ]),
    f(
      'description',
      'Description',
      'long_text',
      'What the department does.',
      'Accounting and payroll',
    ),
    f(
      'manager',
      'Manager',
      'ref',
      'The manager: a person (email, employee number or name).',
      'anna.berg@example.com',
      ['head'],
      { ref: 'person' },
    ),
  ],
};

export const specOf = (entity: EntityType, key: string): FieldSpec | undefined =>
  FIELD_SPECS[entity].find((s) => s.key === key);

// ---- presets ---------------------------------------------------------------------------------------------------

export interface PresetColumn {
  /** Header texts of the file this column may carry (any case or punctuation); the first is the template header. */
  headers: readonly string[];
  target: string;
}

export interface Preset {
  key: string;
  label: string;
  description: string;
  entity_type: EntityType;
  source: 'csv' | 'google_admin_csv';
  columns: readonly PresetColumn[];
  examples: readonly (readonly string[])[];
  options: Record<string, unknown>;
  constants?: Record<string, string>;
  statusHints?: Record<string, string>;
  /** The department column holds organisational-unit paths (ED-29). */
  departmentPaths?: boolean;
  setup?: {
    category: string;
    customFields: ReadonlyArray<{ key: string; label: string; data_type: 'text' | 'date' }>;
  };
  notes: readonly string[];
}

const c = (target: string, ...headers: string[]): PresetColumn => ({ target, headers });

export const GOOGLE_CATEGORY = 'Chromebook';
export const GOOGLE_FIELDS = [
  { key: 'os_version', label: 'OS version', data_type: 'text' as const },
  { key: 'platform_version', label: 'Platform version', data_type: 'text' as const },
  { key: 'firmware_version', label: 'Firmware version', data_type: 'text' as const },
  { key: 'last_sync', label: 'Last sync', data_type: 'date' as const },
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
      c('asset_tag', 'Asset tag'),
      c('name', 'Name'),
      c('serial', 'Serial number'),
      c('category', 'Category'),
      c('manufacturer', 'Manufacturer'),
      c('model', 'Model'),
      c('status', 'Status'),
      c('location', 'Location'),
      c('department', 'Department'),
      c('vendor', 'Vendor'),
      c('assigned_to', 'Assigned to'),
      c('purchase_date', 'Purchase date'),
      c('purchase_cost', 'Purchase cost'),
      c('currency', 'Currency'),
      c('order_number', 'Order number'),
      c('warranty_end', 'Warranty end'),
      c('notes', 'Notes'),
    ],
    examples: [
      [
        'LAP-00101',
        "Anna's laptop",
        'C02XK0ABJGH5',
        'Laptop',
        'Dell',
        'Latitude 5440',
        'Ready',
        'Riverside Elementary',
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
        'Projector',
        'Samsung',
        'QM55B',
        'Ready',
        'Riverside Elementary',
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
      c('display_name', 'Name'),
      c('first_name', 'First name'),
      c('last_name', 'Last name'),
      c('email', 'Email'),
      c('phone', 'Phone'),
      c('employee_ref', 'Employee number'),
      c('department', 'Department'),
      c('job_title', 'Job title'),
      c('kind', 'Kind'),
      c('status', 'Status'),
      c('location', 'Location'),
      c('notes', 'Notes'),
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
        'Riverside Elementary',
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
        'Riverside Elementary',
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
      c('path', 'Path'),
      c('kind', 'Kind'),
      c('code', 'Code'),
      c('address_line1', 'Address line 1'),
      c('city', 'City'),
      c('postal_code', 'Postal code'),
      c('country', 'Country'),
      c('notes', 'Notes'),
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
      c('name', 'Name'),
      c('code', 'Code'),
      c('description', 'Description'),
      c('manager', 'Manager'),
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
      c('serial', 'Serial number', 'Serial'),
      c('asset_tag', 'Asset ID', 'Annotated asset ID'),
      c('status', 'Status'),
      c('model', 'Model'),
      c('cf:os_version', 'OS version'),
      c('cf:platform_version', 'Platform version'),
      c('cf:firmware_version', 'Firmware version'),
      c('cf:last_sync', 'Last sync', 'Last Sync Time'),
      c('assigned_to', 'User', 'Annotated user', 'Recent users'),
      c('cf:annotated_location', 'Location', 'Annotated location'),
      c('notes', 'Notes', 'Annotated notes'),
      c('department', 'Org unit path', 'Organizational unit path', 'OU path'),
      c('cf:mac_address', 'MAC address'),
      c('cf:ethernet_mac_address', 'Ethernet MAC address'),
      c('cf:ip_address', 'Last known IP address', 'Last known network'),
      c('external_id', 'Device ID', 'Directory API ID'),
      c('cf:boot_mode', 'Boot mode'),
      c('cf:auto_update_expiration', 'Auto update expiration'),
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
    constants: { category: GOOGLE_CATEGORY },
    statusHints: {
      active: 'deployable',
      provisioned: 'deployable',
      'in pipeline': 'deployable',
      disabled: 'archived',
      deprovisioned: 'archived',
      retired: 'archived',
    },
    departmentPaths: true,
    setup: { category: GOOGLE_CATEGORY, customFields: GOOGLE_FIELDS },
    notes: [
      'Creating the import creates the Chromebook category and its custom fields if they do not exist yet.',
      'Status: Active and Provisioned map to your default deployable label; Disabled and Deprovisioned to Retired (your label of the archived type). Check the value mapping.',
      'The organisational unit becomes the department: "/Students/Grade 5" is the department "Students / Grade 5", or an existing department of that name or called "Grade 5". Unknown units are created as departments (this needs department:manage); map or skip them in the value mapping. No location is created from the unit; map a location column yourself if you want one.',
    ],
  },
];

export const presetOf = (key: string): Preset | undefined => PRESETS.find((p) => p.key === key);

/** The department an organisational-unit path stands for (ED-29; the API's `departmentForPath`). */
export function departmentForPath(
  path: string,
  departments: ReadonlyArray<{ id: string; name: string }>,
): { id: string } | { create: true; name: string } | { skip: true } | null {
  const key = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
  const parts = path
    .split('/')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (parts.length === 0) return path.trim() === '/' ? { skip: true } : null;
  const name = parts.join(' / ').slice(0, 200);
  const exact = departments.find((d) => key(d.name) === key(name));
  if (exact) return { id: exact.id };
  const last = departments.filter((d) => key(d.name) === key(parts[parts.length - 1]!));
  if (last.length === 1) return { id: last[0]!.id };
  return { create: true, name };
}

/** `GET /v1/imports/presets`: the data dictionary of one preset (column, target, description, required, example). */
export function dictionary(preset: Preset) {
  return preset.columns.map((col) => {
    const spec = specOf(preset.entity_type, col.target);
    return {
      column: col.headers[0]!,
      target: col.target,
      description:
        spec?.description ??
        (col.target.startsWith('cf:') ? `Custom field "${col.target.slice(3)}".` : ''),
      required: spec?.required
        ? 'yes'
        : col.target === 'category'
          ? 'yes (or a default category)'
          : 'no',
      example: spec?.example ?? '',
    };
  });
}

/** What the template file has: the header row (plus a `cf:<key>` column per custom field of an asset template), then the examples. */
export function templateRows(preset: Preset, customKeys: readonly string[]): string[][] {
  const extra = preset.entity_type === 'asset' && preset.source === 'csv' ? customKeys : [];
  return [
    [...preset.columns.map((col) => col.headers[0]!), ...extra.map((k) => `cf:${k}`)],
    ...preset.examples.map((example) => [...example, ...extra.map(() => '')]),
  ];
}

// ---- suggestions ------------------------------------------------------------------------------------------------

export interface Suggestion {
  index: number;
  target: string | null;
  /** 1 = the header names the field exactly; lower = a synonym. */
  confidence: number;
}

export interface CustomTarget {
  key: string;
  label: string;
}

/** The heuristic mapping of a file's headers: every target once, exact names first. */
export function suggestMapping(
  entity: EntityType,
  headers: readonly string[],
  custom: readonly CustomTarget[],
): Suggestion[] {
  const taken = new Set<string>();
  const out: Suggestion[] = headers.map((_, index) => ({ index, target: null, confidence: 0 }));
  const assign = (index: number, target: string, confidence: number) => {
    if (taken.has(target) || out[index]!.target) return;
    taken.add(target);
    out[index] = { index, target, confidence };
  };
  const specs = FIELD_SPECS[entity];
  // pass 1: the header is the field's key, label or template header; pass 2: a synonym
  headers.forEach((header, index) => {
    const wanted = looseKey(header);
    if (header.startsWith('cf:') && custom.some((x) => `cf:${x.key}` === header)) {
      assign(index, header, 1);
      return;
    }
    const spec = specs.find((s) => looseKey(s.key) === wanted || looseKey(s.label) === wanted);
    if (spec) assign(index, spec.key, 1);
  });
  headers.forEach((header, index) => {
    const wanted = looseKey(header);
    const spec = specs.find((s) => s.synonyms.some((syn) => looseKey(syn) === wanted));
    if (spec) assign(index, spec.key, 0.7);
  });
  if (entity === 'asset') {
    headers.forEach((header, index) => {
      const wanted = looseKey(header);
      const field = custom.find((x) => looseKey(x.label) === wanted || looseKey(x.key) === wanted);
      if (field) assign(index, `cf:${field.key}`, 0.8);
    });
  }
  return out;
}

// ---- reading cells -----------------------------------------------------------------------------------------------

export type DateFormat = 'auto' | 'iso' | 'dmy' | 'mdy';
export type NumberFormat = 'auto' | 'dot' | 'comma';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const validDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

export type DateResult = { iso: string } | { error: 'ambiguous-date' | 'date' };

/** Reads a date: ISO, month names and unambiguous day/month dates; `03/04/2024` needs `dmy` or `mdy`. */
export function readDate(value: string, format: DateFormat): DateResult {
  const text = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { error: 'date' };
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(text);
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    const [d, y] = [Number(m[1]), Number(m[3])];
    return mo > 0 && validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { error: 'date' };
  }
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m) {
    const mo = MONTHS.indexOf(m[1]!.toLowerCase()) + 1;
    const [d, y] = [Number(m[2]), Number(m[3])];
    return mo > 0 && validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { error: 'date' };
  }
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dmy = validDate(y, b, a);
    const mdy = validDate(y, a, b);
    const order: DateFormat =
      format === 'dmy' || format === 'mdy'
        ? format
        : a === b
          ? 'dmy'
          : a > 12 && dmy
            ? 'dmy'
            : b > 12 && mdy
              ? 'mdy'
              : dmy && mdy
                ? 'auto'
                : dmy
                  ? 'dmy'
                  : mdy
                    ? 'mdy'
                    : 'auto';
    if (order === 'auto') return { error: dmy || mdy ? 'ambiguous-date' : 'date' };
    const [mo, d] = order === 'dmy' ? [b, a] : [a, b];
    return validDate(y, mo, d) ? { iso: `${y}-${pad(mo)}-${pad(d)}` } : { error: 'date' };
  }
  return { error: 'date' };
}

/** Reads a number: `1.234,50`, `1,234.50` and `1234.5`; `1,234` is a thousand unless the format says comma. */
export function readNumber(value: string, format: NumberFormat): number | null {
  let text = value
    .trim()
    .replace(/[\s\u00a0]/g, '')
    .replace(/^[^\d+-]+/, '');
  if (!/^[+-]?[\d.,]+$/.test(text)) return null;
  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  if (format === 'comma') text = text.replace(/\./g, '').replace(',', '.');
  else if (format === 'dot') text = text.replace(/,/g, '');
  else if (dots > 0 && commas > 0) {
    text =
      text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else if (commas > 0)
    text = commas > 1 || /,\d{3}$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');
  else if (dots > 1) text = text.replace(/\./g, '');
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// ---- profile ---------------------------------------------------------------------------------------------------------

export type ColumnType = 'empty' | 'integer' | 'number' | 'date' | 'boolean' | 'email' | 'text';
export type DateOrder = 'iso' | 'dmy' | 'mdy' | 'ambiguous' | 'mixed' | null;

export interface ColumnProfile {
  index: number;
  header: string;
  non_blank: number;
  blank: number;
  distinct: number;
  distinct_capped: boolean;
  duplicates: number;
  type: ColumnType;
  date_order: DateOrder;
  max_length: number;
  samples: string[];
}

const ISO = /^\d{4}-\d{1,2}-\d{1,2}$/;
const SLASH = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

function dateOrderOf(values: string[]): DateOrder {
  let iso = 0;
  let dmy = false;
  let mdy = false;
  let slashed = 0;
  for (const v of values) {
    if (ISO.test(v)) {
      iso += 1;
      continue;
    }
    const m = SLASH.exec(v);
    if (!m) continue;
    slashed += 1;
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  if (iso > 0 && slashed === 0) return 'iso';
  if (iso > 0 && slashed > 0) return 'mixed';
  if (dmy && mdy) return 'mixed';
  if (dmy) return 'dmy';
  if (mdy) return 'mdy';
  return 'ambiguous';
}

function typeOf(values: string[]): ColumnType {
  if (values.length === 0) return 'empty';
  if (values.every((v) => /^(true|false|yes|no)$/i.test(v))) return 'boolean';
  if (values.every((v) => /^[+-]?\d+$/.test(v) && !/^0\d/.test(v))) return 'integer';
  if (values.every((v) => readNumber(v, 'auto') !== null && /^[+-]?[\d.,]+$/.test(v)))
    return 'number';
  if (
    values.every(
      (v) =>
        ISO.test(v) || SLASH.test(v) || 'iso' in readDate(v, 'dmy') || 'iso' in readDate(v, 'mdy'),
    )
  )
    return 'date';
  if (values.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';
  return 'text';
}

export function profileOf(headers: readonly string[], rows: readonly string[][]): ColumnProfile[] {
  return headers.map((header, index) => {
    const cells = rows.map((r) => (r[index] ?? '').trim());
    const filled = cells.filter((v) => v !== '');
    const seen = new Set<string>();
    let duplicates = 0;
    for (const v of filled) {
      if (seen.has(v)) duplicates += 1;
      seen.add(v);
    }
    const type = typeOf(filled);
    return {
      index,
      header,
      non_blank: filled.length,
      blank: cells.length - filled.length,
      distinct: seen.size,
      distinct_capped: false,
      duplicates,
      type,
      date_order: type === 'date' ? dateOrderOf(filled) : null,
      max_length: filled.reduce((max, v) => Math.max(max, v.length), 0),
      samples: [...seen].slice(0, 5),
    };
  });
}

// ---- XLSX (a minimal workbook for the template download) -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const xml = (text: string) =>
  text.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch]!);

const columnName = (index: number): string => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

const sheetXml = (rows: ReadonlyArray<ReadonlyArray<string>>) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((cell, i) =>
            cell === ''
              ? ''
              : `<c r="${columnName(i)}${r + 1}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`;

/** A workbook with one sheet per entry (stored, not compressed: a valid file any spreadsheet opens). */
export function buildXlsx(sheets: ReadonlyArray<{ name: string; rows: string[][] }>): Uint8Array {
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const enc = new TextEncoder();
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });
  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('')}</Types>`,
  );
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
  );
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.data.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
