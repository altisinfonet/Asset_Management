import { Prisma, isLocationScoped, locationScopeSql, type Tx } from '../tenancy/index.js';
import type { OwnerType } from './schemas.js';

/**
 * What an attachment can hang off (polymorphic `entity_type` + `entity_id`, no database foreign key).
 * The owner is resolved TENANT-SCOPED by the application: the query runs in the caller's tenant
 * transaction, so under RLS another tenant's id simply does not exist.
 *
 * M2 owners arrive wave by wave (accessories, locations, people, repairs, assignments, imports):
 * a type whose table is not installed yet answers "not available" instead of failing, so the same
 * attachments API serves the check-in photos (`assignment`), repair photos, etc. as soon as the
 * respective migration is applied, with no change here.
 */
const TABLES: Record<OwnerType, string> = {
  asset: 'app.asset',
  asset_model: 'app.asset_model',
  accessory: 'app.accessory',
  consumable: 'app.consumable',
  location: 'app.location',
  person: 'app.person',
  maintenance_record: 'app.maintenance_record',
  assignment: 'app.assignment',
  import_job: 'app.import_job',
};

const installed = new Set<OwnerType>();

async function tableInstalled(trx: Tx, type: OwnerType): Promise<boolean> {
  if (installed.has(type)) return true;
  const [row] = await trx.$queryRaw<Array<{ ok: boolean }>>`
    select to_regclass(${TABLES[type]}::text) is not null as ok`;
  if (row?.ok) installed.add(type);
  return Boolean(row?.ok);
}

export type OwnerLookup = 'found' | 'missing' | 'unavailable';

/** Does `id` exist (and is it not archived) among the tenant's owners of `type`? */
export async function lookupOwner(trx: Tx, type: OwnerType, id: string): Promise<OwnerLookup> {
  if (!(await tableInstalled(trx, type))) return 'unavailable';
  // One tagged query per table: identifiers cannot be bound parameters, and a dynamic identifier
  // would defeat the ban on unsafe raw SQL.
  let rows: unknown[];
  switch (type) {
    case 'asset':
      rows =
        await trx.$queryRaw`select 1 from app.asset where id = ${id}::uuid and archived_at is null`;
      break;
    case 'asset_model':
      rows =
        await trx.$queryRaw`select 1 from app.asset_model where id = ${id}::uuid and archived_at is null`;
      break;
    case 'accessory':
      rows = await trx.$queryRaw`select 1 from app.accessory where id = ${id}::uuid`;
      break;
    case 'consumable':
      rows = await trx.$queryRaw`select 1 from app.consumable where id = ${id}::uuid`;
      break;
    case 'location':
      rows = await trx.$queryRaw`select 1 from app.location where id = ${id}::uuid`;
      break;
    case 'person':
      rows = await trx.$queryRaw`select 1 from app.person where id = ${id}::uuid`;
      break;
    case 'maintenance_record':
      rows = await trx.$queryRaw`select 1 from app.maintenance_record where id = ${id}::uuid`;
      break;
    case 'assignment':
      rows = await trx.$queryRaw`select 1 from app.assignment where id = ${id}::uuid`;
      break;
    case 'import_job':
      rows = await trx.$queryRaw`select 1 from app.import_job where id = ${id}::uuid`;
      break;
  }
  if (rows.length === 0) return 'missing';
  return (await ownerInScope(trx, type, id)) ? 'found' : 'missing';
}

/**
 * M2-LOC-03 (ED-26): is the owner record inside the caller's location scope? (Always true when the
 * transaction is not scoped.) Assets, stock, people and locations by their location, repairs and
 * custody rows by their asset or accessory, imports by who started them; models are catalogue.
 */
export async function ownerInScope(trx: Tx, type: string, id: string): Promise<boolean> {
  if (!isLocationScoped()) return true;
  const inScope = (column: Prisma.Sql) => locationScopeSql(column);
  let rows: unknown[];
  switch (type) {
    case 'asset_model':
      return true;
    case 'asset':
      rows = await trx.$queryRaw`select 1 from app.asset a
        where a.id = ${id}::uuid and ${inScope(Prisma.sql`a.location_id`)}`;
      break;
    case 'accessory':
      rows = await trx.$queryRaw`select 1 from app.accessory x
        where x.id = ${id}::uuid and ${inScope(Prisma.sql`x.location_id`)}`;
      break;
    case 'consumable':
      rows = await trx.$queryRaw`select 1 from app.consumable x
        where x.id = ${id}::uuid and ${inScope(Prisma.sql`x.location_id`)}`;
      break;
    case 'location':
      rows = await trx.$queryRaw`select 1 from app.location x
        where x.id = ${id}::uuid and ${inScope(Prisma.sql`x.id`)}`;
      break;
    case 'person':
      rows = await trx.$queryRaw`select 1 from app.person x
        where x.id = ${id}::uuid and ${inScope(Prisma.sql`x.location_id`)}`;
      break;
    case 'maintenance_record':
      rows = await trx.$queryRaw`select 1 from app.maintenance_record r
        join app.asset a on a.tenant_id = r.tenant_id and a.id = r.asset_id
        where r.id = ${id}::uuid and ${inScope(Prisma.sql`a.location_id`)}`;
      break;
    case 'assignment':
      rows = await trx.$queryRaw`select 1 from app.assignment s
        left join app.asset a on a.tenant_id = s.tenant_id and a.id = s.asset_id
        left join app.accessory x on x.tenant_id = s.tenant_id and x.id = s.accessory_id
        where s.id = ${id}::uuid
          and (${inScope(Prisma.sql`a.location_id`)} or ${inScope(Prisma.sql`x.location_id`)})`;
      break;
    case 'import_job':
      rows = await trx.$queryRaw`select 1 from app.import_job j
        where j.id = ${id}::uuid and j.requested_by::text = current_setting('app.actor_id', true)`;
      break;
    default:
      return false;
  }
  return rows.length > 0;
}
