import type { components } from '@assettracker/api-client';
import { MOCK_ACCOUNTS } from './fixtures';
import { DEPARTMENT_SEED, seedCustody } from './m2-fixtures';

/**
 * Seed data of the mock registry: categories with custom fields, manufacturers, models, status
 * labels, vendors, locations, ~200 assets, users and roles. Deterministic (no `Math.random`), so
 * unit tests and Playwright can rely on specific tags (`AT-00124`, `LAP-00007`, ...).
 */
type S = components['schemas'];

/** A stored resource: the contract object plus an internal version that drives the ETag. */
export type Rec<T> = { -readonly [K in keyof T]: T[K] } & { _v: number };

export type MockAsset = Rec<S['Asset']>;
export type MockCategory = Rec<S['Category']>;
export type MockField = Rec<S['CustomFieldDef']>;
export type MockStatus = Rec<S['StatusLabel']>;
export type MockManufacturer = Rec<S['Manufacturer']>;
export type MockModel = Rec<S['AssetModel']>;
export type MockVendor = Rec<S['Vendor']>;
export type MockLocation = Rec<S['Location']>;
export type MockUserRecord = Rec<S['User']> & { invitation_expires_at?: string };
/** `_system`: the person the system made for a login account (the API's `created_by` null), which linking replaces. */
export type MockPerson = Rec<S['Person']> & { _system?: boolean };
export type MockDepartment = Rec<S['Department']>;
export type MockAssignment = Rec<S['Assignment']>;
/** An attachment plus what the mock storage and scanner know about it. */
export type MockAttachment = Rec<S['Attachment']> & {
  /** Bytes the mock storage received through the presigned PUT (undefined until uploaded). */
  stored_bytes?: number;
  /** When the (simulated) virus scan answers; `null` = never (stays pending). */
  scan_due_at?: number | null;
  /** What the scan answers when it is due. */
  scan_result?: 'clean' | 'infected';
  /** Soft delete (`DELETE /v1/attachments/{id}`). */
  archived_at?: string | null;
};

/** The stored files settings; the effective cap is derived on read (`tier_max_upload_bytes` is the plan's). */
export interface MockFilesSettings {
  strip_exif_original: boolean;
  max_upload_bytes: number | null;
  tier_max_upload_bytes: number;
  /** The ETag of the settings (the tenant row version). */
  version: number;
}

export interface RegistryData {
  categories: MockCategory[];
  customFields: MockField[];
  statusLabels: MockStatus[];
  manufacturers: MockManufacturer[];
  models: MockModel[];
  vendors: MockVendor[];
  locations: MockLocation[];
  /** Managed departments (ED-17). */
  departments: MockDepartment[];
  assets: MockAsset[];
  users: MockUserRecord[];
  people: MockPerson[];
  assignments: MockAssignment[];
  attachments: MockAttachment[];
  history: S['HistoryEvent'][];
  /** `GET/PUT /v1/settings/files`: the organisation's plan cap and its own override. */
  filesSettings: MockFilesSettings;
  /** Next tag number per full tag prefix (template prefix + category prefix), as the API counts. */
  tagCounters: Record<string, number>;
  /** The tenant's tag numbering template and its settings version (the ETag of the template). */
  tagTemplate: { prefix: string; width: number; use_category_prefix: boolean };
  settingsVersion: number;
}

const KIND_CODE = {
  category: '0001',
  field: '0002',
  status: '0003',
  manufacturer: '0004',
  model: '0005',
  vendor: '0006',
  location: '0007',
  asset: '0008',
  history: '0009',
  role: '0010',
  person: '0011',
  assignment: '0012',
  attachment: '0013',
  department: '0014',
  roleAssignment: '0015',
} as const;

type Kind = keyof typeof KIND_CODE;

export function uid(kind: Kind, n: number): string {
  return `0190a6b2-${KIND_CODE[kind]}-7000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * Ids a created resource gets (kept apart from the seeded ranges). A well-formed UUID: the API
 * validates ids with `z.uuid()`, so the last group stays at 12 digits.
 */
let created = 0;
export function newResourceId(kind: Kind): string {
  created += 1;
  return uid(kind, 800_000_000_000 + (Date.now() % 100_000_000_000) + created);
}

// ---- roles ---------------------------------------------------------------------------------

/** Read permissions every built-in role holds (mirrors READ in apps/api/src/auth/permissions.ts). */
const READ = [
  'asset:read',
  'catalog:read',
  'location:read',
  'person:read',
  'accessory:read',
  'consumable:read',
  'loaner:read',
  'repair:read',
  'import:read',
  'attachment:read',
  'company:read',
  'search:read',
  'department:read',
];

/** The built-in roles with the permission bundles of apps/api/src/auth/permissions.ts. */
export const MOCK_ROLES: S['Role'][] = [
  {
    id: uid('role', 1),
    key: 'tenant_admin',
    name: 'Administrator',
    description: 'Full access to everything in the organisation.',
    permissions: ['*'],
    is_builtin: true,
  },
  {
    id: uid('role', 2),
    key: 'asset_manager',
    name: 'Asset Manager',
    description: 'Manages the asset registry and catalogue.',
    permissions: [
      ...READ,
      'asset:create',
      'asset:update',
      'asset:delete',
      'asset:checkout',
      'asset:checkin',
      'asset:transfer',
      'asset:label',
      'catalog:manage',
      'location:manage',
      'person:manage',
      'accessory:manage',
      'accessory:checkout',
      'consumable:manage',
      'consumable:adjust',
      'loaner:manage',
      'loaner:checkout',
      'repair:manage',
      'import:run',
      'attachment:write',
      'audit:read',
      'user:read',
      'role:read',
      'view:share',
      'export:run',
      'department:manage',
    ],
    is_builtin: true,
  },
  {
    id: uid('role', 3),
    key: 'technician',
    name: 'Technician',
    description: 'Checks assets in and out and logs repairs.',
    permissions: [
      ...READ,
      'asset:update',
      'asset:checkout',
      'asset:checkin',
      'asset:transfer',
      'asset:label',
      'accessory:checkout',
      'consumable:adjust',
      'loaner:checkout',
      'repair:manage',
      'attachment:write',
    ],
    is_builtin: true,
  },
  {
    id: uid('role', 4),
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access including the audit log.',
    permissions: [...READ, 'audit:read', 'user:read', 'role:read'],
    is_builtin: true,
  },
  {
    id: uid('role', 5),
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to assets.',
    permissions: [...READ],
    is_builtin: true,
  },
];

export function roleIdFor(key: string): string {
  return (MOCK_ROLES.find((role) => role.key === key) ?? MOCK_ROLES[4]!).id;
}

/** A stored role assignment as the API returns it (`roleAssignmentDto`): every field present. */
export function roleAssignmentView(
  a: Partial<S['RoleAssignment']> & { role_id: string },
  id: string,
): S['RoleAssignment'] {
  return {
    id,
    role_id: a.role_id,
    scope_type: a.scope_type ?? 'tenant',
    company_id: a.company_id ?? null,
    location_id: a.location_id ?? null,
  };
}

// ---- deterministic helpers -------------------------------------------------------------------

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = Date.UTC(2026, 10, 17, 9, 0, 0);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const dateOnly = (ms: number) => iso(ms).slice(0, 10);
const pad5 = (n: number) => String(n).padStart(5, '0');

export function formatTag(prefix: string | null | undefined, n: number): string {
  return `${prefix || 'AT-'}${pad5(n)}`;
}

// ---- the seed ----------------------------------------------------------------------------------

export function buildSeed(): RegistryData {
  const rand = rng(20261117);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

  const stamp = { created_at: iso(NOW - 400 * DAY), updated_at: iso(NOW - 30 * DAY) };
  const base = <T extends object>(extra: T): Rec<T> => ({ ...extra, ...stamp, _v: 1 }) as Rec<T>;

  const catDefs = [
    { name: 'Chromebook', prefix: 'AT-', description: 'Student and staff Chromebooks.' },
    { name: 'Laptop', prefix: 'LAP-', description: 'Windows and macOS laptops.' },
    { name: 'Tablet', prefix: 'TAB-', description: 'iPads and Android tablets.' },
    { name: 'Projector', prefix: 'PRJ-', description: 'Classroom projectors.' },
  ];
  const categories: MockCategory[] = catDefs.map((c, i) =>
    base({
      id: uid('category', i + 1),
      name: c.name,
      kind: 'asset' as const,
      tag_prefix: c.prefix,
      description: c.description,
      archived_at: null,
    }),
  );
  categories.push(
    base({
      id: uid('category', 9),
      name: 'Chargers',
      kind: 'accessory' as const,
      tag_prefix: null,
      description: null,
      archived_at: null,
    }),
  );
  categories.push(
    base({
      id: uid('category', 10),
      name: 'Paper and supplies',
      kind: 'consumable' as const,
      tag_prefix: null,
      description: null,
      archived_at: null,
    }),
  );
  const [chromebook, laptop, tablet, projector] = categories as [
    MockCategory,
    MockCategory,
    MockCategory,
    MockCategory,
  ];

  let fieldN = 0;
  const field = (
    categoryId: string | null,
    key: string,
    label: string,
    data_type: S['CustomFieldDef']['data_type'],
    extra: Partial<S['CustomFieldDef']> = {},
  ): MockField => {
    fieldN += 1;
    return base({
      id: uid('field', fieldN),
      category_id: categoryId,
      key,
      label,
      data_type,
      required: false,
      options: null,
      validation: null,
      help_text: null,
      position: fieldN,
      show_in_list: false,
      archived_at: null,
      ...extra,
    });
  };
  const conditionOptions = [
    { value: 'good', label: 'Good' },
    { value: 'fair', label: 'Fair' },
    { value: 'poor', label: 'Poor' },
  ];
  const customFields: MockField[] = [
    field(null, 'condition', 'Condition', 'select', { options: conditionOptions }),
    field(chromebook.id, 'screen_size', 'Screen size (in)', 'number', {
      validation: { min: 5, max: 20 },
      show_in_list: true,
      help_text: 'Diagonal size in inches.',
    }),
    field(chromebook.id, 'os_version', 'OS version', 'text', { required: true }),
    field(chromebook.id, 'managed', 'Managed', 'boolean'),
    field(chromebook.id, 'enrollment_date', 'Enrollment date', 'date'),
    field(chromebook.id, 'admin_url', 'Admin console URL', 'url'),
    field(chromebook.id, 'accessories', 'Accessories', 'multiselect', {
      options: [
        { value: 'charger', label: 'Charger' },
        { value: 'case', label: 'Case' },
        { value: 'stylus', label: 'Stylus' },
      ],
    }),
    field(laptop.id, 'ram_gb', 'Memory (GB)', 'number', { validation: { min: 1, max: 512 } }),
    field(laptop.id, 'cpu', 'Processor', 'text'),
    field(tablet.id, 'storage_gb', 'Storage (GB)', 'number'),
    field(tablet.id, 'imei', 'IMEI', 'text', { validation: { pattern: '^[0-9]{15}$' } }),
    field(projector.id, 'lamp_hours', 'Lamp hours', 'number', { show_in_list: true }),
  ];

  const mfrNames = ['Dell', 'Lenovo', 'HP', 'Apple', 'Samsung', 'Epson'];
  const manufacturers: MockManufacturer[] = mfrNames.map((name, i) =>
    base({
      id: uid('manufacturer', i + 1),
      name,
      url: `https://www.${name.toLowerCase()}.com`,
      support_url: null,
      support_email: null,
      support_phone: null,
      notes: null,
      archived_at: null,
    }),
  );
  const mfr = (name: string) => manufacturers.find((m) => m.name === name)!;

  const modelDefs: Array<[string, string, MockCategory, string, number | null]> = [
    ['Dell', 'Chromebook 3100', chromebook, '3100', 36],
    ['Lenovo', '300e Chromebook Gen 3', chromebook, '82J9', 36],
    ['HP', 'Chromebook 11 G9', chromebook, 'G9-EE', 36],
    ['Dell', 'Latitude 5440', laptop, '5440', 48],
    ['Lenovo', 'ThinkPad T14', laptop, 'T14-G4', 48],
    ['Apple', 'MacBook Air M2', laptop, 'A2681', 48],
    ['Apple', 'iPad 9th gen', tablet, 'A2602', 36],
    ['Samsung', 'Galaxy Tab A8', tablet, 'SM-X200', 36],
    ['Epson', 'EB-X49', projector, 'V11H982', 60],
    ['Epson', 'EB-992F', projector, 'V11H988', 60],
  ];
  const models: MockModel[] = modelDefs.map(([m, name, cat, number, months], i) =>
    base({
      id: uid('model', i + 1),
      category_id: cat.id,
      manufacturer_id: mfr(m).id,
      name,
      model_number: number,
      default_depreciation_months: months,
      eol_date: i % 3 === 0 ? '2029-06-30' : null,
      notes: null,
      archived_at: null,
    }),
  );

  const statusDefs: Array<[string, S['StatusLabel']['state_type'], boolean]> = [
    ['Ready', 'deployable', true],
    ['Deployed', 'deployed', false],
    ['Pending setup', 'pending', false],
    ['Out for fix', 'undeployable', false],
    ['Retired', 'archived', false],
    ['Missing', 'lost', false],
  ];
  const statusLabels: MockStatus[] = statusDefs.map(([name, state_type, isDefault], i) =>
    base({
      id: uid('status', i + 1),
      name,
      state_type,
      color: null,
      description: null,
      position: i,
      is_default: isDefault,
      archived_at: null,
    }),
  );
  const status = (name: string) => statusLabels.find((s) => s.name === name)!;

  const vendors: MockVendor[] = ['CDW', 'Insight', 'Amazon Business'].map((name, i) =>
    base({
      id: uid('vendor', i + 1),
      name,
      contact_name: i === 0 ? 'Dana Reyes' : null,
      contact_email: i === 0 ? 'dana.reyes@cdw.example' : null,
      phone: null,
      url: null,
      address: null,
      notes: null,
      archived_at: null,
    }),
  );

  const locDefs: Array<[string, S['Location']['kind'], number | null]> = [
    ['Riverside Elementary', 'site', null], // 1
    ['Main building', 'building', 1], // 2
    ['Room 101', 'room', 2], // 3
    ['Room 204', 'room', 2], // 4
    ['Gym', 'room', 2], // 5
    ['Repairs', 'storage', 2], // 6
    ['Storage', 'storage', 2], // 7
  ];
  const locations: MockLocation[] = locDefs.map(([name, kind, parent], i) => {
    const parentId = parent ? uid('location', parent) : null;
    const ancestors: string[] = [];
    let cursor = parent;
    while (cursor) {
      ancestors.unshift(uid('location', cursor));
      cursor = locDefs[cursor - 1]![2];
    }
    return base({
      id: uid('location', i + 1),
      parent_id: parentId,
      name,
      kind,
      code: null,
      depth: ancestors.length,
      ancestor_ids: [...ancestors, uid('location', i + 1)],
      archived_at: null,
    });
  });
  const rooms = [3, 4, 5, 7].map((n) => uid('location', n));

  // the managers are people of the seed (Alice Owner is person 1, Sam Lee person 2)
  const departments: MockDepartment[] = DEPARTMENT_SEED.map((d, i) =>
    base({
      id: uid('department', i + 1),
      name: d.name,
      code: d.code,
      description: d.description,
      manager_person_id: i === 0 ? uid('person', 1) : i === 3 ? uid('person', 2) : null,
      archived_at: null,
    }),
  );

  // ---- assets: 130 Chromebooks (AT-), 40 laptops, 20 tablets, 10 projectors -----------------
  const plan: Array<[MockCategory, number]> = [
    [chromebook, 130],
    [laptop, 40],
    [tablet, 20],
    [projector, 10],
  ];
  const assets: MockAsset[] = [];
  const history: S['HistoryEvent'][] = [];
  const tagCounters: Record<string, number> = {};
  const statusMix = [
    'Ready',
    'Ready',
    'Ready',
    'Ready',
    'Deployed',
    'Deployed',
    'Deployed',
    'Ready',
    'Out for fix',
    'Pending setup',
    'Retired',
    'Missing',
    'Ready',
    'Deployed',
  ];
  let seq = 0;
  let historyN = 0;
  for (const [category, count] of plan) {
    const catModels = models.filter((m) => m.category_id === category.id);
    for (let n = 1; n <= count; n += 1) {
      seq += 1;
      const model = catModels[(n - 1) % catModels.length]!;
      const label = status(pick(statusMix));
      const purchaseMs = NOW - Math.floor(rand() * 1100) * DAY - 30 * DAY;
      const createdMs = NOW - (260 - seq) * 0.9 * DAY;
      const customData: Record<string, unknown> = {};
      if (rand() < 0.8) customData.condition = pick(['good', 'good', 'fair', 'poor']);
      if (category === chromebook) {
        customData.screen_size = pick([11.6, 11.6, 14]);
        customData.os_version = `ChromeOS ${pick([124, 125, 126])}`;
        customData.managed = rand() < 0.9;
        if (rand() < 0.5) customData.enrollment_date = dateOnly(purchaseMs + 3 * DAY);
        if (rand() < 0.3) customData.admin_url = 'https://admin.example.org/devices';
        if (rand() < 0.4) customData.accessories = ['charger'];
      } else if (category === laptop) {
        customData.ram_gb = pick([8, 16, 32]);
        customData.cpu = pick(['Core i5', 'Core i7', 'Apple M2']);
      } else if (category === tablet) {
        customData.storage_gb = pick([64, 128, 256]);
      } else {
        customData.lamp_hours = Math.floor(rand() * 4000);
      }
      const archived = seq % 37 === 0;
      const asset: MockAsset = {
        id: uid('asset', seq),
        created_at: iso(createdMs),
        updated_at: iso(createdMs + DAY),
        archived_at: archived ? iso(NOW - 3 * DAY) : null,
        asset_tag: formatTag(category.tag_prefix, n),
        name: model.name,
        serial: `SN${(1_000_000 + seq * 7919).toString(36).toUpperCase()}`,
        category_id: category.id,
        model_id: model.id,
        status_id: label.id,
        location_id: pick(rooms),
        // two in three assets belong to a department (the API seed does the same)
        department_id:
          seq % 3 === 0
            ? null
            : uid('department', ((seq + Math.floor(seq / 3)) % DEPARTMENT_SEED.length) + 1),
        vendor_id: rand() < 0.7 ? pick(vendors).id : null,
        parent_asset_id: null,
        purchase_date: dateOnly(purchaseMs),
        purchase_cost: {
          amount_minor: pick([28_900, 28_900, 64_900, 119_900, 34_900]),
          currency: 'USD',
        },
        order_number: rand() < 0.6 ? `PO-${4000 + seq}` : null,
        warranty_end: dateOnly(purchaseMs + 3 * 365 * DAY),
        notes: null,
        custom_data: customData,
        label_code: `LBL${pad5(seq)}`,
        current_assignment: null,
        _v: 1,
      };
      assets.push(asset);
      historyN += 1;
      history.push({
        id: uid('history', historyN),
        asset_id: asset.id,
        at: asset.created_at!,
        event_type: 'created',
        actor_type: 'user',
        actor_id: '0190a6b2-0000-7000-8000-000000000001',
        assignment_id: null,
        transfer_id: null,
        summary: `Asset ${asset.asset_tag} created`,
        payload: { status_id: asset.status_id, location_id: asset.location_id },
      });
      tagCounters[category.tag_prefix || 'AT-'] = n + 1;
    }
  }

  // ---- users ---------------------------------------------------------------------------------
  const userBase = (extra: object) => ({ ...stamp, _v: 1, archived_at: null, ...extra });
  const users: MockUserRecord[] = [
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000001',
      email: MOCK_ACCOUNTS.owner,
      display_name: 'Alice Owner',
      status: 'active',
      role_assignments: [{ role_id: roleIdFor('tenant_admin'), scope_type: 'tenant' }],
      mfa_enabled: false,
      last_login_at: iso(NOW - 2 * 3_600_000),
    }),
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000002',
      email: MOCK_ACCOUNTS.mfaOwner,
      display_name: 'Marco Secure',
      status: 'active',
      role_assignments: [{ role_id: roleIdFor('tenant_admin'), scope_type: 'tenant' }],
      mfa_enabled: true,
      last_login_at: iso(NOW - 26 * 3_600_000),
    }),
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000003',
      email: MOCK_ACCOUNTS.viewer,
      display_name: 'Vera Viewer',
      status: 'active',
      role_assignments: [{ role_id: roleIdFor('viewer'), scope_type: 'tenant' }],
      mfa_enabled: false,
      last_login_at: iso(NOW - 5 * DAY),
    }),
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000007',
      email: MOCK_ACCOUNTS.manager,
      display_name: 'Sam Lee',
      status: 'active',
      role_assignments: [{ role_id: roleIdFor('asset_manager'), scope_type: 'tenant' }],
      mfa_enabled: false,
      last_login_at: iso(NOW - DAY),
    }),
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000008',
      email: 'priya.patel@example.org',
      display_name: 'Priya Patel',
      status: 'active',
      role_assignments: [{ role_id: roleIdFor('technician'), scope_type: 'tenant' }],
      mfa_enabled: true,
      last_login_at: iso(NOW - 3 * DAY),
    }),
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000009',
      email: 'jordan.invited@example.org',
      display_name: 'Jordan Invited',
      status: 'invited',
      role_assignments: [{ role_id: roleIdFor('asset_manager'), scope_type: 'tenant' }],
      mfa_enabled: false,
      last_login_at: null,
      invitation_expires_at: iso(NOW + 5 * DAY),
    }),
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000010',
      email: 'sasha.waiting@example.org',
      display_name: 'Sasha Waiting',
      status: 'invited',
      role_assignments: [{ role_id: roleIdFor('auditor'), scope_type: 'tenant' }],
      mfa_enabled: false,
      last_login_at: null,
      invitation_expires_at: iso(NOW - DAY),
    }),
    // M2-LOC-03: a technician limited to Room 101 and everything below it
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000011',
      email: MOCK_ACCOUNTS.scopedTechnician,
      display_name: 'Theo Scoped',
      status: 'active',
      role_assignments: [
        { role_id: roleIdFor('technician'), scope_type: 'location', location_id: rooms[0] },
      ],
      mfa_enabled: false,
      last_login_at: iso(NOW - 4 * DAY),
    }),
    // ... and an Administrator limited to Main building (a location administrator)
    userBase({
      id: '0190a6b2-0000-7000-8000-000000000012',
      email: MOCK_ACCOUNTS.scopedAdmin,
      display_name: 'Lara Local',
      status: 'active',
      role_assignments: [
        {
          role_id: roleIdFor('tenant_admin'),
          scope_type: 'location',
          location_id: uid('location', 2),
        },
      ],
      mfa_enabled: false,
      last_login_at: iso(NOW - 6 * DAY),
    }),
  ] as MockUserRecord[];
  // every assignment as the API returns it: its id, and company_id / location_id always present
  let assignmentN = 0;
  for (const user of users) {
    user.role_assignments = user.role_assignments.map((a) => {
      assignmentN += 1;
      return roleAssignmentView(a, uid('roleAssignment', assignmentN));
    });
  }

  const custody = seedCustody({
    assets,
    statusLabels,
    users,
    locationIds: rooms,
    assetHistoryStart: historyN,
  });
  history.push(...custody.history);

  return {
    categories,
    customFields,
    statusLabels,
    manufacturers,
    models,
    vendors,
    locations,
    departments,
    assets,
    users,
    people: custody.people,
    assignments: custody.assignments,
    attachments: custody.attachments,
    history,
    // the mock organisation is on the 25 MiB plan (`TIER_MAX_BYTES.starter` of the API)
    filesSettings: {
      strip_exif_original: false,
      max_upload_bytes: null,
      tier_max_upload_bytes: 25 * 1024 * 1024,
      version: 1,
    },
    tagCounters,
    tagTemplate: { prefix: '', width: 5, use_category_prefix: true },
    settingsVersion: 1,
  };
}
