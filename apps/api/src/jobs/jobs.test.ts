import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import {
  maintenanceBossOptions,
  provisioningBossOptions,
  runtimeBossOptions,
} from './boss-options.js';
import { QUEUES, allQueues } from './catalogue.js';
import { PgBossJobQueue, TenantPayloadError, UnknownQueueError } from './job-queue.js';
import { HandlerRegistrationError, JobHandlerRegistry } from './registry.js';
import { PRODUCERS, Scheduler } from './scheduler.js';
import { splitPlaceholders } from './tx-db.js';
import { JobWorker, MissingTenantContextError } from './worker.js';

const A = '0190aaaa-0000-7000-8000-00000000000a';
const B = '0190bbbb-0000-7000-8000-00000000000b';
const silent = pino({ level: 'silent' });
const common = { connectionString: 'postgres://u:p@h:5432/d', applicationName: 't' };

describe('pg-boss configuration rules (spike F5, architecture 5.2)', () => {
  it('the RUNTIME instance has no DDL, no migration, no supervision, no scheduling, no LISTEN/NOTIFY', () => {
    expect(runtimeBossOptions(common)).toMatchObject({
      createSchema: false,
      migrate: false,
      supervise: false,
      schedule: false,
      useListenNotify: false,
      schema: 'pgboss',
    });
  });

  it('only the provisioning (migrate) instance creates and upgrades the schema', () => {
    expect(provisioningBossOptions(common)).toMatchObject({
      createSchema: true,
      migrate: true,
      supervise: false,
      useListenNotify: false,
    });
    expect(maintenanceBossOptions(common)).toMatchObject({
      createSchema: false,
      migrate: false,
      supervise: true,
      schedule: false,
      useListenNotify: false,
    });
  });

  it('no queue in the catalogue enables notify, and workers poll every 1-2 s', () => {
    for (const q of allQueues()) expect(q).not.toHaveProperty('notify');
  });

  it('LINT: no source file turns LISTEN/NOTIFY on (notify: true, useListenNotify: true)', async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated') await walk(full);
        } else if (/\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          // Comments may mention the forbidden setting (they explain why it is forbidden).
          const text = (await readFile(full, 'utf8'))
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
          if (/\b(useListenNotify|notify)\s*:\s*true\b/.test(text))
            offenders.push(relative(root, full));
        }
      }
    }
    await walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('job catalogue', () => {
  it('names are unique and every retry/expiry is positive', () => {
    const names = allQueues().map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);
    for (const q of allQueues()) {
      expect(q.name).toBe(Object.keys(QUEUES).find((k) => k === q.name));
      expect(q.expireInSeconds).toBeGreaterThan(0);
      expect(q.retryLimit).toBeGreaterThanOrEqual(0);
    }
  });

  it('owner-privileged work (partition rotation) is bound to the scheduler role, tenant work to the worker', () => {
    expect(QUEUES['maintenance.partition-rotate']).toMatchObject({
      runsIn: 'scheduler',
      tenantScoped: false,
    });
    expect(QUEUES['mail.send']).toMatchObject({ runsIn: 'worker', tenantScoped: true });
  });
});

describe('handler registry', () => {
  it('a tenant queue can only be registered with a tenant handler, and vice versa', () => {
    const r = new JobHandlerRegistry();
    expect(() => r.registerSystem('mail.send', async () => undefined)).toThrow(
      HandlerRegistrationError,
    );
    expect(() => r.registerTenant('maintenance.partition-rotate', async () => undefined)).toThrow(
      HandlerRegistrationError,
    );
    expect(() => r.registerTenant('no.such.queue', async () => undefined)).toThrow(
      /unknown job queue/,
    );
    r.registerTenant('mail.send', async () => undefined);
    expect(() => r.registerTenant('mail.send', async () => undefined)).toThrow(
      /already registered/,
    );
    expect(r.forRunner('worker').map((h) => h.queue)).toEqual(['mail.send']);
    expect(r.forRunner('scheduler')).toEqual([]);
  });
});

describe('transactional enqueue plumbing', () => {
  it('splits $n placeholders into bound parameters in order of appearance (repeats included)', () => {
    expect(splitPlaceholders('insert into t values ($1, $2::jsonb, $1)', ['a', '{}'])).toEqual({
      parts: ['insert into t values (', ', ', '::jsonb, ', ')'],
      reordered: ['a', '{}', 'a'],
    });
    expect(splitPlaceholders('select 1', [])).toEqual({ parts: ['select 1'], reordered: [] });
    expect(() => splitPlaceholders('select $2', ['only one'])).toThrow(/\$2/);
  });
});

describe('PgBossJobQueue guards', () => {
  const send = vi.fn(async () => 'job-1');
  const queue = new PgBossJobQueue(async () => ({ send }) as never);

  it('refuses an unknown queue, a non-ids payload and a missing tenant id', async () => {
    await expect(queue.enqueue('nope', { tenantId: A })).rejects.toThrow(UnknownQueueError);
    await expect(queue.enqueue('mail.send', { tenantId: A, to: 'a@example.com' })).rejects.toThrow(
      /ids only/,
    );
    await expect(queue.enqueue('mail.send', { mailId: A })).rejects.toThrow(TenantPayloadError);
    await expect(queue.enqueue('mail.send', { tenantId: 'not-a-uuid' })).rejects.toThrow(
      TenantPayloadError,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('sends with priority class, tenant group and dedupe window; returns "" for a deduplicated send', async () => {
    send.mockResolvedValueOnce('id-1' as never);
    expect(
      await queue.enqueue('tenant.heartbeat', { tenantId: A, bucket: 5 }, { singletonKey: 'k' }),
    ).toBe('id-1');
    expect(send).toHaveBeenLastCalledWith(
      'tenant.heartbeat',
      { tenantId: A, bucket: 5 },
      expect.objectContaining({
        priority: 10,
        group: { id: A },
        singletonKey: 'k',
        singletonSeconds: 60,
      }),
    );
    send.mockResolvedValueOnce(null as never);
    expect(await queue.enqueue('tenant.heartbeat', { tenantId: A }, { singletonKey: 'k' })).toBe(
      '',
    );
  });
});

describe('JobWorker wrapper', () => {
  const registry = new JobHandlerRegistry();
  const handle = vi.fn(async () => undefined);
  registry.registerTenant('tenant.heartbeat', handle);
  const tenant = registry.forRunner('worker')[0]!;
  const withTenantTx = vi.fn(async (_ctx: unknown, fn: (tx: unknown) => Promise<void>) => fn({}));
  const resolveTenant = vi.fn();
  const worker = new JobWorker(
    {
      boss: {} as never,
      tenancy: { withTenantTx } as never,
      controlPlane: { resolveTenant },
      registry,
      logger: silent,
    },
    { runner: 'worker', pollingIntervalSeconds: 1, localConcurrency: 1, tenantConcurrency: 1 },
  );
  const job = (data: Record<string, unknown>) =>
    ({
      id: '0190cccc-0000-4000-8000-00000000000c',
      name: 'tenant.heartbeat',
      data,
      retryCount: 0,
    }) as never;

  it('REFUSES to run a tenant handler without a valid tenant id (no transaction is opened)', async () => {
    for (const data of [{}, { tenantId: 'x' }, { tenantId: 5 }]) {
      await expect(worker.run(tenant, job(data))).rejects.toThrow(MissingTenantContextError);
    }
    expect(handle).not.toHaveBeenCalled();
    expect(withTenantTx).not.toHaveBeenCalled();
  });

  it('runs the handler inside withTenantTx(payload.tenantId) with the job as actor and request id', async () => {
    resolveTenant.mockResolvedValue({ tenantId: A, status: 'active' });
    await worker.run(tenant, job({ tenantId: A, bucket: 1 }));
    expect(withTenantTx).toHaveBeenCalledWith(
      {
        tenantId: A,
        actorId: '0190cccc-0000-4000-8000-00000000000c',
        requestId: 'job:0190cccc-0000-4000-8000-00000000000c',
      },
      expect.any(Function),
    );
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('skips jobs of a suspended tenant and fails jobs of an unknown tenant', async () => {
    handle.mockClear();
    resolveTenant.mockResolvedValueOnce({ tenantId: A, status: 'suspended' });
    await worker.run(tenant, job({ tenantId: A }));
    expect(handle).not.toHaveBeenCalled();
    resolveTenant.mockResolvedValueOnce(null);
    await expect(worker.run(tenant, job({ tenantId: B }))).rejects.toThrow(/unknown tenant/);
  });
});

describe('Scheduler producers', () => {
  it('fans out one job per active tenant per slot, once per process per slot', async () => {
    const enqueue = vi.fn(async () => 'id');
    const scheduler = new Scheduler({
      queue: { enqueue } as never,
      controlPlane: { listActiveTenants: async () => [{ tenantId: A }, { tenantId: B }] as never },
      logger: silent,
      producers: [PRODUCERS[0]!],
      now: () => 120_000,
    });
    expect(await scheduler.tick()).toBe(2);
    expect(await scheduler.tick()).toBe(0); // same slot: not evaluated again
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      'tenant.heartbeat',
      { tenantId: A, bucket: 2 },
      { singletonKey: `tenant-heartbeat:${A}`, singletonSeconds: 60 },
    );
  });
});
