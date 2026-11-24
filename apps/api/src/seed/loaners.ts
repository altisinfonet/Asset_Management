import { uuidv7 } from '../ids/uuidv7.js';
import type { Tx } from '../tenancy/index.js';

/** The demo loaner pool (ED-20): a Chromebook cart with ten devices, five of them out. */
export const DEMO_LOANER_POOL = 'Chromebook cart';
/** Devices in the demo pool (on top of the {@link ASSETS_PER_TENANT} demo assets). */
export const DEMO_LOANER_DEVICES = 10;
/**
 * Due dates of the demo loans, in days from today: two overdue (6 and 2 days), one due today, one due
 * soon and one that has time. Every loan went out `DEMO_LOAN_DAYS` days before its due date.
 */
export const DEMO_LOAN_DUE_DAYS = [-6, -2, 0, 2, 5];
const DEMO_LOAN_DAYS = 7;

/**
 * One loaner pool per tenant: ten Chromebooks (category, model and devices are created when the tenant
 * does not have them), the pool with its rules, and five devices on loan to demo people, two of them
 * overdue (M2-LOAN-01..04 demo data). Idempotent: a tenant that already has the pool is left alone, so
 * running the seed again (or against a tenant seeded before loaner pools existed) tops it up once.
 */
export async function ensureDemoLoaners(trx: Tx, tenantId: string): Promise<void> {
  const exists = await trx.loaner_pool.findFirst({
    where: { name_key: DEMO_LOANER_POOL.toLowerCase(), archived_at: null },
    select: { id: true },
  });
  if (exists) return;
  const ready = await trx.status_label.findFirst({
    where: { name: 'Ready to deploy', archived_at: null },
    select: { id: true },
  });
  const deployed = await trx.status_label.findFirst({
    where: { name: 'Deployed', archived_at: null },
    select: { id: true },
  });
  const company = await trx.company.findFirst({
    where: { is_default: true },
    select: { id: true },
  });
  if (!ready || !deployed || !company) return; // not a provisioned demo tenant: nothing to hang the pool on

  const home =
    (await trx.location.findFirst({
      where: { archived_at: null, kind: 'room' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })) ??
    (await trx.location.findFirst({
      where: { archived_at: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true },
    }));
  const owner = await trx.user_account.findFirst({
    where: { role_assignment: { some: { role: { key: 'asset_manager' } } } },
    select: { id: true },
  });
  const actor = await trx.user_account.findFirst({
    where: { role_assignment: { some: { role: { key: 'tenant_admin' } } } },
    select: { id: true },
  });

  const category =
    (await trx.category.findFirst({
      where: { name: 'Chromebooks', kind: 'asset', archived_at: null },
    })) ??
    (await trx.category.create({
      data: {
        id: uuidv7(),
        tenant_id: tenantId,
        name: 'Chromebooks',
        kind: 'asset',
        tag_prefix: 'CHR-',
        description: 'Loaner Chromebooks for lessons.',
      },
    }));
  const maker =
    (await trx.manufacturer.findFirst({ where: { name: 'Acer', archived_at: null } })) ??
    (await trx.manufacturer.create({
      data: { id: uuidv7(), tenant_id: tenantId, name: 'Acer' },
    }));
  const model =
    (await trx.asset_model.findFirst({
      where: { name: 'Chromebook Spin 514', manufacturer_id: maker.id, archived_at: null },
    })) ??
    (await trx.asset_model.create({
      data: {
        id: uuidv7(),
        tenant_id: tenantId,
        category_id: category.id,
        manufacturer_id: maker.id,
        name: 'Chromebook Spin 514',
        model_number: 'CP514-3H',
      },
    }));

  const devices: Array<{ id: string; tag: string }> = [];
  for (let i = 1; i <= DEMO_LOANER_DEVICES; i++) {
    const [row] = await trx.$queryRaw<Array<{ tag: string }>>`
      select app.next_asset_tag(${category.tag_prefix ?? ''}) as tag`;
    const id = uuidv7();
    await trx.asset.create({
      data: {
        id,
        tenant_id: tenantId,
        company_id: company.id,
        asset_tag: row!.tag,
        name: `Chromebook ${String(i).padStart(2, '0')}`,
        serial: `CB-${String(i).padStart(4, '0')}`,
        category_id: category.id,
        model_id: model.id,
        status_id: ready.id,
        location_id: home?.id ?? null,
        notes: 'Loaner pool device.',
      },
    });
    devices.push({ id, tag: row!.tag });
  }
  await trx.$executeRaw`
    insert into app.asset_history (id, tenant_id, asset_id, at, event_type, actor_type, summary, payload)
    select gen_random_uuid(), a.tenant_id, a.id, a.created_at, 'created', 'system',
           'Asset ' || a.asset_tag || ' created', '{}'::jsonb
      from app.asset a
     where a.id = any(${devices.map((d) => d.id)}::uuid[])`;

  const pool = await trx.loaner_pool.create({
    data: {
      id: uuidv7(),
      tenant_id: tenantId,
      name: DEMO_LOANER_POOL,
      description: 'Ten Chromebooks on the cart in the library, lent for a week at a time.',
      home_location_id: home?.id ?? null,
      default_loan_days: DEMO_LOAN_DAYS,
      max_loan_days: 21,
      max_loans_per_person: 2,
      owner_user_id: owner?.id ?? null,
      created_by: actor?.id ?? null,
    },
  });
  await trx.loaner_pool_member.createMany({
    data: devices.map((d) => ({
      tenant_id: tenantId,
      asset_id: d.id,
      loaner_pool_id: pool.id,
      added_by: actor?.id ?? null,
    })),
  });

  // five loans: students first, then anybody active
  const borrowers = await trx.person.findMany({
    where: { archived_at: null, status: 'active' },
    orderBy: [{ kind: 'desc' }, { display_name: 'asc' }],
    take: DEMO_LOAN_DUE_DAYS.length,
    select: { id: true, display_name: true },
  });
  const day = 86_400_000;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const [i, person] of borrowers.entries()) {
    const device = devices[i]!;
    const dueMs = today + DEMO_LOAN_DUE_DAYS[i]! * day;
    const out = new Date(dueMs - DEMO_LOAN_DAYS * day + 10 * 3_600_000);
    const id = uuidv7();
    await trx.assignment.create({
      data: {
        id,
        tenant_id: tenantId,
        asset_id: device.id,
        person_id: person.id,
        loaner_pool_id: pool.id,
        checked_out_at: out,
        checked_out_by: actor?.id ?? null,
        expected_return: new Date(dueMs),
        note: 'Demo loan',
      },
    });
    await trx.asset.update({ where: { id: device.id }, data: { status_id: deployed.id } });
    await trx.$executeRaw`
      insert into app.asset_history
        (id, tenant_id, asset_id, at, event_type, actor_type, actor_id, assignment_id, summary, payload)
      values (${uuidv7()}::uuid, ${tenantId}::uuid, ${device.id}::uuid, ${out}::timestamptz,
              'checked_out', 'system', ${actor?.id ?? null}::uuid, ${id}::uuid,
              ${`Loaned to ${person.display_name}`}::text,
              ${JSON.stringify({
                assignment_id: id,
                target_type: 'person',
                target_id: person.id,
                target_name: person.display_name,
                expected_return: new Date(dueMs).toISOString().slice(0, 10),
                loaner_pool_id: pool.id,
              })}::jsonb)`;
  }
}
