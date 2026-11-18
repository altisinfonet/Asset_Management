import 'reflect-metadata';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgAuditWriter } from '../src/audit/index.js';
import { loadConfig } from '../src/config/env.js';
import { runWithRequestContext } from '../src/context/request-context.js';
import { ControlPlaneService, AllModulesOnEntitlementSource } from '../src/control-plane/index.js';
import { provisionJobs, grantJobsAccess, verifyJobsGrants } from '../src/db/provision-jobs.js';
import { withOwnerClient } from '../src/db/maintenance.js';
import { EnvelopeSecretBox, LocalKeyProvider } from '../src/crypto/index.js';
import {
  JobAdmin,
  JobHandlerRegistry,
  JobWorker,
  JobsRuntime,
  Scheduler,
  TenantPayloadError,
} from '../src/jobs/index.js';
import {
  QueuedMailSender,
  SmtpMailTransport,
  registerMailJob,
  type MailTransport,
} from '../src/mail/index.js';
import { OutboxRelay, OutboxSubscribers, PgOutboxPublisher } from '../src/outbox/index.js';
import { uuidv7 } from '../src/ids/uuidv7.js';
import { sqlStateOf } from '../src/tenancy/index.js';
import {
  createFixtureTenant,
  dbEnabled,
  env,
  FIXTURE_ASSETS,
  jobsSchema,
  type FixtureTenant,
  mode,
  newTenancy,
  sleep,
  withClient,
} from './support/db.js';
import { randomBytes } from 'node:crypto';

/**
 * Platform services against a real database (M1-PLAT-04..09). Runs direct or through PgBouncer
 * (`DATABASE_URL`): the job path is exactly the one the spike validated. Mail needs Mailpit
 * (`SMTP_URL` + `MAILPIT_API_URL`); that block is skipped when they are not set.
 */
const smtpUrl = process.env.SMTP_URL;
const mailpitApi = process.env.MAILPIT_API_URL;
const silent = pino({ level: 'silent' });

async function waitFor<T>(
  fn: () => Promise<T | undefined | false>,
  ms = 30_000,
  what = 'condition',
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

describe.skipIf(!dbEnabled)(`platform services (${mode})`, () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: env.databaseUrl,
    LOG_LEVEL: 'silent',
    JOBS_POOL_MAX: '4',
    JOBS_SCHEMA: jobsSchema,
  });
  const tenancy = newTenancy();
  const controlPlane = new ControlPlaneService(tenancy, new AllModulesOnEntitlementSource());
  const runtime = new JobsRuntime(config);
  const registry = new JobHandlerRegistry();
  const master = randomBytes(32);
  const secrets = new EnvelopeSecretBox(new LocalKeyProvider({ mk1: master }, 'mk1'));
  const run = Date.now() % 1_000_000_000;
  let A: FixtureTenant;
  let B: FixtureTenant;
  let worker: JobWorker;

  interface Seen {
    tenantId: string;
    guc: string;
    visibleTenants: string[];
    visibleAssets: number;
    actor: string;
    requestId: string;
  }
  const seen = new Map<number, Seen>();

  // The mail transport records what would be sent over SMTP unless Mailpit is configured.
  const smtp: MailTransport | undefined = smtpUrl ? new SmtpMailTransport(smtpUrl) : undefined;

  beforeAll(async () => {
    // Provisioning is the migrate step; the e2e database was migrated by CI/compose already, and a
    // second run must be a harmless no-op.
    await provisionJobs(env.migratorUrl!, { info: () => undefined }, jobsSchema);

    A = await createFixtureTenant(tenancy, 'JA');
    B = await createFixtureTenant(tenancy, 'JB');

    registry.registerTenant('tenant.heartbeat', async (payload, ctx) => {
      const bucket = Number(payload.bucket);
      if (payload.fail === true) throw new Error('boom (test)');
      const rows = await ctx.tx.$queryRaw<
        { guc: string; actor: string; req: string; tenants: string[]; assets: number }[]
      >`select current_setting('app.tenant_id', true) as guc,
               current_setting('app.actor_id', true) as actor,
               current_setting('app.request_id', true) as req,
               coalesce((select array_agg(distinct tenant_id::text) from app.asset), '{}') as tenants,
               (select count(*)::int from app.asset) as assets`;
      const r = rows[0]!;
      seen.set(bucket, {
        tenantId: ctx.tenantId,
        guc: r.guc,
        visibleTenants: r.tenants,
        visibleAssets: r.assets,
        actor: r.actor,
        requestId: r.req,
      });
    });
    registerMailJob(registry, {
      secrets,
      transport: smtp ?? { deliver: async () => ({ messageId: 'noop' }), close() {} },
      from: 'Asset Tracker <no-reply@assettracker.test>',
    });

    worker = new JobWorker(
      { boss: await runtime.get(), tenancy, controlPlane, registry, logger: silent },
      { runner: 'worker', pollingIntervalSeconds: 1, localConcurrency: 4, tenantConcurrency: 2 },
    );
    await worker.start();
  });

  afterAll(async () => {
    await worker?.stop(10_000);
    await runtime.onApplicationShutdown();
    smtp?.close();
    await tenancy.onModuleDestroy();
  });

  // ------------------------------------------------------------------ PLAT-06 jobs
  describe('jobs on pg-boss (M1-PLAT-06/07)', () => {
    it('a job enqueued inside a tenant transaction is processed by the worker under THAT tenant', async () => {
      const bucket = run * 10 + 1;
      await tenancy.withTenantTx({ tenantId: A.id, requestId: 'req-enqueue' }, async (tx) => {
        const id = await runtime.queue.enqueue(
          'tenant.heartbeat',
          { tenantId: A.id, bucket },
          { tx },
        );
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
      });
      const got = await waitFor(
        async () => seen.get(bucket),
        30_000,
        'the worker to process the job',
      );
      expect(got.tenantId).toBe(A.id);
      expect(got.guc).toBe(A.id);
      expect(got.visibleTenants).toEqual([A.id]); // RLS: only tenant A's assets are visible
      expect(got.visibleAssets).toBe(FIXTURE_ASSETS);
      expect(got.actor).toMatch(/^[0-9a-f-]{36}$/); // the job id is the actor (system)
      expect(got.requestId).toBe(`job:${got.actor}`);
    });

    it('a rolled-back transaction enqueues NOTHING; a committed one enqueues exactly one job', async () => {
      const boss = await runtime.get();
      const gone = run * 10 + 2;
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, async (tx) => {
          await runtime.queue.enqueue('tenant.heartbeat', { tenantId: A.id, bucket: gone }, { tx });
          throw new Error('business failure after enqueue');
        }),
      ).rejects.toThrow('business failure');
      await sleep(2_500); // longer than a polling interval: a leaked job would have run by now
      expect(seen.has(gone)).toBe(false);
      expect(await boss.findJobs('tenant.heartbeat', { data: { bucket: gone } })).toHaveLength(0);

      const kept = run * 10 + 3;
      await tenancy.withTenantTx({ tenantId: B.id }, (tx) =>
        runtime.queue.enqueue('tenant.heartbeat', { tenantId: B.id, bucket: kept }, { tx }),
      );
      await waitFor(async () => seen.get(kept), 30_000, 'the committed job');
      expect(await boss.findJobs('tenant.heartbeat', { data: { bucket: kept } })).toHaveLength(1);
    });

    it('refuses to enqueue for tenant B inside tenant A transaction, and non-ids payloads', async () => {
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
          runtime.queue.enqueue('tenant.heartbeat', { tenantId: B.id, bucket: 1 }, { tx }),
        ),
      ).rejects.toThrow(TenantPayloadError);
      await expect(
        runtime.queue.enqueue('mail.send', { tenantId: A.id, mailId: 'hello there friend' }),
      ).rejects.toThrow(/ids only/);
    });

    it('S3: 100 jobs across two tenants through the pooler (20 transactional), zero RLS violations', async () => {
      const base = run * 1000;
      const jobs: { bucket: number; tenant: FixtureTenant }[] = Array.from(
        { length: 100 },
        (_, i) => ({
          bucket: base + 100 + i,
          tenant: i % 2 === 0 ? A : B,
        }),
      );
      // 20 inside the caller's tenant transaction (10 per tenant), the rest straight onto the queue.
      for (const tenant of [A, B]) {
        const mine = jobs.filter((j) => j.tenant === tenant);
        await tenancy.withTenantTx({ tenantId: tenant.id }, async (tx) => {
          for (const j of mine.slice(0, 10)) {
            await runtime.queue.enqueue(
              'tenant.heartbeat',
              { tenantId: tenant.id, bucket: j.bucket },
              { tx },
            );
          }
        });
        await Promise.all(
          mine
            .slice(10)
            .map((j) =>
              runtime.queue.enqueue('tenant.heartbeat', { tenantId: tenant.id, bucket: j.bucket }),
            ),
        );
      }
      await waitFor(async () => jobs.every((j) => seen.has(j.bucket)), 90_000, '100 jobs');
      let violations = 0;
      for (const j of jobs) {
        const s = seen.get(j.bucket)!;
        if (
          s.tenantId !== j.tenant.id ||
          s.guc !== j.tenant.id ||
          s.visibleTenants.length !== 1 ||
          s.visibleTenants[0] !== j.tenant.id ||
          s.visibleAssets !== FIXTURE_ASSETS
        ) {
          violations += 1;
        }
      }
      expect(violations).toBe(0);
    }, 120_000);

    it('a failing job is retried then lands in the dead-letter queue, readable through the admin API', async () => {
      const boss = await runtime.get();
      const bucket = run * 10 + 4;
      await boss.send(
        'tenant.heartbeat',
        { tenantId: A.id, bucket, fail: true },
        { retryLimit: 0, group: { id: A.id } },
      );
      const admin = new JobAdmin(() => runtime.get());
      const entry = await waitFor(
        async () =>
          (await admin.deadLetters(500)).find(
            (d) => (d.payload as { bucket?: number }).bucket === bucket,
          ),
        60_000,
        'the failed job in the dead-letter queue',
      );
      expect(entry.sourceQueue).toBe('tenant.heartbeat');
      expect(entry.tenantId).toBe(A.id);
      expect(JSON.stringify(entry.failure)).toContain('boom (test)');
    }, 90_000);

    it("SCHEDULERS: two schedulers (two processes' worth) never duplicate a per-tenant job in a slot", async () => {
      const tenants = [{ tenantId: A.id }, { tenantId: B.id }];
      const producers = [
        { name: `e2e-hb-${run}`, queue: 'tenant.heartbeat', everySeconds: 3_600, perTenant: true },
      ];
      const make = () =>
        new Scheduler({
          queue: runtime.queue,
          controlPlane: { listActiveTenants: async () => tenants as never },
          logger: silent,
          producers,
          now: () => Date.now(),
        });
      const results = await Promise.all([make().tick(), make().tick(), make().tick()]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(2); // one job per tenant, not six
      const boss = await runtime.get();
      const bucket = Math.floor(Date.now() / 3_600_000);
      for (const t of tenants) {
        const found = await boss.findJobs('tenant.heartbeat', {
          data: { tenantId: t.tenantId, bucket },
        });
        const mine = found.filter((j) => j.singletonKey === `e2e-hb-${run}:${t.tenantId}`);
        expect(mine).toHaveLength(1);
      }
    });
  });

  describe('pgboss grants survive upgrades (M1-PLAT-06)', () => {
    it('provisioning is idempotent and the runtime role has everything it needs', async () => {
      await provisionJobs(env.migratorUrl!, { info: () => undefined }, jobsSchema);
      await withOwnerClient(env.migratorUrl!, async (c) => {
        expect(await verifyJobsGrants(c, 'app_user', jobsSchema)).toEqual([]);
      });
    });

    it('objects added later by the owner (a pg-boss upgrade) are covered by default privileges; a re-grant fixes any gap', async () => {
      await withOwnerClient(env.migratorUrl!, async (c) => {
        try {
          await c.query(`create table ${jobsSchema}.zz_upgrade_probe (id int primary key)`);
          await c.query(`create sequence ${jobsSchema}.zz_upgrade_probe_seq`);
          await c.query(
            `create function ${jobsSchema}.zz_upgrade_probe_fn() returns int language sql as $$ select 1 $$`,
          );
          // default privileges (set by provisioning) already cover the new objects
          expect(await verifyJobsGrants(c, 'app_user', jobsSchema)).toEqual([]);
          // simulate an upgrade that recreated an object WITHOUT the grants
          await c.query(`revoke all on ${jobsSchema}.zz_upgrade_probe from app_user`);
          expect((await verifyJobsGrants(c, 'app_user', jobsSchema)).join()).toMatch(
            /zz_upgrade_probe/,
          );
          await grantJobsAccess(c, 'app_user', jobsSchema);
          expect(await verifyJobsGrants(c, 'app_user', jobsSchema)).toEqual([]);
        } finally {
          await c.query(`drop table if exists ${jobsSchema}.zz_upgrade_probe`);
          await c.query(`drop sequence if exists ${jobsSchema}.zz_upgrade_probe_seq`);
          await c.query(`drop function if exists ${jobsSchema}.zz_upgrade_probe_fn()`);
        }
      });
    });

    it('the runtime role cannot do DDL in the pg-boss schema', async () => {
      // A raw runtime-role connection (the schema name is a test constant, not user input).
      const state = await withClient(env.databaseUrl!, (c) =>
        c.query(`create table ${jobsSchema}.zz_runtime_ddl (id int)`),
      ).then(
        () => undefined,
        (e: unknown) => sqlStateOf(e),
      );
      expect(state).toBe('42501');
    });
  });

  // ------------------------------------------------------------------ PLAT-04 audit
  describe('audit (M1-PLAT-04)', () => {
    const audit = new PgAuditWriter();
    const actor = uuidv7();

    const rowsFor = (tenantId: string, entityId: string) =>
      tenancy.withTenantTx(
        { tenantId },
        (tx) =>
          tx.$queryRaw<
            {
              actor_type: string;
              actor_user_id: string | null;
              actor_ref: string | null;
              action: string;
              ip: string | null;
              user_agent: string | null;
              request_id: string | null;
              tenant_id: string;
              diff: Record<string, unknown> | null;
            }[]
          >`select actor_type, actor_user_id, actor_ref, action, host(ip) as ip, user_agent, request_id, tenant_id, diff
            from app.audit_log where entity_id = ${entityId}::uuid`,
      );

    it('writes actor, request id, ip, user agent and a REDACTED diff in the caller transaction', async () => {
      const entityId = uuidv7();
      await runWithRequestContext(
        {
          requestId: 'req-audit-1',
          ip: '203.0.113.7',
          userAgent: 'vitest/1.0',
          actorType: 'user',
          actorId: actor,
        },
        () =>
          tenancy.withTenantTx({ tenantId: A.id, actorId: actor }, (tx) =>
            audit.write(tx, {
              action: 'user.updated',
              entityType: 'user_account',
              entityId,
              before: { display_name: 'Old', password: 'p1', mfa: { totpSecret: 'S3CRET' } },
              after: { display_name: 'New', password: 'p2', mfa: { totpSecret: 'S3CRET2' } },
              meta: { reason: 'profile edit', token: 't0k3n' },
            }),
          ),
      );
      const [row, ...rest] = await rowsFor(A.id, entityId);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        tenant_id: A.id,
        actor_type: 'user',
        actor_user_id: actor,
        actor_ref: null,
        action: 'user.updated',
        ip: '203.0.113.7',
        user_agent: 'vitest/1.0',
        request_id: 'req-audit-1',
      });
      expect(JSON.stringify(row!.diff)).not.toMatch(/p1|p2|S3CRET|t0k3n/);
      expect(row!.diff).toMatchObject({
        before: { display_name: 'Old', password: '[REDACTED]' },
        after: { display_name: 'New' },
        meta: { reason: 'profile edit', token: '[REDACTED]' },
      });
    });

    it('with no request (a job) the actor is the system, recorded in actor_ref', async () => {
      const entityId = uuidv7();
      await tenancy.withTenantTx({ tenantId: B.id, actorId: actor }, (tx) =>
        audit.write(tx, { action: 'tenant.heartbeat.ran', entityType: 'tenant', entityId }),
      );
      const [row] = await rowsFor(B.id, entityId);
      expect(row).toMatchObject({
        actor_type: 'system',
        actor_user_id: null,
        actor_ref: actor,
        ip: null,
      });
    });

    it('the audit row commits and rolls back WITH the transaction', async () => {
      const committed = uuidv7();
      const rolledBack = uuidv7();
      await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        audit.write(tx, { action: 'asset.created', entityType: 'asset', entityId: committed }),
      );
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, async (tx) => {
          await audit.write(tx, {
            action: 'asset.created',
            entityType: 'asset',
            entityId: rolledBack,
          });
          // visible inside its own transaction...
          const inside = await tx.$queryRaw<
            { n: number }[]
          >`select count(*)::int as n from app.audit_log where entity_id = ${rolledBack}::uuid`;
          expect(inside[0]!.n).toBe(1);
          throw new Error('rollback please');
        }),
      ).rejects.toThrow('rollback please');
      expect(await rowsFor(A.id, committed)).toHaveLength(1);
      expect(await rowsFor(A.id, rolledBack)).toHaveLength(0); // ...and gone after the rollback
    });

    it('the log is tenant-scoped (RLS) and append-only: UPDATE and DELETE fail for the runtime role', async () => {
      const entityId = uuidv7();
      await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        audit.write(tx, { action: 'asset.created', entityType: 'asset', entityId }),
      );
      expect(await rowsFor(B.id, entityId)).toHaveLength(0);
      for (const statement of ['update', 'delete'] as const) {
        const state = await tenancy
          .withTenantTx({ tenantId: A.id }, (tx) =>
            statement === 'update'
              ? tx.$executeRaw`update app.audit_log set action = 'tampered' where entity_id = ${entityId}::uuid`
              : tx.$executeRaw`delete from app.audit_log where entity_id = ${entityId}::uuid`,
          )
          .then(
            () => undefined,
            (e: unknown) => sqlStateOf(e),
          );
        expect(state, statement).toBe('42501');
      }
    });
  });

  // ------------------------------------------------------------------ PLAT-05 outbox
  describe('outbox (M1-PLAT-05)', () => {
    const publisher = new PgOutboxPublisher();
    const relayFor = (subscribers: OutboxSubscribers, options = {}) =>
      new OutboxRelay({
        tenancy,
        tenants: async () => [{ tenantId: A.id }],
        subscribers,
        logger: silent,
        options,
      });

    it('an event written in a transaction is relayed EXACTLY ONCE, even with concurrent relays', async () => {
      const aggregateId = uuidv7();
      const subscribers = new OutboxSubscribers();
      const delivered: { id: string; tenantId: string; payload: unknown }[] = [];
      subscribers.subscribe('probe.*', async (event) => {
        if (event.aggregateId === aggregateId) delivered.push(event);
      });

      await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        publisher.publish(tx, {
          type: 'probe.created',
          aggregateType: 'probe',
          aggregateId,
          payload: { probeId: aggregateId, version: 1 },
        }),
      );
      const relays = [relayFor(subscribers), relayFor(subscribers), relayFor(subscribers)];
      await Promise.all(relays.map((r) => r.runOnce()));
      await relays[0]!.runOnce(); // a later pass must not redeliver
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        tenantId: A.id,
        payload: { probeId: aggregateId, version: 1 },
      });

      const rows = await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        tx.outbox_event.findMany({ where: { aggregate_id: aggregateId } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.published_at).not.toBeNull();
    });

    it('a rolled-back transaction leaves no outbox row and nothing is delivered', async () => {
      const aggregateId = uuidv7();
      const subscribers = new OutboxSubscribers();
      let calls = 0;
      subscribers.subscribe('*', async (e) => {
        if (e.aggregateId === aggregateId) calls += 1;
      });
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, async (tx) => {
          await publisher.publish(tx, {
            type: 'probe.lost',
            aggregateType: 'probe',
            aggregateId,
            payload: { probeId: aggregateId },
          });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      await relayFor(subscribers).runOnce();
      expect(calls).toBe(0);
      const rows = await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        tx.outbox_event.count({ where: { aggregate_id: aggregateId } }),
      );
      expect(rows).toBe(0);
    });

    it('refuses a payload that is not ids only', async () => {
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
          publisher.publish(tx, {
            type: 'probe.created',
            aggregateType: 'probe',
            aggregateId: uuidv7(),
            payload: { note: 'free text with spaces', email: 'a@example.com' },
          }),
        ),
      ).rejects.toThrow(/ids only/);
    });

    it('a failing subscriber is retried with backoff, then dead-lettered; its own writes roll back', async () => {
      const aggregateId = uuidv7();
      const subscribers = new OutboxSubscribers();
      let calls = 0;
      subscribers.subscribe('probe.fails', async (event, { tx }) => {
        if (event.aggregateId !== aggregateId) return;
        calls += 1;
        await tx.$executeRaw`insert into app.audit_log (id, tenant_id, actor_type, action, entity_type, entity_id)
                             values (${uuidv7()}::uuid, ${A.id}::uuid, 'system', 'probe.side_effect', 'probe', ${aggregateId}::uuid)`;
        throw new Error('subscriber exploded');
      });
      await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        publisher.publish(tx, {
          type: 'probe.fails',
          aggregateType: 'probe',
          aggregateId,
          payload: { probeId: aggregateId },
        }),
      );
      const relay = relayFor(subscribers, { maxAttempts: 3, baseBackoffSeconds: 0 });
      // With zero backoff the failing event is eligible again immediately, so one pass walks it
      // through all three attempts and dead-letters it on the last.
      const pass = await relay.runOnce();
      expect(pass).toMatchObject({ delivered: 0, failed: 3, deadLettered: 1 });
      expect((await relay.runOnce()).failed).toBe(0); // dead-lettered rows are skipped
      expect(calls).toBe(3);

      const [row] = await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
        tx.outbox_event.findMany({ where: { aggregate_id: aggregateId } }),
      );
      expect(row).toMatchObject({ attempts: 3, published_at: null });
      expect(row!.dead_lettered_at).not.toBeNull();
      expect(row!.last_error).toContain('subscriber exploded');
      // the subscriber's insert ran in the relay's transaction, which rolled back each time
      const sideEffects = await tenancy.withTenantTx(
        { tenantId: A.id },
        (tx) =>
          tx.$queryRaw<
            { n: number }[]
          >`select count(*)::int as n from app.audit_log where entity_id = ${aggregateId}::uuid`,
      );
      expect(sideEffects[0]!.n).toBe(0);
    });

    it('a failed event waits out its backoff while later events still flow', async () => {
      const bad = uuidv7();
      const good = uuidv7();
      const subscribers = new OutboxSubscribers();
      const order: string[] = [];
      subscribers.subscribe('probe.mixed', async (e) => {
        if (e.aggregateId === bad) {
          order.push('bad');
          throw new Error('nope');
        }
        if (e.aggregateId === good) order.push('good');
      });
      for (const id of [bad, good]) {
        await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
          publisher.publish(tx, {
            type: 'probe.mixed',
            aggregateType: 'probe',
            aggregateId: id,
            payload: { probeId: id },
          }),
        );
      }
      await relayFor(subscribers, { baseBackoffSeconds: 600 }).runOnce();
      expect(order).toEqual(['bad', 'good']);
      await relayFor(subscribers, { baseBackoffSeconds: 600 }).runOnce(); // `bad` is now backing off
      expect(order).toEqual(['bad', 'good']);
    });
  });

  // ------------------------------------------------------------------ PLAT-09 mail
  describe.skipIf(!smtpUrl || !mailpitApi)('mail (M1-PLAT-09), through SMTP into Mailpit', () => {
    const sender = new QueuedMailSender(secrets, runtime.queue);

    async function mailpitFind(to: string) {
      const hit = await waitFor(
        async () => {
          const res = await fetch(
            `${mailpitApi}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
          );
          const body = (await res.json()) as { messages?: { ID: string; Subject: string }[] };
          return body.messages?.[0];
        },
        30_000,
        `a message to ${to} in Mailpit`,
      );
      const full = (await (await fetch(`${mailpitApi}/api/v1/message/${hit.ID}`)).json()) as {
        Subject: string;
        Text: string;
        HTML: string;
        From: { Address: string };
        To: { Address: string }[];
      };
      return full;
    }

    it('the SMTP adapter delivers a message that shows up in the Mailpit API', async () => {
      const to = `adapter-${run}@example.test`;
      await smtp!.deliver({
        from: 'Asset Tracker <no-reply@assettracker.test>',
        to,
        subject: 'Adapter probe',
        text: 'plain part',
        html: '<p>html part</p>',
      });
      const mail = await mailpitFind(to);
      expect(mail.Subject).toBe('Adapter probe');
      expect(mail.Text).toContain('plain part');
      expect(mail.HTML).toContain('html part');
      expect(mail.From.Address).toBe('no-reply@assettracker.test');
    });

    it('MailSender.send in a tenant tx -> job -> worker -> SMTP -> Mailpit; nothing sensitive in the queue', async () => {
      const to = `invitee-${run}@example.test`;
      await tenancy.withTenantTx({ tenantId: A.id }, (tx) => {
        void tx;
        return sender.send({
          to,
          template: 'auth.invitation',
          locale: 'en',
          data: {
            tenantName: 'Isolation JA',
            inviterName: 'Ada',
            acceptUrl: `https://app.example.test/accept?token=SECRET-TOKEN-${run}`,
          },
        });
      });

      // The queue carries ids only: no address, no token.
      const boss = await runtime.get();
      const jobs = await boss.findJobs<{ tenantId: string; mailId: string }>('mail.send', {
        data: { tenantId: A.id },
      });
      expect(jobs.length).toBeGreaterThan(0);
      for (const job of jobs) {
        expect(JSON.stringify(job.data)).not.toMatch(/example\.test|SECRET-TOKEN/);
        expect(Object.keys(job.data).sort()).toEqual(['mailId', 'tenantId']);
      }

      const mail = await mailpitFind(to);
      expect(mail.Subject).toBe('You are invited to join Isolation JA on Asset Tracker');
      expect(mail.Text).toContain(`https://app.example.test/accept?token=SECRET-TOKEN-${run}`);
      expect(mail.HTML).toContain('Accept invitation');

      // The stored message is dropped once sent (no token outlives delivery).
      const row = await waitFor(
        async () => {
          const rows = await tenancy.withTenantTx({ tenantId: A.id }, (tx) =>
            tx.mail_outbox.findMany({
              where: { template: 'auth.invitation', status: 'sent' },
              orderBy: { id: 'desc' },
              take: 1,
            }),
          );
          return rows[0];
        },
        15_000,
        'the mail row to be marked sent',
      );
      expect(row.message_enc).toBeNull();
      expect(row.sent_at).not.toBeNull();
    });

    it('a rolled-back transaction sends no mail and queues no job', async () => {
      const to = `rolledback-${run}@example.test`;
      const boss = await runtime.get();
      const before = (await boss.findJobs('mail.send', { data: { tenantId: B.id } })).length;
      await expect(
        tenancy.withTenantTx({ tenantId: B.id }, async () => {
          await sender.send({
            to,
            template: 'auth.password-reset',
            data: { resetUrl: 'https://app.example.test/reset?token=NEVER' },
          });
          throw new Error('invitation failed to save');
        }),
      ).rejects.toThrow('invitation failed');
      await sleep(3_000);
      expect((await boss.findJobs('mail.send', { data: { tenantId: B.id } })).length).toBe(before);
      const res = await fetch(
        `${mailpitApi}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      );
      expect(((await res.json()) as { messages?: unknown[] }).messages ?? []).toHaveLength(0);
      const queued = await tenancy.withTenantTx({ tenantId: B.id }, (tx) => tx.mail_outbox.count());
      expect(queued).toBe(0);
    });

    it('send() outside a tenant transaction is refused; bad template data fails in the caller', async () => {
      await expect(
        sender.send({ to: 'a@example.test', template: 'auth.mfa-enabled', data: {} }),
      ).rejects.toThrow(/withTenantTx/);
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, () =>
          sender.send({ to: 'not-an-email', template: 'auth.mfa-enabled', data: {} }),
        ),
      ).rejects.toThrow();
      await expect(
        tenancy.withTenantTx({ tenantId: A.id }, () =>
          sender.send({ to: 'a@example.test', template: 'auth.new-login', data: {} }),
        ),
      ).rejects.toThrow(/occurredAt/);
    });

    it('a mail whose stored envelope was tampered with is NOT sent (SecretBox authentication)', async () => {
      const to = `tampered-${run}@example.test`;
      const mailId = await tenancy.withTenantTx({ tenantId: A.id }, async (tx) => {
        await sender.send({
          to,
          template: 'auth.mfa-enabled',
          data: { userName: 'Mallory' },
        });
        // flip one bit inside the same transaction, before the job can ever run
        const rows = await tx.$queryRaw<{ id: string }[]>`
          update app.mail_outbox
             set message_enc = set_byte(message_enc, length(message_enc) - 5, get_byte(message_enc, length(message_enc) - 5) # 1)
           where status = 'queued' and id = (select id from app.mail_outbox where status = 'queued' order by id desc limit 1)
          returning id`;
        return rows[0]!.id;
      });
      const boss = await runtime.get();
      const failed = await waitFor(
        async () => {
          const dead = await boss.findJobs<{ mailId: string }>('mail.send', { data: { mailId } });
          return dead.find((j) => j.retryCount >= 1 || j.state === 'retry' || j.state === 'failed');
        },
        45_000,
        'the tampered mail job to fail',
      );
      expect(failed).toBeTruthy();
      const res = await fetch(
        `${mailpitApi}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      );
      expect(((await res.json()) as { messages?: unknown[] }).messages ?? []).toHaveLength(0);
    }, 60_000);
  });
});
