import type { AuthContext } from '../auth/index.js';
import { currentBulkSink } from '../context/bulk-writes.js';
import { currentRequestId } from '../context/request-context.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { type Page, nextTsIdCursor, readTsIdCursor, tsText } from '../platform/index.js';
import { Prisma, type Tx } from '../tenancy/index.js';

/**
 * The user-facing chain of custody (M2-LIFE-06, ED-09): `app.asset_history`, append-only and
 * partitioned by month. Every change of an asset that matters to a person reading its timeline
 * writes one row IN THE SAME TRANSACTION as the change (and next to the audit row and the outbox
 * event): creation, status and location changes, custody, archiving. Raw tagged SQL because the
 * table is partitioned and the list needs microsecond keyset paging.
 */

export const HISTORY_EVENT_TYPES = [
  'created',
  'updated',
  'status_changed',
  'location_changed',
  'checked_out',
  'checked_in',
  'transferred',
  'repair_opened',
  'repair_completed',
  'archived',
  'restored',
  'label_printed',
  'imported',
] as const;
export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export interface HistoryEntry {
  assetId: string;
  eventType: HistoryEventType;
  summary?: string | null;
  /** Event details (ids and short values; shown to everybody who may read the asset). */
  payload?: Record<string, unknown>;
  assignmentId?: string | null;
  transferId?: string | null;
}

/** Who acted, as `asset_history.actor_type` / `actor_id` say it (an API key acts as itself). */
export function historyActor(auth: AuthContext): { type: 'user' | 'api_key'; id: string } {
  return auth.method === 'api_key' && auth.apiKeyId
    ? { type: 'api_key', id: auth.apiKeyId }
    : { type: 'user', id: auth.userId };
}

/** Appends one history row inside the caller's tenant transaction; returns its id. */
export async function writeAssetHistory(
  trx: Tx,
  auth: AuthContext,
  entry: HistoryEntry,
): Promise<string> {
  const id = uuidv7();
  const actor = historyActor(auth);
  const payload = JSON.stringify(entry.payload ?? {});
  const sink = currentBulkSink();
  if (sink) {
    sink.history.push({
      id,
      tenant_id: auth.tenantId,
      asset_id: entry.assetId,
      event_type: entry.eventType,
      actor_type: actor.type,
      actor_id: actor.id,
      assignment_id: entry.assignmentId ?? null,
      transfer_id: entry.transferId ?? null,
      summary: entry.summary ?? null,
      payload,
      request_id: currentRequestId() ?? null,
    });
    return id;
  }
  await trx.$executeRaw`
    insert into app.asset_history
      (id, tenant_id, asset_id, at, event_type, actor_type, actor_id, assignment_id, transfer_id,
       summary, payload, request_id)
    values (${id}::uuid, ${auth.tenantId}::uuid, ${entry.assetId}::uuid, clock_timestamp(),
            ${entry.eventType}::text, ${actor.type}::text, ${actor.id}::uuid,
            ${entry.assignmentId ?? null}::uuid, ${entry.transferId ?? null}::uuid,
            ${entry.summary ?? null}::text, ${payload}::jsonb, ${currentRequestId() ?? null}::text)`;
  return id;
}

interface HistoryRow {
  id: string;
  asset_id: string;
  asset_tag: string | null;
  at: Date;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  assignment_id: string | null;
  transfer_id: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  k0: string;
  k1: string;
}

export interface HistoryEventDto {
  id: string;
  asset_id: string;
  asset_tag: string | null;
  at: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  actor: { id: string; display_name: string } | null;
  assignment_id: string | null;
  transfer_id: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
}

export interface HistoryFilter {
  /** Events of one asset... */
  assetId?: string;
  /** ...or of one person (their assignments and the transfers out of them). */
  personId?: string;
  eventTypes?: string[];
  from?: string;
  to?: string;
}

/**
 * One page of the timeline, newest first. `actor` is resolved for display (user name, or the API
 * key name); it is null for system events and for an actor that no longer exists.
 */
export async function listHistory(
  trx: Tx,
  filter: HistoryFilter,
  query: { cursor?: string; limit: number },
): Promise<Page<HistoryEventDto>> {
  const cur = readTsIdCursor(query.cursor, filter);
  const where: Prisma.Sql[] = [];
  if (filter.assetId) where.push(Prisma.sql`h.asset_id = ${filter.assetId}::uuid`);
  if (filter.personId) {
    where.push(
      Prisma.sql`(h.assignment_id in (select s.id from app.assignment s where s.person_id = ${filter.personId}::uuid)
        or h.transfer_id in (select t.id from app.transfer t
                              where t.from_assignment_id in
                                    (select s.id from app.assignment s where s.person_id = ${filter.personId}::uuid)))`,
    );
  }
  if (filter.eventTypes?.length)
    where.push(Prisma.sql`h.event_type = any(${filter.eventTypes}::text[])`);
  if (filter.from) where.push(Prisma.sql`h.at >= ${filter.from}::timestamptz`);
  if (filter.to) where.push(Prisma.sql`h.at < ${filter.to}::timestamptz`);
  if (cur.after) {
    where.push(Prisma.sql`(h.at, h.id) < (${cur.after.ts}::timestamptz, ${cur.after.id}::uuid)`);
  }
  const condition = where.length ? Prisma.join(where, ' and ') : Prisma.sql`true`;
  const rows = await trx.$queryRaw<HistoryRow[]>`
    select h.id, h.asset_id, a.asset_tag, h.at, h.event_type, h.actor_type, h.actor_id,
           h.assignment_id, h.transfer_id, h.summary, h.payload,
           ${Prisma.raw(tsText('h.at'))} as k0, h.id::text as k1
      from app.asset_history h
      left join app.asset a on a.tenant_id = h.tenant_id and a.id = h.asset_id
     where ${condition}
     order by h.at desc, h.id desc
     limit ${query.limit + 1}`;
  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const actors = await resolveActors(trx, page);
  const last = page.at(-1);
  return {
    data: page.map((r) => ({
      id: r.id,
      asset_id: r.asset_id,
      asset_tag: r.asset_tag,
      at: r.at.toISOString(),
      event_type: r.event_type,
      actor_type: r.actor_type,
      actor_id: r.actor_id,
      actor: r.actor_id ? (actors.get(`${r.actor_type}:${r.actor_id}`) ?? null) : null,
      assignment_id: r.assignment_id,
      transfer_id: r.transfer_id,
      summary: r.summary,
      payload: r.payload,
    })),
    page: {
      next_cursor: hasMore && last ? nextTsIdCursor(cur.binding, last) : null,
      has_more: hasMore,
    },
  };
}

async function resolveActors(
  trx: Tx,
  rows: HistoryRow[],
): Promise<Map<string, { id: string; display_name: string }>> {
  const out = new Map<string, { id: string; display_name: string }>();
  const ids = (type: string) => [
    ...new Set(rows.filter((r) => r.actor_type === type && r.actor_id).map((r) => r.actor_id!)),
  ];
  const users = ids('user');
  if (users.length > 0) {
    for (const u of await trx.user_account.findMany({
      where: { id: { in: users } },
      select: { id: true, display_name: true },
    })) {
      out.set(`user:${u.id}`, { id: u.id, display_name: u.display_name });
    }
  }
  const keys = ids('api_key');
  if (keys.length > 0) {
    for (const k of await trx.api_key.findMany({
      where: { id: { in: keys } },
      select: { id: true, name: true },
    })) {
      out.set(`api_key:${k.id}`, { id: k.id, display_name: k.name });
    }
  }
  return out;
}

/** One multi-row INSERT of the history rows a bulk job collected. */
export async function flushHistoryRows(
  trx: Tx,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  if (rows.length === 0) return;
  const col = (key: string) => rows.map((r) => (r[key] ?? null) as string | null);
  await trx.$executeRaw`
    insert into app.asset_history
      (id, tenant_id, asset_id, at, event_type, actor_type, actor_id, assignment_id, transfer_id,
       summary, payload, request_id)
    select t.id::uuid, t.tenant_id::uuid, t.asset_id::uuid, clock_timestamp(), t.event_type, t.actor_type,
           t.actor_id::uuid, t.assignment_id::uuid, t.transfer_id::uuid, t.summary, t.payload::jsonb, t.request_id
      from unnest(${col('id')}::text[], ${col('tenant_id')}::text[], ${col('asset_id')}::text[],
                  ${col('event_type')}::text[], ${col('actor_type')}::text[], ${col('actor_id')}::text[],
                  ${col('assignment_id')}::text[], ${col('transfer_id')}::text[], ${col('summary')}::text[],
                  ${col('payload')}::text[], ${col('request_id')}::text[])
           as t(id, tenant_id, asset_id, event_type, actor_type, actor_id, assignment_id, transfer_id, summary, payload, request_id)`;
}
