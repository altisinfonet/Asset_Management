import { isIP } from 'node:net';
import { currentBulkSink } from '../context/bulk-writes.js';
import { type ActorType, currentRequestContext } from '../context/request-context.js';
import { uuidv7 } from '../ids/uuidv7.js';
import type { AuditEntry, AuditWriter } from '../ports/index.js';
import { currentTenantContext, type Tx } from '../tenancy/index.js';
import { redactSensitive } from './redact.js';

/**
 * Appends to the partitioned, append-only `app.audit_log` INSIDE the caller's transaction, so the
 * audit row and the change it describes commit or roll back together (M1-PLAT-04).
 *
 * Everything not in the entry comes from ambient state, never from the caller:
 *   - tenant id, actor id, request id: the transaction-local GUCs `withTenantTx` set
 *     (`app.tenant_id`, `app.actor_id`, `app.request_id`), read inside the INSERT itself, so a row
 *     can only ever describe the tenant the transaction belongs to (RLS WITH CHECK also enforces it);
 *   - actor type, client ip and user agent: the request context (`context/request-context.ts`).
 *     Actor type resolution: explicit `actorType` on the context (auth guard / job wrapper) wins;
 *     otherwise a transaction with an actor id inside an HTTP request is a `user`, anything else
 *     (no request, no actor) is `system`.
 *
 * `app_user` holds INSERT and SELECT only on the partitioned parent: UPDATE and DELETE fail with
 * 42501, so the log cannot be altered through the application role. Raw tagged SQL because the
 * table is partitioned (the Prisma model cannot target the parent reliably) and to keep the write
 * to a single round trip.
 */
export class PgAuditWriter implements AuditWriter {
  async write(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = currentRequestContext();
    const tenantTx = currentTenantContext();
    const actorType = resolveActorType(ctx?.actorType, Boolean(ctx), tenantTx?.actorId);
    const diff = buildDiffJson(entry);
    const ip = ctx?.ip && isIP(ctx.ip) ? ctx.ip : null;
    const userAgent = ctx?.userAgent ? ctx.userAgent.slice(0, 512) : null;

    const sink = currentBulkSink();
    if (sink) {
      // a bulk job: the row is inserted with its batch (`flushAuditRows`)
      sink.audit.push({
        id: uuidv7(),
        actor_type: actorType,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        diff,
        ip,
        user_agent: userAgent,
      });
      return;
    }

    await tx.$executeRaw`
      insert into app.audit_log
        (id, tenant_id, actor_type, actor_user_id, actor_ref, action, entity_type, entity_id,
         diff, ip, user_agent, request_id)
      select ${uuidv7()}::uuid,
             a.tenant_id,
             ${actorType}::text,
             case when ${actorType}::text = 'user' then a.actor_id end,
             case when ${actorType}::text <> 'user' then a.actor_id end,
             ${entry.action}::text,
             ${entry.entityType}::text,
             ${entry.entityId}::uuid,
             ${diff}::jsonb,
             ${ip}::inet,
             ${userAgent}::text,
             a.request_id
        from (select nullif(current_setting('app.tenant_id', true), '')::uuid  as tenant_id,
                     nullif(current_setting('app.actor_id', true), '')::uuid   as actor_id,
                     nullif(current_setting('app.request_id', true), '')       as request_id) a`;
  }
}

function resolveActorType(
  explicit: ActorType | undefined,
  inRequest: boolean,
  actorId: string | undefined,
): ActorType {
  if (explicit) return explicit;
  return inRequest && actorId ? 'user' : 'system';
}

function buildDiffJson(entry: AuditEntry): string | null {
  const body: Record<string, unknown> = {};
  if (entry.before !== undefined && entry.before !== null)
    body.before = redactSensitive(entry.before);
  if (entry.after !== undefined && entry.after !== null) body.after = redactSensitive(entry.after);
  if (entry.meta && Object.keys(entry.meta).length > 0) body.meta = redactSensitive(entry.meta);
  return Object.keys(body).length > 0 ? JSON.stringify(body) : null;
}

/** One multi-row INSERT of the audit rows a bulk job collected (same columns, same ambient tenant / actor / request). */
export async function flushAuditRows(tx: Tx, rows: Array<Record<string, unknown>>): Promise<void> {
  if (rows.length === 0) return;
  const col = (key: string) => rows.map((r) => (r[key] ?? null) as string | null);
  await tx.$executeRaw`
    insert into app.audit_log
      (id, tenant_id, actor_type, actor_user_id, actor_ref, action, entity_type, entity_id,
       diff, ip, user_agent, request_id)
    select t.id::uuid,
           a.tenant_id,
           t.actor_type,
           case when t.actor_type = 'user' then a.actor_id end,
           case when t.actor_type <> 'user' then a.actor_id end,
           t.action,
           t.entity_type,
           t.entity_id::uuid,
           t.diff::jsonb,
           t.ip::inet,
           t.user_agent,
           a.request_id
      from unnest(${col('id')}::text[], ${col('actor_type')}::text[], ${col('action')}::text[],
                  ${col('entity_type')}::text[], ${col('entity_id')}::text[], ${col('diff')}::text[],
                  ${col('ip')}::text[], ${col('user_agent')}::text[])
           as t(id, actor_type, action, entity_type, entity_id, diff, ip, user_agent)
     cross join (select nullif(current_setting('app.tenant_id', true), '')::uuid  as tenant_id,
                        nullif(current_setting('app.actor_id', true), '')::uuid   as actor_id,
                        nullif(current_setting('app.request_id', true), '')       as request_id) a`;
}
