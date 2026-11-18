import pg from 'pg';
import { uuidv7 } from '../../src/ids/uuidv7.js';
import { sqlStateOf, TenancyService, type Tx } from '../../src/tenancy/index.js';

/**
 * Shared e2e plumbing. Environment:
 *   DATABASE_URL           runtime role (app_user): direct, or through PgBouncer in pooled mode
 *   MIGRATOR_DATABASE_URL  owner role (app_owner), direct: fixtures that need DDL, FORCE-RLS owner tests
 *   POOLED_ONE_URL         app_user through the `app_one` (pool_size=1) PgBouncer alias: negative control
 *   ADMIN_DATABASE_URL     superuser (optional): only the BYPASSRLS / CREATEROLE lint fixtures
 *   ISOLATION_MODE         direct | pooled (default: pooled when POOLED_ONE_URL is set)
 */
export const env = {
  databaseUrl: process.env.DATABASE_URL,
  migratorUrl: process.env.MIGRATOR_DATABASE_URL,
  pooledOneUrl: process.env.POOLED_ONE_URL,
  adminUrl: process.env.ADMIN_DATABASE_URL,
};
export const mode: 'direct' | 'pooled' =
  process.env.ISOLATION_MODE === 'pooled' || (!process.env.ISOLATION_MODE && env.pooledOneUrl)
    ? 'pooled'
    : 'direct';

/** True when the database-backed suites can run. */
export const dbEnabled = Boolean(env.databaseUrl && env.migratorUrl);

export function newTenancy(url = env.databaseUrl!, poolMax = 10): TenancyService {
  return new TenancyService({ connectionString: url, poolMax, applicationName: 'e2e' });
}

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, application_name: 'e2e-raw' });
  await client.connect();
  return client;
}

/** Runs `fn` with a raw client and always disconnects. */
export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = await connect(url);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Raw-driver version of withTenantTx (BEGIN, transaction-local set_config, COMMIT). */
export async function rawTenantTx<T>(
  client: pg.Client,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

/** Error code of a rejected promise (pg SQLSTATE), or undefined when it resolved. */
export async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return sqlStateOf(err) ?? `non-pg: ${String(err)}`;
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FixtureTenant {
  id: string;
  slug: string;
  companyId: string;
  categoryId: string;
  statusId: string;
  assetIds: string[];
  assetTags: string[];
}

export const FIXTURE_ASSETS = 5;

/**
 * Creates a tenant through the runtime path (app.provision_tenant under its own tenant context)
 * with overlapping data: every tenant gets a category "Laptops" and assets tagged ISO-001..ISO-005
 * with serials SER-001..SER-005. The same names in both tenants make per-tenant uniqueness bugs and
 * cross-tenant leaks visible.
 */
export async function createFixtureTenant(
  tenancy: TenancyService,
  label: string,
): Promise<FixtureTenant> {
  const id = uuidv7();
  const slug = `iso-${label.toLowerCase()}-${id.slice(-10)}`;
  return tenancy.withTenantTx({ tenantId: id, requestId: `fixture-${label}` }, async (trx: Tx) => {
    await trx.$executeRaw`select app.provision_tenant(${id}::uuid, ${`Isolation ${label}`}, ${slug})`;
    const company = await trx.company.findFirstOrThrow({ select: { id: true } });
    const status = await trx.status_label.findFirstOrThrow({
      where: { is_default: true },
      select: { id: true },
    });
    const categoryId = uuidv7();
    await trx.category.create({
      data: { id: categoryId, tenant_id: id, name: 'Laptops', tag_prefix: 'ISO' },
    });
    const assetIds: string[] = [];
    const assetTags: string[] = [];
    for (let i = 1; i <= FIXTURE_ASSETS; i++) {
      const tag = `ISO-${String(i).padStart(3, '0')}`;
      const assetId = uuidv7();
      await trx.asset.create({
        data: {
          id: assetId,
          tenant_id: id,
          company_id: company.id,
          asset_tag: tag,
          name: `${label} laptop ${i}`,
          serial: `SER-${String(i).padStart(3, '0')}`,
          category_id: categoryId,
          status_id: status.id,
          custom_data: { owner_label: label },
        },
      });
      assetIds.push(assetId);
      assetTags.push(tag);
    }
    for (const action of ['asset.create', 'asset.update']) {
      // audit_log is a partitioned table: tagged-template raw SQL.
      await trx.$executeRaw`
        insert into app.audit_log (id, tenant_id, actor_type, action, entity_type, entity_id)
        values (${uuidv7()}::uuid, ${id}::uuid, 'system', ${action}, 'asset', ${assetIds[0]!}::uuid)`;
    }
    await trx.outbox_event.create({
      data: {
        id: uuidv7(),
        tenant_id: id,
        event_type: 'asset.created',
        aggregate_type: 'asset',
        aggregate_id: assetIds[0]!,
      },
    });
    return {
      id,
      slug,
      companyId: company.id,
      categoryId,
      statusId: status.id,
      assetIds,
      assetTags,
    };
  });
}
