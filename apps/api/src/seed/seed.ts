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

export const ASSETS_PER_TENANT = 50;

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
const MODELS = [
  { category: 'Laptops', manufacturer: 'Dell', name: 'Latitude 7440', model_number: '7440' },
  { category: 'Laptops', manufacturer: 'Apple', name: 'MacBook Pro 14', model_number: 'A2992' },
  { category: 'Laptops', manufacturer: 'Lenovo', name: 'ThinkPad T14', model_number: 'T14G4' },
  { category: 'Desktops', manufacturer: 'Dell', name: 'OptiPlex 7010', model_number: '7010' },
  {
    category: 'Monitors',
    manufacturer: 'Dell',
    name: 'UltraSharp U2723QE',
    model_number: 'U2723QE',
  },
  { category: 'Monitors', manufacturer: 'LG', name: '27UP850', model_number: '27UP850-W' },
  {
    category: 'Phones and tablets',
    manufacturer: 'Apple',
    name: 'iPhone 15',
    model_number: 'A3090',
  },
  {
    category: 'Peripherals',
    manufacturer: 'Logitech',
    name: 'MX Keys',
    model_number: '920-009295',
  },
  {
    category: 'Network equipment',
    manufacturer: 'Ubiquiti',
    name: 'UniFi U6 Pro',
    model_number: 'U6-PRO',
  },
] as const;

const STATE_BY_INDEX = [
  'Ready to deploy',
  'Deployed',
  'Deployed',
  'Deployed',
  'Pending',
  'In repair',
];

/**
 * Creates the two demo tenants "Acme" and "Globex" with an Owner, an Admin, a Technician and a
 * Viewer each, default status labels and categories, manufacturers, models, custom field
 * definitions and 50 assets. Idempotent: a tenant that already has assets is left untouched.
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
    { local: 'admin', name: 'Demo Admin', roleKey: 'asset_manager' },
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

  // Manufacturers and models.
  const manufacturerIds = new Map<string, string>();
  for (const name of new Set(MODELS.map((m) => m.manufacturer)))
    manufacturerIds.set(name, uuidv7());
  await trx.manufacturer.createMany({
    data: [...manufacturerIds].map(([name, id]) => ({ id, tenant_id: tenantId, name })),
  });
  const modelRows = MODELS.map((m) => ({
    id: uuidv7(),
    tenant_id: tenantId,
    category_id: categoryByName.get(m.category)!.id,
    manufacturer_id: manufacturerIds.get(m.manufacturer)!,
    name: m.name,
    model_number: m.model_number,
    default_depreciation_months: 36,
  }));
  await trx.asset_model.createMany({ data: modelRows });

  // Vendor.
  const vendorId = uuidv7();
  await trx.vendor.create({
    data: { id: vendorId, tenant_id: tenantId, name: 'CDW', url: 'https://www.cdw.com' },
  });

  // Custom field definitions (applied to laptops, plus one for every category).
  const laptops = categoryByName.get('Laptops')!;
  await trx.custom_field_def.createMany({
    data: [
      {
        id: uuidv7(),
        tenant_id: tenantId,
        category_id: laptops.id,
        key: 'os',
        label: 'Operating system',
        data_type: 'select',
        options: ['macOS', 'Windows', 'Linux'],
        position: 10,
        show_in_list: true,
      },
      {
        id: uuidv7(),
        tenant_id: tenantId,
        category_id: laptops.id,
        key: 'ram_gb',
        label: 'RAM (GB)',
        data_type: 'number',
        validation: { min: 1, max: 1024 },
        position: 20,
      },
      {
        id: uuidv7(),
        tenant_id: tenantId,
        category_id: null,
        key: 'cost_center',
        label: 'Cost center',
        data_type: 'text',
        position: 30,
      },
    ],
  });

  // 50 assets, cycling over the models. Tags come from app.next_asset_tag, so both tenants get the
  // identical sequence (LAP00001, ...); serials are identical across tenants too.
  // The fill_default_company trigger would fill company_id, but Prisma requires the column on create.
  const company = await trx.company.findFirstOrThrow({
    where: { is_default: true },
    select: { id: true },
  });
  const assets = [];
  const osChoices = ['macOS', 'Windows', 'Linux'];
  for (let i = 0; i < ASSETS_PER_TENANT; i++) {
    const model = modelRows[i % modelRows.length]!;
    const modelDef = MODELS[i % MODELS.length]!;
    const category = categoryByName.get(modelDef.category)!;
    const [row] = await trx.$queryRaw<Array<{ tag: string }>>`
      select app.next_asset_tag(${category.tag_prefix ?? ''}) as tag`;
    const custom: Record<string, unknown> = { cost_center: `CC-${100 + (i % 5)}` };
    if (category.id === laptops.id) {
      custom.os = osChoices[i % osChoices.length];
      custom.ram_gb = [8, 16, 32][i % 3];
    }
    assets.push({
      id: uuidv7(),
      tenant_id: tenantId,
      company_id: company.id,
      asset_tag: row!.tag,
      name: `${modelDef.name} #${i + 1}`,
      serial: `SN-${String(i + 1).padStart(4, '0')}`,
      category_id: category.id,
      model_id: model.id,
      status_id: statusByName.get(STATE_BY_INDEX[i % STATE_BY_INDEX.length]!)!,
      vendor_id: vendorId,
      purchase_date: new Date(`2025-${String((i % 12) + 1).padStart(2, '0')}-15`),
      purchase_cost_minor: BigInt(50_000 + i * 2_500),
      currency: 'USD',
      warranty_end: new Date(`2028-${String((i % 12) + 1).padStart(2, '0')}-15`),
      custom_data: custom as Prisma.InputJsonObject,
    });
  }
  await trx.asset.createMany({ data: assets });

  return true;
}
