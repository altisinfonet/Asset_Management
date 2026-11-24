import { seedDemoLogins } from '../auth/index.js';
import { addUser, bootstrapTenant } from '../bootstrap/bootstrap-tenant.js';
import { uuidv7 } from '../ids/uuidv7.js';
import type { SecretBox } from '../ports/index.js';
import type { Prisma, TenancyService, Tx } from '../tenancy/index.js';

export interface SeedTenantSpec {
  name: string;
  slug: string;
  /** Local part of the demo addresses: owner@<domain>, admin@<domain>, ... */
  domain: string;
}

export const DEMO_TENANTS: SeedTenantSpec[] = [
  { name: 'Acme', slug: 'acme', domain: 'acme.example' },
  { name: 'Globex', slug: 'globex', domain: 'globex.example' },
];

export const ASSETS_PER_TENANT = 200;

export interface SeedLogger {
  info(msg: string): void;
}

export class SeedRefusedError extends Error {
  constructor() {
    super('seed refuses to run when NODE_ENV=production');
    this.name = 'SeedRefusedError';
  }
}

// Same names, tags and serials in every tenant on purpose: per-tenant uniqueness bugs and
// cross-tenant leaks surface immediately (M1-REPO-05).
interface ModelSeed {
  category: string;
  manufacturer: string;
  name: string;
  model_number: string;
  /** purchase price in minor units (USD cents) */
  price: number;
  /** relative share of the 200 assets */
  weight: number;
  eol?: string;
}

const MODELS: ModelSeed[] = [
  {
    category: 'Laptops',
    manufacturer: 'Dell',
    name: 'Latitude 7440',
    model_number: '7440',
    price: 149900,
    weight: 14,
  },
  {
    category: 'Laptops',
    manufacturer: 'Dell',
    name: 'Latitude 5440',
    model_number: '5440',
    price: 119900,
    weight: 12,
  },
  {
    category: 'Laptops',
    manufacturer: 'Apple',
    name: 'MacBook Pro 14',
    model_number: 'A2992',
    price: 199900,
    weight: 9,
  },
  {
    category: 'Laptops',
    manufacturer: 'Apple',
    name: 'MacBook Air 13',
    model_number: 'A3113',
    price: 109900,
    weight: 8,
  },
  {
    category: 'Laptops',
    manufacturer: 'Lenovo',
    name: 'ThinkPad T14',
    model_number: 'T14G4',
    price: 129900,
    weight: 10,
  },
  {
    category: 'Laptops',
    manufacturer: 'HP',
    name: 'EliteBook 840 G10',
    model_number: '840G10',
    price: 139900,
    weight: 6,
  },
  {
    category: 'Desktops',
    manufacturer: 'Dell',
    name: 'OptiPlex 7010',
    model_number: '7010',
    price: 89900,
    weight: 6,
  },
  {
    category: 'Desktops',
    manufacturer: 'HP',
    name: 'EliteDesk 800 G9',
    model_number: '800G9',
    price: 94900,
    weight: 4,
  },
  {
    category: 'Monitors',
    manufacturer: 'Dell',
    name: 'UltraSharp U2723QE',
    model_number: 'U2723QE',
    price: 62900,
    weight: 10,
  },
  {
    category: 'Monitors',
    manufacturer: 'LG',
    name: '27UP850',
    model_number: '27UP850-W',
    price: 44900,
    weight: 6,
  },
  {
    category: 'Monitors',
    manufacturer: 'Samsung',
    name: 'ViewFinity S8',
    model_number: 'S27B800',
    price: 39900,
    weight: 3,
  },
  {
    category: 'Phones and tablets',
    manufacturer: 'Apple',
    name: 'iPhone 15',
    model_number: 'A3090',
    price: 79900,
    weight: 5,
  },
  {
    category: 'Phones and tablets',
    manufacturer: 'Apple',
    name: 'iPad 10th gen',
    model_number: 'A2696',
    price: 44900,
    weight: 3,
  },
  {
    category: 'Phones and tablets',
    manufacturer: 'Samsung',
    name: 'Galaxy S24',
    model_number: 'SM-S921B',
    price: 79900,
    weight: 2,
  },
  {
    category: 'Peripherals',
    manufacturer: 'Logitech',
    name: 'MX Keys',
    model_number: '920-009295',
    price: 11900,
    weight: 4,
  },
  {
    category: 'Peripherals',
    manufacturer: 'Logitech',
    name: 'MX Master 3S',
    model_number: '910-006556',
    price: 9900,
    weight: 3,
  },
  {
    category: 'Network equipment',
    manufacturer: 'Ubiquiti',
    name: 'UniFi U6 Pro',
    model_number: 'U6-PRO',
    price: 14900,
    weight: 2,
  },
  {
    category: 'Network equipment',
    manufacturer: 'Cisco',
    name: 'Catalyst 1000-24T',
    model_number: 'C1000-24T',
    price: 119900,
    weight: 1,
    eol: '2031-06-30',
  },
];

const VENDORS = [
  {
    name: 'CDW',
    contact_name: 'Priya Raman',
    contact_email: 'sales@cdw.example',
    url: 'https://www.cdw.com',
  },
  {
    name: 'Insight',
    contact_name: 'Tom Becker',
    contact_email: 'accounts@insight.example',
    url: 'https://www.insight.com',
  },
  {
    name: 'Apple Business',
    contact_name: null,
    contact_email: null,
    url: 'https://www.apple.com/business',
  },
  {
    name: 'Amazon Business',
    contact_name: null,
    contact_email: null,
    url: 'https://business.amazon.com',
  },
];

/** Status label names in the order of the distribution below (the 7 labels every tenant starts with). */
const STATUS_WEIGHTS: Array<[string, number]> = [
  ['Ready to deploy', 24],
  ['Deployed', 52],
  ['Pending', 5],
  ['In repair', 5],
  ['Broken', 2],
  ['Retired', 10],
  ['Lost or stolen', 2],
];

interface FieldSeed {
  key: string;
  label: string;
  data_type: 'text' | 'number' | 'select' | 'multiselect' | 'boolean' | 'date';
  options?: string[];
  validation?: Record<string, unknown>;
  help_text?: string;
  required?: boolean;
  show_in_list?: boolean;
}
const FIELDS_BY_CATEGORY: Record<string, FieldSeed[]> = {
  Laptops: [
    {
      key: 'os',
      label: 'Operating system',
      data_type: 'select',
      options: ['macOS', 'Windows 11', 'Ubuntu'],
      show_in_list: true,
    },
    {
      key: 'ram_gb',
      label: 'RAM (GB)',
      data_type: 'number',
      validation: { min: 1, max: 1024, integer: true },
      show_in_list: true,
    },
    {
      key: 'storage_gb',
      label: 'Storage (GB)',
      data_type: 'number',
      validation: { min: 1, integer: true },
    },
    {
      key: 'encrypted',
      label: 'Disk encrypted',
      data_type: 'boolean',
      help_text: 'FileVault or BitLocker is on.',
    },
  ],
  Desktops: [
    {
      key: 'ram_gb',
      label: 'RAM (GB)',
      data_type: 'number',
      validation: { min: 1, max: 1024, integer: true },
    },
  ],
  Monitors: [
    {
      key: 'screen_size_in',
      label: 'Screen size (in)',
      data_type: 'number',
      validation: { min: 10, max: 100 },
      show_in_list: true,
    },
    {
      key: 'resolution',
      label: 'Resolution',
      data_type: 'select',
      options: ['1920x1080', '2560x1440', '3840x2160'],
    },
  ],
  'Phones and tablets': [
    {
      key: 'imei',
      label: 'IMEI',
      data_type: 'text',
      validation: { pattern: '^[0-9]{15}$' },
      help_text: '15 digits.',
    },
    {
      key: 'carrier',
      label: 'Carrier',
      data_type: 'select',
      options: ['Verizon', 'AT&T', 'T-Mobile', 'None (Wi-Fi only)'],
    },
  ],
  'Network equipment': [
    {
      key: 'mac_address',
      label: 'MAC address',
      data_type: 'text',
      validation: { pattern: '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' },
    },
    { key: 'firmware', label: 'Firmware', data_type: 'text', validation: { max_length: 40 } },
  ],
};
const GLOBAL_FIELDS: FieldSeed[] = [
  {
    key: 'cost_center',
    label: 'Cost center',
    data_type: 'text',
    validation: { max_length: 40 },
    show_in_list: true,
  },
];

/** Deterministic pseudo-random numbers: both demo tenants get identical data. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/**
 * Creates the two demo tenants "Acme" and "Globex" with an Owner, an Admin, a Technician and a
 * Viewer each, default status labels and categories, manufacturers, models, custom field
 * definitions and 200 assets (every asset in the "In repair" status has an open repair record). Idempotent: a tenant that already has assets is left untouched.
 * Refuses to run in production.
 */
export async function seedDemoData(
  tenancy: TenancyService,
  options: {
    nodeEnv?: string;
    logger?: SeedLogger;
    secretBox?: SecretBox;
    /** Which tenants to seed (default: the demo tenants Acme and Globex). Tests pass their own, so they never depend on, or change, the shared demo data. */
    tenants?: SeedTenantSpec[];
  } = {},
): Promise<{ tenants: Array<{ slug: string; tenantId: string; seeded: boolean }> }> {
  if ((options.nodeEnv ?? process.env.NODE_ENV) === 'production') throw new SeedRefusedError();
  const log = options.logger ?? { info: () => undefined };

  const tenants: Array<{ slug: string; tenantId: string; seeded: boolean }> = [];
  for (const spec of options.tenants ?? DEMO_TENANTS) {
    const boot = await bootstrapTenant(tenancy, {
      name: spec.name,
      slug: spec.slug,
      adminEmail: `owner@${spec.domain}`,
      adminName: `${spec.name} Owner`,
    });
    const seeded = await tenancy.withTenantTx({ tenantId: boot.tenantId }, (trx) =>
      seedTenantData(trx, boot.tenantId, spec),
    );
    log.info(
      `${spec.slug}: tenant ${boot.tenantId} ${seeded ? 'seeded' : 'already seeded, left unchanged'}`,
    );
    tenants.push({ slug: spec.slug, tenantId: boot.tenantId, seeded });
  }
  if (options.secretBox) {
    const logins = await seedDemoLogins(tenancy, { secretBox: options.secretBox });
    const count = Object.values(logins.credentialed).reduce((n, users) => n + users.length, 0);
    log.info(
      `demo logins: ${count} user(s) got the password "${logins.password}"; owners are MFA-enrolled (TOTP secret ${logins.totpSecret})`,
    );
  }
  return { tenants };
}

async function seedTenantData(trx: Tx, tenantId: string, spec: SeedTenantSpec): Promise<boolean> {
  const existing = await trx.asset.count();
  if (existing > 0) {
    // An already seeded tenant keeps its data; the demo departments (ED-17) are topped up, idempotently.
    await topUpDepartments(trx, tenantId);
    return false;
  }

  // Users: the bootstrap admin is the Owner (activate it); add Admin, Technician and Viewer.
  await trx.user_account.updateMany({
    where: { email: `owner@${spec.domain}` },
    data: { status: 'active' },
  });
  const people = [
    { local: 'admin', name: 'Demo Asset Manager', roleKey: 'asset_manager' },
    { local: 'technician', name: 'Demo Technician', roleKey: 'technician' },
    { local: 'viewer', name: 'Demo Viewer', roleKey: 'viewer' },
  ];
  for (const p of people) {
    await addUser(trx, tenantId, {
      email: `${p.local}@${spec.domain}`,
      displayName: p.name,
      roleKey: p.roleKey,
      status: 'active',
    });
  }

  const categories = await trx.category.findMany({
    select: { id: true, name: true, tag_prefix: true },
  });
  const categoryByName = new Map(categories.map((c) => [c.name, c]));
  const statuses = await trx.status_label.findMany({ select: { id: true, name: true } });
  const statusByName = new Map(statuses.map((s) => [s.name, s.id]));

  // Manufacturers, models, vendors.
  const manufacturerIds = new Map<string, string>();
  for (const name of new Set(MODELS.map((m) => m.manufacturer)))
    manufacturerIds.set(name, uuidv7());
  await trx.manufacturer.createMany({
    data: [...manufacturerIds].map(([name, id]) => ({
      id,
      tenant_id: tenantId,
      name,
      url: `https://www.${name.toLowerCase()}.example`,
      support_email: `support@${name.toLowerCase()}.example`,
    })),
  });
  const modelRows = MODELS.map((m) => ({
    id: uuidv7(),
    tenant_id: tenantId,
    category_id: categoryByName.get(m.category)!.id,
    manufacturer_id: manufacturerIds.get(m.manufacturer)!,
    name: m.name,
    model_number: m.model_number,
    default_depreciation_months: m.category === 'Peripherals' ? 24 : 36,
    eol_date: m.eol ? new Date(`${m.eol}T00:00:00Z`) : null,
  }));
  await trx.asset_model.createMany({ data: modelRows });
  const vendorRows = VENDORS.map((v) => ({ id: uuidv7(), tenant_id: tenantId, ...v }));
  await trx.vendor.createMany({ data: vendorRows });

  // Custom field definitions: per category, plus one global field.
  let position = 0;
  const fieldRows = [
    ...Object.entries(FIELDS_BY_CATEGORY).flatMap(([categoryName, fields]) =>
      fields.map((f) => ({ f, categoryId: categoryByName.get(categoryName)!.id })),
    ),
    ...GLOBAL_FIELDS.map((f) => ({ f, categoryId: null })),
  ].map(({ f, categoryId }) => ({
    id: uuidv7(),
    tenant_id: tenantId,
    category_id: categoryId,
    key: f.key,
    label: f.label,
    data_type: f.data_type,
    required: f.required ?? false,
    options: f.options ? f.options.map((value) => ({ value, label: value })) : undefined,
    validation: f.validation as Prisma.InputJsonObject | undefined,
    help_text: f.help_text ?? null,
    position: (position += 10),
    show_in_list: f.show_in_list ?? false,
  }));
  await trx.custom_field_def.createMany({ data: fieldRows });

  // 200 assets spread over the models (weights above) and the status labels. Tags come from
  // app.next_asset_tag, so both tenants get the identical sequence (LAP00001, ...); serials are
  // identical too. Some retired assets are archived so the archived filter has data.
  const company = await trx.company.findFirstOrThrow({
    where: { is_default: true },
    select: { id: true },
  });
  // M2 wave 1: a location tree (2 sites, buildings, floors, rooms) and a set of people.
  const places = await seedLocations(trx, tenantId, company.id);
  const departments = await ensureDemoDepartments(trx, tenantId);
  const staff = await seedPeople(trx, tenantId, company.id, spec.domain, places, departments);
  const rand = lcg(20251118);
  const weighted = <T>(items: Array<[T, number]>): T => {
    const total = items.reduce((n, [, w]) => n + w, 0);
    let r = rand() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items.at(-1)![0];
  };
  const cities = ['HQ', 'Lab', 'Remote', 'Warehouse'];
  const assets = [];
  for (let i = 0; i < ASSETS_PER_TENANT; i++) {
    const modelIndex = weighted(MODELS.map((m, idx): [number, number] => [idx, m.weight]));
    const spec = MODELS[modelIndex]!;
    const model = modelRows[modelIndex]!;
    const category = categoryByName.get(spec.category)!;
    const [row] = await trx.$queryRaw<Array<{ tag: string }>>`
      select app.next_asset_tag(${category.tag_prefix ?? ''}) as tag`;
    const statusName = weighted(STATUS_WEIGHTS);
    const year = 2022 + Math.floor(rand() * 4);
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    const purchased = new Date(Date.UTC(year, month - 1, day));
    const warranty = new Date(
      Date.UTC(year + (spec.category === 'Peripherals' ? 1 : 3), month - 1, day),
    );
    const custom: Record<string, unknown> = { cost_center: `CC-${100 + (i % 5)}` };
    switch (spec.category) {
      case 'Laptops':
        custom.os = spec.manufacturer === 'Apple' ? 'macOS' : i % 4 === 0 ? 'Ubuntu' : 'Windows 11';
        custom.ram_gb = [8, 16, 16, 32][i % 4];
        custom.storage_gb = [256, 512, 512, 1024][i % 4];
        custom.encrypted = i % 9 !== 0;
        break;
      case 'Desktops':
        custom.ram_gb = [16, 32][i % 2];
        break;
      case 'Monitors':
        custom.screen_size_in = [24, 27, 27, 32][i % 4];
        custom.resolution = ['1920x1080', '2560x1440', '3840x2160'][i % 3];
        break;
      case 'Phones and tablets':
        custom.imei = String(350000000000000 + i * 7919).padStart(15, '0');
        custom.carrier = ['Verizon', 'AT&T', 'T-Mobile', 'None (Wi-Fi only)'][i % 4];
        break;
      case 'Network equipment':
        custom.mac_address = `f0:9f:c2:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}:01`;
        custom.firmware = `6.${i % 7}.${i % 13}`;
        break;
    }
    const retired = statusName === 'Retired';
    assets.push({
      id: uuidv7(),
      tenant_id: tenantId,
      company_id: company.id,
      asset_tag: row!.tag,
      name: `${spec.name} (${cities[i % cities.length]})`,
      serial: `SN-${String(i + 1).padStart(4, '0')}`,
      category_id: category.id,
      model_id: model.id,
      status_id: statusByName.get(statusName)!,
      vendor_id: vendorRows[i % vendorRows.length]!.id,
      purchase_date: purchased,
      purchase_cost_minor: BigInt(Math.round(spec.price * (0.9 + rand() * 0.2))),
      currency: 'USD',
      order_number: `PO-${year}-${String(1000 + (i % 40)).padStart(5, '0')}`,
      warranty_end: warranty,
      notes: i % 11 === 0 ? 'Imaged with the standard build; asset sticker on the lid.' : null,
      custom_data: custom as Prisma.InputJsonObject,
      archived_at: retired && i % 2 === 0 ? new Date(Date.UTC(2025, 9, 1)) : null,
      // every asset has a place: the leaf locations in turn (deterministic, identical in both tenants)
      location_id: places.leaves[i % places.leaves.length]!,
      // two in three assets belong to a department (ED-17); the rest are left unassigned on purpose
      department_id: demoDepartmentOfAsset(departments, i),
    });
  }
  await trx.asset.createMany({ data: assets });
  await setDemoManagers(trx, departments);
  await seedCustody(trx, tenantId, assets, staff, places, statusByName.get('Deployed')!);
  await seedRepairs(trx, tenantId, assets, {
    categoryNameById: new Map(categories.map((c) => [c.id, c.name])),
    vendorIds: vendorRows.map((v) => v.id),
    staff,
    inRepairStatusId: statusByName.get('In repair')!,
    restoreStatusId: statusByName.get('Ready to deploy')!,
  });
  await seedStock(trx, tenantId, company.id, staff, places);

  return true;
}

// ------------------------------------------------------------------------------ repairs of the demo

/**
 * What is wrong with an asset in repair, by category (the title is what the Repairs page shows, the
 * description the detail). Several per category: the seed picks them in turn.
 */
export const DEMO_REPAIR_PROBLEMS: Record<string, Array<{ title: string; description: string }>> = {
  Laptops: [
    {
      title: 'Cracked screen, replace panel',
      description:
        'Screen cracked across the lower third after a fall. Touch and display still work.',
    },
    {
      title: 'Battery swelling, replace',
      description:
        'The trackpad is lifting; the battery is swollen. Stop charging and replace the pack.',
    },
    {
      title: 'Keyboard keys unresponsive',
      description: 'Several keys on the left side do not register. Needs a new keyboard assembly.',
    },
  ],
  Desktops: [
    {
      title: 'Does not boot',
      description: 'Powers on, fans spin, no display and no POST beeps. Suspect memory or board.',
    },
    {
      title: 'Loud fan, overheating',
      description: 'The CPU fan is grinding and the machine shuts down under load.',
    },
  ],
  Monitors: [
    {
      title: 'Flickering panel',
      description:
        'The picture flickers and goes black for a second every few minutes, on every cable.',
    },
    {
      title: 'Dead pixels in a cluster',
      description:
        'A cluster of dead pixels near the centre. Covered by warranty if reported in time.',
    },
  ],
  'Phones and tablets': [
    {
      title: 'Charging port damaged',
      description: 'The device only charges when the cable is held at an angle.',
    },
    {
      title: 'Screen replacement',
      description: 'Display cracked and the digitiser is erratic.',
    },
  ],
  'Network equipment': [
    {
      title: 'Port 7 fails, link drops',
      description: 'Ports 7 and 8 lose link every few minutes. Firmware is current.',
    },
    {
      title: 'Power supply failure',
      description: 'The unit restarts under load; the power supply is the likely cause.',
    },
  ],
  Peripherals: [
    {
      title: 'Not recognised by the computer',
      description:
        'The device is not detected on any port or machine. Suspect the cable or controller.',
    },
  ],
};
const GENERIC_REPAIR_PROBLEM = {
  title: 'Fault found, needs service',
  description: 'The device fails its basic checks and needs a technician.',
};

/**
 * An open repair for every active asset the demo puts in the "In repair" status, so the Repairs
 * page, the dashboard panel and the asset's Repairs tab agree with the status labels. This is what
 * `RepairsService.create` leaves behind for a repair that moves the asset's status: one open record
 * per asset (`set_status_id` = the in-repair label, `restore_status_id` = what the asset returns to
 * when the repair is closed), a `repair_opened` history entry, opened one to thirty days ago. Some
 * are with a supplier (with a ticket), some in-house; some are already in progress; some have a
 * quoted cost. "Broken" assets are deliberately left without a record: broken is not the same as
 * being repaired. Like the rest of the seed this writes rows directly (no audit or outbox rows, so
 * demo data raises no notifications).
 */
async function seedRepairs(
  trx: Tx,
  tenantId: string,
  assets: Array<{
    id: string;
    category_id: string;
    status_id: string;
    archived_at: Date | null;
  }>,
  refs: {
    categoryNameById: Map<string, string>;
    vendorIds: string[];
    staff: Array<{ id: string; name: string }>;
    inRepairStatusId: string;
    restoreStatusId: string;
  },
): Promise<void> {
  const owner = await trx.user_account.findFirst({
    where: { role_assignment: { some: { role: { key: 'tenant_admin' } } } },
    select: { id: true },
  });
  const now = Date.now();
  const day = 86_400_000;
  const rand = lcg(20251124);
  const names = await trx.status_label.findMany({
    where: { id: { in: [refs.inRepairStatusId, refs.restoreStatusId] } },
    select: { id: true, name: true },
  });
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? '';
  // The in-house workshop: the first two people of the demo staff (IT).
  const workshop = refs.staff.slice(0, 2);

  const targets = assets.filter((a) => a.status_id === refs.inRepairStatusId && !a.archived_at);
  const turns = new Map<string, number>();
  for (const [k, asset] of targets.entries()) {
    const category = refs.categoryNameById.get(asset.category_id) ?? '';
    const pool = DEMO_REPAIR_PROBLEMS[category] ?? [GENERIC_REPAIR_PROBLEM];
    const turn = turns.get(category) ?? 0;
    turns.set(category, turn + 1);
    const problem = pool[turn % pool.length]!;
    const reported = new Date(now - (1 + Math.floor(rand() * 30)) * day);
    const inProgress = k % 3 === 1;
    const withSupplier = k % 3 !== 0;
    const quoted = k % 2 === 0;
    const id = uuidv7();
    await trx.maintenance_record.create({
      data: {
        id,
        tenant_id: tenantId,
        asset_id: asset.id,
        kind: 'repair',
        status: inProgress ? 'in_progress' : 'open',
        title: problem.title,
        description: problem.description,
        reported_at: reported,
        started_at: inProgress ? new Date(Math.min(now, reported.getTime() + day)) : null,
        vendor_id: withSupplier ? refs.vendorIds[k % refs.vendorIds.length]! : null,
        performed_by_person_id: withSupplier ? null : (workshop[k % workshop.length]?.id ?? null),
        ticket_ref: withSupplier ? `RMA-${2000 + k * 7}` : null,
        cost_minor: quoted ? BigInt(2500 + Math.floor(rand() * 36) * 500) : null,
        currency: quoted ? 'USD' : null,
        set_status_id: refs.inRepairStatusId,
        restore_status_id: refs.restoreStatusId,
        created_by: owner?.id ?? null,
      },
    });
    await trx.$executeRaw`
      insert into app.asset_history
        (id, tenant_id, asset_id, at, event_type, actor_type, actor_id, summary, payload)
      values (${uuidv7()}::uuid, ${tenantId}::uuid, ${asset.id}::uuid, ${reported}::timestamptz,
              'repair_opened', 'system', ${owner?.id ?? null}::uuid,
              ${`Repair opened: ${problem.title}`}::text,
              ${JSON.stringify({
                repair_id: id,
                kind: 'repair',
                title: problem.title,
                status: {
                  from: refs.restoreStatusId,
                  to: refs.inRepairStatusId,
                  from_name: nameOf(refs.restoreStatusId),
                  to_name: nameOf(refs.inRepairStatusId),
                },
              })}::jsonb)`;
  }
}

// ------------------------------------------------------------------------------ M2 wave 2: stock

/** [M2-W2 ACC] Accessories (quantity-tracked, handed out) of the demo tenants. */
export const DEMO_ACCESSORIES = [
  {
    name: 'USB-C charger 65 W',
    category: 'Chargers and power',
    total: 40,
    min: 8,
    out: [4, 2],
    home: 'Storage A',
    model: 'PD-65',
  },
  {
    name: 'Chromebook charger 45 W',
    category: 'Chargers and power',
    total: 60,
    min: 10,
    out: [12],
    home: 'Storage A',
    model: 'CB-45',
  },
  {
    name: 'USB-C cable 1 m',
    category: 'Cables',
    total: 80,
    min: 15,
    out: [6],
    home: 'Storage A',
    model: 'CAB-C1',
  },
  {
    name: 'HDMI cable 2 m',
    category: 'Cables',
    total: 25,
    min: 5,
    out: [10, 11],
    home: 'Storage B',
    model: 'CAB-H2',
  },
  {
    name: 'USB headset',
    category: 'Audio',
    total: 30,
    min: 6,
    out: [3, 1],
    home: 'Storage A',
    model: 'HS-USB',
  },
  {
    name: 'Wireless mouse',
    category: 'Input devices',
    total: 20,
    min: 4,
    out: [2],
    home: 'Storage B',
    model: 'MS-W2',
  },
] as const;

/** [M2-W2 ACC] Consumables (used up, with a stock ledger) of the demo tenants. */
export const DEMO_CONSUMABLES = [
  {
    name: 'Toner black (HP 410X)',
    category: 'Toner and ink',
    unit: 'cartridge',
    min: 4,
    receive: 12,
    issue: [2, 1],
    home: 'Storage A',
    model: 'CF410X',
  },
  {
    name: 'Toner cyan (HP 410X)',
    category: 'Toner and ink',
    unit: 'cartridge',
    min: 3,
    receive: 6,
    issue: [2, 1],
    home: 'Storage A',
    model: 'CF411X',
  },
  {
    name: 'Label rolls 57 x 32 mm',
    category: 'Labels and paper',
    unit: 'roll',
    min: 10,
    receive: 40,
    issue: [5, 3, 4],
    home: 'Storage A',
    model: 'LBL-5732',
  },
  {
    name: 'Copy paper A4',
    category: 'Labels and paper',
    unit: 'ream',
    min: 20,
    receive: 100,
    issue: [10, 8],
    home: 'Storage B',
    model: 'PAP-A4',
  },
  {
    name: 'Whiteboard markers',
    category: 'Office supplies',
    unit: 'box',
    min: 3,
    receive: 15,
    issue: [4],
    home: 'Storage B',
    model: 'WBM-12',
  },
] as const;

/**
 * Accessories and consumables: categories of their own kinds, a handful of accessories with units
 * out (one with a partial return, one already below its minimum) and consumables with a ledger
 * (opening receive, issues to people, one adjustment). The low-stock latch is set to the current
 * state without events: demo data must not raise notifications.
 */
async function seedStock(
  trx: Tx,
  tenantId: string,
  companyId: string,
  people: Array<{ id: string; name: string }>,
  places: Places,
): Promise<void> {
  const owner = await trx.user_account.findFirst({
    where: { role_assignment: { some: { role: { key: 'tenant_admin' } } } },
    select: { id: true },
  });
  const now = Date.now();
  const day = 86_400_000;

  const categoryIds = new Map<string, string>();
  const category = async (name: string, kind: 'accessory' | 'consumable'): Promise<string> => {
    const key = `${kind}:${name}`;
    const known = categoryIds.get(key);
    if (known) return known;
    const id = uuidv7();
    await trx.category.create({ data: { id, tenant_id: tenantId, name, kind } });
    categoryIds.set(key, id);
    return id;
  };

  // Accessories and their hand-overs: the first people in turn, the last of a list to a room.
  let turn = 0;
  for (const spec of DEMO_ACCESSORIES) {
    const id = uuidv7();
    await trx.accessory.create({
      data: {
        id,
        tenant_id: tenantId,
        company_id: companyId,
        category_id: await category(spec.category, 'accessory'),
        location_id: places.byName.get(spec.home) ?? null,
        name: spec.name,
        model_number: spec.model,
        qty_total: spec.total,
        min_qty: spec.min,
        purchase_date: new Date(Date.UTC(2025, 8, 1)),
        purchase_cost_minor: BigInt(1200 + spec.total * 5),
        currency: 'USD',
        created_by: owner?.id ?? null,
      },
    });
    for (const [i, quantity] of spec.out.entries()) {
      const toRoom = spec.out.length > 1 && i === spec.out.length - 1;
      const person = people[turn++ % people.length]!;
      const place = places.leaves[turn % places.leaves.length]!;
      await trx.assignment.create({
        data: {
          id: uuidv7(),
          tenant_id: tenantId,
          accessory_id: id,
          person_id: toRoom ? null : person.id,
          location_id: toRoom ? place : null,
          quantity,
          checked_out_at: new Date(now - (i + 2) * 9 * day),
          checked_out_by: owner?.id ?? null,
          note: 'Demo hand-over',
        },
      });
    }
  }
  // A partial return (3 of 5 headsets back, 2 still out) and a fully returned loan, for the lists.
  const headset = await trx.accessory.findFirstOrThrow({ where: { name: 'USB headset' } });
  const partial = uuidv7();
  await trx.assignment.create({
    data: {
      id: partial,
      tenant_id: tenantId,
      accessory_id: headset.id,
      person_id: people[0]!.id,
      quantity: 5,
      checked_out_at: new Date(now - 40 * day),
      checked_out_by: owner?.id ?? null,
      note: 'Exam week',
    },
  });
  await trx.$executeRaw`
    update app.assignment set quantity_returned = 3, checkin_note = 'Three back after the exams'
     where id = ${partial}::uuid`;
  const returned = uuidv7();
  await trx.assignment.create({
    data: {
      id: returned,
      tenant_id: tenantId,
      accessory_id: headset.id,
      person_id: people[1]!.id,
      quantity: 2,
      checked_out_at: new Date(now - 60 * day),
      checked_out_by: owner?.id ?? null,
    },
  });
  await trx.$executeRaw`
    update app.assignment
       set quantity_returned = 2, checked_in_at = ${new Date(now - 50 * day)}::timestamptz,
           checked_in_by = ${owner?.id ?? null}::uuid
     where id = ${returned}::uuid`;

  // Consumables: opening stock, issues to people, one stock-count adjustment.
  for (const spec of DEMO_CONSUMABLES) {
    const id = uuidv7();
    await trx.consumable.create({
      data: {
        id,
        tenant_id: tenantId,
        company_id: companyId,
        category_id: await category(spec.category, 'consumable'),
        location_id: places.byName.get(spec.home) ?? null,
        name: spec.name,
        model_number: spec.model,
        unit: spec.unit,
        min_qty: spec.min,
        unit_cost_minor: BigInt(450 + spec.receive * 20),
        currency: 'USD',
        created_by: owner?.id ?? null,
      },
    });
    const move = (
      qty_delta: number,
      reason: string,
      person_id: string | null,
      note: string | null,
    ) =>
      trx.stock_movement.create({
        data: {
          id: uuidv7(),
          tenant_id: tenantId,
          consumable_id: id,
          qty_delta,
          reason,
          person_id,
          note,
          by_user_id: owner?.id ?? null,
        },
      });
    await move(spec.receive, 'receive', null, 'Opening stock');
    for (const quantity of spec.issue) {
      const person = people[turn++ % people.length]!;
      await move(-quantity, 'issue', person.id, 'Demo issue');
    }
  }
  const labels = await trx.consumable.findFirstOrThrow({
    where: { name: 'Label rolls 57 x 32 mm' },
  });
  await trx.stock_movement.create({
    data: {
      id: uuidv7(),
      tenant_id: tenantId,
      consumable_id: labels.id,
      qty_delta: -1,
      reason: 'adjust',
      note: 'Stock count: one roll damaged',
      by_user_id: owner?.id ?? null,
    },
  });

  // The latch is the current state (below / above the minimum): no event for demo data.
  await trx.$executeRaw`
    update app.consumable set low_stock_alerted = (min_qty > 0 and qty_on_hand <= min_qty)`;
  await trx.$executeRaw`
    update app.accessory a set low_stock_alerted = (
      a.min_qty > 0 and a.qty_total - coalesce((
        select sum(s.quantity - s.quantity_returned) from app.assignment s
         where s.tenant_id = a.tenant_id and s.accessory_id = a.id and s.checked_in_at is null), 0) <= a.min_qty)`;
}

// ------------------------------------------------------------------------------ M2 wave 1 data

interface PlaceSeed {
  name: string;
  kind: string;
  code?: string;
  children?: PlaceSeed[];
}

/** Two sites, their buildings, floors and rooms (the same tree in every demo tenant). */
export const DEMO_LOCATIONS: PlaceSeed[] = [
  {
    name: 'Oslo HQ',
    kind: 'site',
    code: 'OSL',
    children: [
      {
        name: 'Main building',
        kind: 'building',
        children: [
          {
            name: 'Floor 1',
            kind: 'floor',
            children: [
              { name: 'Reception', kind: 'room' },
              { name: 'Room 101', kind: 'room' },
              { name: 'Room 102', kind: 'room' },
            ],
          },
          {
            name: 'Floor 2',
            kind: 'floor',
            children: [
              { name: 'Open office', kind: 'room' },
              { name: 'Server room', kind: 'room', code: 'SRV' },
            ],
          },
        ],
      },
      {
        name: 'Warehouse',
        kind: 'building',
        children: [
          { name: 'Storage A', kind: 'storage' },
          { name: 'Storage B', kind: 'storage' },
        ],
      },
    ],
  },
  {
    name: 'Bergen campus',
    kind: 'site',
    code: 'BGO',
    children: [
      {
        name: 'Science block',
        kind: 'building',
        children: [
          { name: 'Lab 1', kind: 'room' },
          { name: 'Lab 2', kind: 'room' },
        ],
      },
      { name: 'Library', kind: 'building', children: [{ name: 'Reading room', kind: 'room' }] },
    ],
  },
];

interface Places {
  /** ids of the locations without children, in tree order */
  leaves: string[];
  /** every location id by name */
  byName: Map<string, string>;
}

async function seedLocations(trx: Tx, tenantId: string, companyId: string): Promise<Places> {
  const places: Places = { leaves: [], byName: new Map() };
  // One at a time: the path trigger reads the parent row, which must already be written.
  const insert = async (seed: PlaceSeed, parentId: string | null): Promise<void> => {
    const id = uuidv7();
    await trx.location.create({
      data: {
        id,
        tenant_id: tenantId,
        company_id: companyId,
        parent_id: parentId,
        name: seed.name,
        kind: seed.kind,
        code: seed.code ?? null,
      },
    });
    places.byName.set(seed.name, id);
    if (!seed.children?.length) places.leaves.push(id);
    for (const child of seed.children ?? []) await insert(child, id);
  };
  for (const root of DEMO_LOCATIONS) await insert(root, null);
  return places;
}

interface PersonSeed {
  first: string;
  last: string;
  kind: 'employee' | 'student' | 'contractor';
  department: string;
  title: string | null;
  home: string;
}

export const DEMO_PEOPLE: PersonSeed[] = [
  {
    first: 'Alice',
    last: 'Johansen',
    kind: 'employee',
    department: 'IT',
    title: 'IT manager',
    home: 'Server room',
  },
  {
    first: 'Bjorn',
    last: 'Haugen',
    kind: 'employee',
    department: 'IT',
    title: 'Support engineer',
    home: 'Room 101',
  },
  {
    first: 'Camilla',
    last: 'Berg',
    kind: 'employee',
    department: 'Administration',
    title: 'Controller',
    home: 'Room 102',
  },
  {
    first: 'David',
    last: 'Nilsen',
    kind: 'employee',
    department: 'Facilities',
    title: 'Site lead',
    home: 'Storage A',
  },
  {
    first: 'Eva',
    last: 'Larsen',
    kind: 'employee',
    department: 'Administration',
    title: 'Account executive',
    home: 'Open office',
  },
  {
    first: 'Fatima',
    last: 'Khan',
    kind: 'contractor',
    department: 'IT',
    title: 'Network contractor',
    home: 'Server room',
  },
  {
    first: 'Gustav',
    last: 'Eriksen',
    kind: 'student',
    department: 'Mathematics',
    title: null,
    home: 'Lab 1',
  },
  {
    first: 'Hanna',
    last: 'Solberg',
    kind: 'student',
    department: 'Mathematics',
    title: null,
    home: 'Lab 1',
  },
  {
    first: 'Ivar',
    last: 'Moen',
    kind: 'student',
    department: 'Science',
    title: null,
    home: 'Lab 2',
  },
  {
    first: 'Julie',
    last: 'Dahl',
    kind: 'student',
    department: 'Science',
    title: null,
    home: 'Lab 2',
  },
  {
    first: 'Karl',
    last: 'Strand',
    kind: 'student',
    department: 'Library',
    title: null,
    home: 'Reading room',
  },
  {
    first: 'Lise',
    last: 'Bakke',
    kind: 'student',
    department: 'Library',
    title: null,
    home: 'Reading room',
  },
];

/** People without a login (the persons of the demo logins are created by the database). */
async function seedPeople(
  trx: Tx,
  tenantId: string,
  companyId: string,
  domain: string,
  places: Places,
  departments: Map<string, string>,
): Promise<Array<{ id: string; name: string }>> {
  const rows = DEMO_PEOPLE.map((p, i) => ({
    id: uuidv7(),
    tenant_id: tenantId,
    company_id: companyId,
    kind: p.kind,
    display_name: `${p.first} ${p.last}`,
    first_name: p.first,
    last_name: p.last,
    email: `${p.first}.${p.last}@${domain}`.toLowerCase(),
    employee_ref: `${p.kind === 'student' ? 'S' : 'E'}-${(p.kind === 'student' ? 2000 : 1000) + i}`,
    department_id: departments.get(p.department) ?? null,
    job_title: p.title,
    location_id: places.byName.get(p.home) ?? null,
  }));
  await trx.person.createMany({ data: rows });
  return rows.map((r) => ({ id: r.id, name: r.display_name }));
}

interface DepartmentSeed {
  name: string;
  code: string;
  description: string;
  /** Display name of the head of the department (a demo person), when there is one. */
  manager: string | null;
}

/** The managed demo departments (ED-17). The names are what people and assets are linked by. */
export const DEMO_DEPARTMENTS: DepartmentSeed[] = [
  {
    name: 'IT',
    code: 'IT',
    description: 'Devices, network and support.',
    manager: 'Alice Johansen',
  },
  {
    name: 'Science',
    code: 'SCI',
    description: 'Laboratories and science teaching.',
    manager: null,
  },
  { name: 'Mathematics', code: 'MATH', description: 'Mathematics teaching.', manager: null },
  {
    name: 'Administration',
    code: 'ADM',
    description: 'Office, finance and sales.',
    manager: 'Camilla Berg',
  },
  { name: 'Library', code: 'LIB', description: 'Reading room and loan desk.', manager: null },
  {
    name: 'Facilities',
    code: 'FAC',
    description: 'Buildings, storage and equipment.',
    manager: 'David Nilsen',
  },
];

/**
 * Creates the demo departments a tenant does not have yet (matched by name, case-insensitively) and
 * returns name -> id. Idempotent: running it again changes nothing.
 */
async function ensureDemoDepartments(trx: Tx, tenantId: string): Promise<Map<string, string>> {
  const live = await trx.department.findMany({
    where: { archived_at: null },
    select: { id: true, name: true, code_key: true },
  });
  const byKey = new Map(live.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const codes = new Set(live.map((d) => d.code_key).filter((c): c is string => c !== null));
  const out = new Map<string, string>();
  for (const d of DEMO_DEPARTMENTS) {
    let id = byKey.get(d.name.toLowerCase());
    if (!id) {
      id = uuidv7();
      // a code another department already holds is left unset rather than colliding
      const code = codes.has(d.code.toLowerCase()) ? null : d.code;
      await trx.department.create({
        data: { id, tenant_id: tenantId, name: d.name, code, description: d.description },
      });
    }
    out.set(d.name, id);
  }
  return out;
}

/** Heads of the demo departments that have none yet (people exist by now). Idempotent. */
async function setDemoManagers(trx: Tx, departments: Map<string, string>): Promise<void> {
  for (const d of DEMO_DEPARTMENTS) {
    const id = departments.get(d.name);
    if (!id || !d.manager) continue;
    const person = await trx.person.findFirst({
      where: { display_name: d.manager, archived_at: null },
      select: { id: true },
    });
    if (!person) continue;
    await trx.department.updateMany({
      where: { id, manager_person_id: null },
      data: { manager_person_id: person.id },
    });
  }
}

/** Two in three assets belong to a department, spread over the demo departments in turn. */
function demoDepartmentOfAsset(departments: Map<string, string>, index: number): string | null {
  if (index % 3 === 2) return null;
  // (the skipped third would otherwise leave two of the six departments without any asset)
  const spec = DEMO_DEPARTMENTS[(index + Math.floor(index / 3)) % DEMO_DEPARTMENTS.length]!;
  return departments.get(spec.name) ?? null;
}

/**
 * For a tenant that was seeded before departments existed (its people were linked by migration 0100):
 * make sure the demo departments are there, set their heads, and link the assets of a tenant in which
 * no asset has a department yet. Idempotent: once an asset has a department, nothing is touched again.
 */
async function topUpDepartments(trx: Tx, tenantId: string): Promise<void> {
  const departments = await ensureDemoDepartments(trx, tenantId);
  await setDemoManagers(trx, departments);
  if ((await trx.asset.count({ where: { department_id: { not: null } } })) > 0) return;
  const assets = await trx.asset.findMany({
    where: { archived_at: null },
    select: { id: true },
    orderBy: [{ asset_tag: 'asc' }],
  });
  const groups = new Map<string, string[]>();
  assets.forEach((a, i) => {
    const department = demoDepartmentOfAsset(departments, i);
    if (department) groups.set(department, [...(groups.get(department) ?? []), a.id]);
  });
  for (const [department, ids] of groups) {
    await trx.asset.updateMany({ where: { id: { in: ids } }, data: { department_id: department } });
  }
}

/**
 * Chain-of-custody demo data: every asset gets a `created` history entry; the active assets with
 * the "Deployed" status are checked out to the people (a few to a room), some with a return date
 * and three of them overdue. Done in SQL-shaped batches (no API call: the seed runs before the app).
 */
async function seedCustody(
  trx: Tx,
  tenantId: string,
  assets: Array<{
    id: string;
    asset_tag: string;
    status_id: string;
    archived_at: Date | null;
    created_at?: Date;
  }>,
  people: Array<{ id: string; name: string }>,
  places: Places,
  deployedStatusId: string,
): Promise<void> {
  const owner = await trx.user_account.findFirst({
    where: { role_assignment: { some: { role: { key: 'tenant_admin' } } } },
    select: { id: true },
  });
  const rooms = [...places.leaves];
  const now = Date.now();
  const day = 86_400_000;
  const assignments: Array<{
    id: string;
    assetId: string;
    tag: string;
    target: string;
    targetName: string;
    isPerson: boolean;
    at: Date;
  }> = [];
  let overdue = 0;
  const custody = assets.filter((a) => a.status_id === deployedStatusId && !a.archived_at);
  for (const [i, asset] of custody.entries()) {
    const toRoom = i % 17 === 16;
    const person = people[i % people.length]!;
    const place = rooms[i % rooms.length]!;
    const placeName = [...places.byName].find(([, id]) => id === place)?.[0] ?? 'a room';
    const id = uuidv7();
    const at = new Date(now - ((i % 90) + 1) * day);
    // due dates: every 5th asset is due in a month, every 11th is overdue (the first three become 10 days late)
    let due: Date | null = null;
    if (i % 11 === 0 && overdue < 3) {
      due = new Date(now - 10 * day);
      overdue++;
    } else if (i % 5 === 0) due = new Date(now + 30 * day);
    await trx.assignment.create({
      data: {
        id,
        tenant_id: tenantId,
        asset_id: asset.id,
        person_id: toRoom ? null : person.id,
        location_id: toRoom ? place : null,
        checked_out_at: at,
        checked_out_by: owner?.id ?? null,
        expected_return: due ? new Date(due.toISOString().slice(0, 10) + 'T00:00:00Z') : null,
        note: due ? 'Demo loan' : null,
      },
    });
    assignments.push({
      id,
      assetId: asset.id,
      tag: asset.asset_tag,
      target: toRoom ? place : person.id,
      targetName: toRoom ? placeName : person.name,
      isPerson: !toRoom,
      at,
    });
  }
  // History: `created` for every asset (system), `checked_out` for the demo assignments.
  await trx.$executeRaw`
    insert into app.asset_history (id, tenant_id, asset_id, at, event_type, actor_type, summary, payload)
    select gen_random_uuid(), a.tenant_id, a.id, a.created_at, 'created', 'system',
           'Asset ' || a.asset_tag || ' created', '{}'::jsonb
      from app.asset a`;
  for (const s of assignments) {
    await trx.$executeRaw`
      insert into app.asset_history
        (id, tenant_id, asset_id, at, event_type, actor_type, actor_id, assignment_id, summary, payload)
      values (${uuidv7()}::uuid, ${tenantId}::uuid, ${s.assetId}::uuid, ${s.at}::timestamptz,
              'checked_out', 'system', ${owner?.id ?? null}::uuid, ${s.id}::uuid,
              ${`Checked out to ${s.targetName}`}::text,
              ${JSON.stringify({
                assignment_id: s.id,
                target_type: s.isPerson ? 'person' : 'location',
                target_id: s.target,
                target_name: s.targetName,
              })}::jsonb)`;
  }
}
