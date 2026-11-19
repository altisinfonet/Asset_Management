import type { Tx } from '../tenancy/index.js';
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
  return rows.length > 0 ? 'found' : 'missing';
}
