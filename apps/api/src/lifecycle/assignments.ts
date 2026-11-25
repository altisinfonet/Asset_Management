import { type Page, nextTsIdCursor, readTsIdCursor, tsText } from '../platform/index.js';
import { isLocationScoped, locationScopeSql, Prisma, type Tx } from '../tenancy/index.js';

/** One row of `app.assignment` as the raw queries return it. */
export interface AssignmentRow {
  id: string;
  asset_id: string | null;
  accessory_id: string | null;
  person_id: string | null;
  location_id: string | null;
  target_asset_id: string | null;
  quantity: number;
  quantity_returned: number;
  loaner_pool_id: string | null;
  checked_out_at: Date;
  checked_out_by: string | null;
  expected_return: Date | null;
  checked_in_at: Date | null;
  checked_in_by: string | null;
  checkin_location_id: string | null;
  acceptance_state: string;
  note: string | null;
  checkin_note: string | null;
  attachment_ids: string[];
  checkin_attachment_ids: string[];
  checkin_condition: string | null;
  version: number;
}

export interface AssignmentExtras {
  asset_tag?: string | null;
  asset_name?: string | null;
  /** [M2-W2 ACC] accessory assignments */
  accessory_name?: string | null;
  target_name?: string | null;
}

/** `YYYY-MM-DD` of today in UTC: the "today" of the overdue rule (the SQL side uses the same day). */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Schema `Assignment`. `overdue` is computed: open, due date set and before today (UTC). */
export function assignmentDto(r: AssignmentRow, extras: AssignmentExtras = {}) {
  const due = isoDay(r.expected_return);
  return {
    id: r.id,
    asset_id: r.asset_id,
    accessory_id: r.accessory_id,
    person_id: r.person_id,
    location_id: r.location_id,
    target_asset_id: r.target_asset_id,
    quantity: r.quantity,
    quantity_returned: r.quantity_returned,
    loaner_pool_id: r.loaner_pool_id,
    checked_out_at: r.checked_out_at.toISOString(),
    checked_out_by: r.checked_out_by,
    expected_return: due,
    checked_in_at: r.checked_in_at ? r.checked_in_at.toISOString() : null,
    checked_in_by: r.checked_in_by,
    checkin_location_id: r.checkin_location_id,
    acceptance_state: r.acceptance_state,
    note: r.note,
    checkin_note: r.checkin_note,
    attachment_ids: r.attachment_ids,
    checkin_attachment_ids: r.checkin_attachment_ids,
    checkin_condition: r.checkin_condition,
    overdue: r.checked_in_at === null && due !== null && due < todayUtc(),
    ...(extras.asset_tag !== undefined ? { asset_tag: extras.asset_tag } : {}),
    ...(extras.asset_name !== undefined ? { asset_name: extras.asset_name } : {}),
    ...(extras.accessory_name !== undefined ? { accessory_name: extras.accessory_name } : {}),
    ...(extras.target_name !== undefined ? { target_name: extras.target_name } : {}),
  };
}

export const ASSIGNMENT_COLUMNS = Prisma.sql`s.id, s.asset_id, s.accessory_id, s.person_id, s.location_id,
  s.target_asset_id, s.quantity, s.quantity_returned, s.loaner_pool_id, s.checked_out_at, s.checked_out_by,
  s.expected_return, s.checked_in_at, s.checked_in_by, s.checkin_location_id, s.acceptance_state, s.note,
  s.checkin_note, s.attachment_ids, s.checkin_attachment_ids, s.checkin_condition, s.version`;

export async function loadAssignment(trx: Tx, id: string): Promise<AssignmentRow | null> {
  const [row] = await trx.$queryRaw<AssignmentRow[]>`
    select ${ASSIGNMENT_COLUMNS} from app.assignment s where s.id = ${id}::uuid`;
  return row ?? null;
}

/**
 * One page of assignments, newest first (`checked_out_at desc, id desc`), for an asset, a person or an
 * accessory. Rows carry the asset's tag and name (or the accessory's name and, in an accessory's own
 * list, the holder's name) for display. A person's list holds asset AND accessory assignments.
 */
export async function listAssignments(
  trx: Tx,
  scope:
    | { assetId: string }
    | { personId: string; state: 'open' | 'closed' | 'all' }
    | { accessoryId: string; state: 'open' | 'closed' | 'all' },
  query: { cursor?: string | undefined; limit: number },
): Promise<Page<ReturnType<typeof assignmentDto>>> {
  const filters = 'assetId' in scope ? { assetId: scope.assetId } : scope;
  const cur = readTsIdCursor(query.cursor, filters);
  const where: Prisma.Sql[] = [];
  if ('assetId' in scope) where.push(Prisma.sql`s.asset_id = ${scope.assetId}::uuid`);
  else {
    if ('personId' in scope) where.push(Prisma.sql`s.person_id = ${scope.personId}::uuid`);
    else where.push(Prisma.sql`s.accessory_id = ${scope.accessoryId}::uuid`);
    if (scope.state === 'open') where.push(Prisma.sql`s.checked_in_at is null`);
    if (scope.state === 'closed') where.push(Prisma.sql`s.checked_in_at is not null`);
  }
  if ('personId' in scope && isLocationScoped()) {
    // M2-LOC-03 (ED-26): a person's custody list shows only the items inside the caller's scope
    where.push(Prisma.sql`(s.asset_id is null or ${locationScopeSql(Prisma.sql`a.location_id`)})`);
    where.push(
      Prisma.sql`(s.accessory_id is null or ${locationScopeSql(Prisma.sql`ac.location_id`)})`,
    );
  }
  const forAccessory = 'accessoryId' in scope;
  if (cur.after) {
    where.push(
      Prisma.sql`(s.checked_out_at, s.id) < (${cur.after.ts}::timestamptz, ${cur.after.id}::uuid)`,
    );
  }
  type Row = AssignmentRow & {
    asset_tag: string | null;
    asset_name: string | null;
    accessory_name: string | null;
    target_name: string | null;
    k0: string;
    k1: string;
  };
  const rows = await trx.$queryRaw<Row[]>`
    select ${ASSIGNMENT_COLUMNS}, a.asset_tag, a.name as asset_name, ac.name as accessory_name,
           coalesce(tp.display_name, tl.name, nullif(concat_ws(' ', ta.asset_tag, ta.name), '')) as target_name,
           ${Prisma.raw(tsText('s.checked_out_at'))} as k0, s.id::text as k1
      from app.assignment s
      left join app.asset a on a.tenant_id = s.tenant_id and a.id = s.asset_id
      left join app.accessory ac on ac.tenant_id = s.tenant_id and ac.id = s.accessory_id
      left join app.person tp on tp.tenant_id = s.tenant_id and tp.id = s.person_id
      left join app.location tl on tl.tenant_id = s.tenant_id and tl.id = s.location_id
      left join app.asset ta on ta.tenant_id = s.tenant_id and ta.id = s.target_asset_id
     where ${Prisma.join(where, ' and ')}
     order by s.checked_out_at desc, s.id desc
     limit ${query.limit + 1}`;
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);
  return {
    data: page.map((r) =>
      assignmentDto(r, {
        asset_tag: r.asset_tag,
        asset_name: r.asset_name,
        ...(r.accessory_id ? { accessory_name: r.accessory_name } : {}),
        ...(forAccessory ? { target_name: r.target_name } : {}),
      }),
    ),
    page: {
      next_cursor: hasMore && last ? nextTsIdCursor(cur.binding, last) : null,
      has_more: hasMore,
    },
  };
}
