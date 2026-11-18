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
 * definitions and 200 assets. Idempotent: a tenant that already has assets is left untouched.
 * Refuses to run in production.
 */
export async function seedDemoData(
  tenancy: TenancyService,
  options: { nodeEnv?: string; logger?: SeedLogger; secretBox?: SecretBox } = {},
): Promise<{ tenants: Array<{ slug: string; tenantId: string; seeded: boolean }> }> {
  if ((options.nodeEnv ?? process.env.NODE_ENV) === 'production') throw new SeedRefusedError();
  const log = options.logger ?? { info: () => undefined };

  const tenants: Array<{ slug: string; tenantId: string; seeded: boolean }> = [];
  for (const spec of DEMO_TENANTS) {
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
  if (existing > 0) return false;

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
    });
  }
  await trx.asset.createMany({ data: assets });

  return true;
}
