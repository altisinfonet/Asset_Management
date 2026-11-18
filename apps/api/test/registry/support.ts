import { Global, Module } from '@nestjs/common';
import { PgAuditWriter } from '../../src/audit/index.js';
import { PgOutboxPublisher } from '../../src/outbox/index.js';
import type { OutboxEvent } from '../../src/ports/index.js';
import type { Tx } from '../../src/tenancy/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  MAIL_SENDER,
  OUTBOX_PUBLISHER,
  SECRET_BOX,
} from '../../src/ports/index.js';
import {
  type Client,
  createTenant,
  createUser,
  newTenancy,
  startApp,
  testPorts,
  type TenantFixture,
  type UserFixture,
} from '../auth/support.js';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ownerTenantSql } from '../auth/support.js';

export { createTenant, createUser, newTenancy, ownerTenantSql, testPorts };
export type { Client, TenantFixture, UserFixture };

/** Fault injection: make the outbox fail for one event type (the change must roll back with it). */
export const faults: { outboxFailsFor: string | null } = { outboxFailsFor: null };

class FaultyOutbox extends PgOutboxPublisher {
  override async publish(tx: Tx, event: OutboxEvent): Promise<void> {
    if (faults.outboxFailsFor === event.type) throw new Error('injected outbox failure');
    return super.publish(tx, event);
  }
}

/**
 * Ports for the registry suites: the REAL audit writer and outbox publisher (so the tests read the
 * rows back from `app.audit_log` / `app.outbox_event`), fakes for mail, jobs and the secret box.
 */
@Global()
@Module({
  providers: [
    { provide: AUDIT_WRITER, useFactory: () => new PgAuditWriter() },
    { provide: OUTBOX_PUBLISHER, useFactory: () => new FaultyOutbox() },
    { provide: MAIL_SENDER, useValue: testPorts.mail },
    { provide: SECRET_BOX, useValue: testPorts.secretBox },
    { provide: JOB_QUEUE, useValue: testPorts.jobs },
  ],
  exports: [AUDIT_WRITER, OUTBOX_PUBLISHER, MAIL_SENDER, SECRET_BOX, JOB_QUEUE],
})
export class RegistryTestPortsModule {}

export const startRegistryApp = (extra: Record<string, string> = {}) =>
  startApp(extra, { ports: RegistryTestPortsModule });

export type App = NestFastifyApplication;

/** Audit rows of a tenant (newest last), read as the owner under the tenant context. */
export async function auditRows(tenantId: string, filter = '') {
  const res = await ownerTenantSql(
    tenantId,
    `select action, entity_type, entity_id, diff, request_id, actor_type from app.audit_log
      ${filter ? `where ${filter}` : ''} order by at, id`,
  );
  return res.rows as Array<{
    action: string;
    entity_type: string;
    entity_id: string | null;
    diff: {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      meta?: Record<string, unknown>;
    } | null;
    request_id: string | null;
    actor_type: string;
  }>;
}

export async function outboxRows(tenantId: string, filter = '') {
  const res = await ownerTenantSql(
    tenantId,
    `select event_type, aggregate_type, aggregate_id, payload from app.outbox_event
      ${filter ? `where ${filter}` : ''} order by created_at, id`,
  );
  return res.rows as Array<{
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    payload: Record<string, unknown>;
  }>;
}

let n = 0;
export const unique = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(n++).toString(36)}`;

/** Creates a category + model + asset through the API; returns ids and the asset body. */
export async function seedBasics(admin: Client) {
  const category = await admin.post('/v1/categories', { name: unique('Cat'), tag_prefix: 'CAT-' });
  const manufacturer = await admin.post('/v1/manufacturers', { name: unique('Maker') });
  const model = await admin.post('/v1/models', {
    category_id: category.body.id,
    manufacturer_id: manufacturer.body.id,
    name: unique('Model'),
    model_number: unique('MN'),
  });
  return { category: category.body, manufacturer: manufacturer.body, model: model.body };
}

/**
 * Inserts `count` assets for a tenant straight through SQL (owner role under the tenant context):
 * every row of one call shares the same created_at (the worst case for a keyset cursor), unless
 * `spread` makes the timestamps distinct. Read them back through the API.
 */
export async function insertAssets(
  tenantId: string,
  categoryId: string,
  statusId: string,
  count: number,
  opts: {
    tagPrefix: string;
    spread?: boolean;
    modelId?: string | null;
    vendorId?: string | null;
  } = { tagPrefix: 'BULK-' },
) {
  await ownerTenantSql(
    tenantId,
    `insert into app.asset (id, tenant_id, company_id, asset_tag, name, serial, category_id, model_id, vendor_id, status_id,
                            purchase_date, warranty_end, notes, custom_data, created_at, updated_at)
       select gen_random_uuid(), $1::uuid, (select id from app.company where is_default), $2 || lpad(g::text, 6, '0'),
              'Bulk asset ' || g, 'SER-' || $2 || g, $3::uuid, $6::uuid, $7::uuid, $4::uuid,
              case when g % 3 = 0 then null else date '2024-01-01' + (g % 200) end,
              case when g % 4 = 0 then null else date '2027-01-01' + (g % 100) end,
              case when g % 5 = 0 then 'keyboard layout swapped; needs a new keycap set' else null end,
              jsonb_build_object('n', g, 'even', g % 2 = 0),
              case when $5::boolean then now() - (g || ' seconds')::interval else now() end,
              case when $5::boolean then now() - (g || ' seconds')::interval else now() end
         from generate_series(1, $8::int) g`,
    [
      tenantId,
      opts.tagPrefix,
      categoryId,
      statusId,
      opts.spread ?? false,
      opts.modelId ?? null,
      opts.vendorId ?? null,
      count,
    ],
  );
}

export async function defaultStatusId(admin: Client): Promise<string> {
  const list = await admin.get('/v1/status-labels');
  return list.body.data.find((s: { is_default: boolean }) => s.is_default).id;
}
