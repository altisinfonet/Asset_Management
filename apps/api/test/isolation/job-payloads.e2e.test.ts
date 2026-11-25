import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idsOnlyViolations } from '../../src/ids/ids-only.js';
import { QUEUES, TenantPayloadError, UnknownQueueError } from '../../src/jobs/index.js';
import { PRODUCERS, Scheduler } from '../../src/jobs/scheduler.js';
import { QueuedMailSender } from '../../src/mail/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import { dbEnabled, testPorts } from '../auth/support.js';
import { drainJobs, uploadFile } from '../files/support.js';
import {
  type ImportHarness,
  type TenantFixture,
  analyzed,
  basics,
  createTenant,
  dryRun,
  mappingOf,
  newAsset,
  newTenancy,
  patchImport,
  startImportApp,
} from '../importer/support.js';
import { mode } from '../support/db.js';
import { png } from '../support/file-fixtures.js';
import { LintingJobQueue } from '../support/test-ports.js';

/**
 * M2-SEC-01: the job payload lint covers EVERY job type. `pgboss.*` has no row-level security, so a job
 * payload must carry ids only (architecture 5.2). The lint itself (`assertEnqueueable`) runs in the
 * pg-boss adapter and, since M2-SEC-01, in the e2e suite's in-memory queue as well, so every job any e2e
 * test makes the application queue is linted. This file makes the REAL producer of every queue in the
 * catalogue run once (the scheduler's fan-out, the attachment pipeline, labels, exports, the importer,
 * mail) and fails when a catalogued queue was not produced: a new job type cannot be added without its
 * producer being exercised here, through the lint.
 */
describe.skipIf(!dbEnabled)(`job payload lint covers every job type (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  /** every job queued (and accepted by the lint) in this file, in order; the helpers drain the queue */
  const seen: Array<{ name: string; payload: Record<string, unknown> }> = [];

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'jobs');
    const queue = ih.h.jobs;
    const lint = queue.enqueue.bind(queue);
    queue.enqueue = async (name, payload, opts) => {
      const id = await lint(name, payload, opts);
      seen.push({ name, payload });
      return id;
    };
  });
  afterAll(async () => {
    await ih?.h.close();
    await tenancy.onModuleDestroy();
  });

  it('the e2e queue applies the same lint as the pg-boss adapter (the negative controls)', async () => {
    const q = new LintingJobQueue();
    const tenantId = t.tenantId;
    await expect(q.enqueue('no.such.queue', { tenantId })).rejects.toBeInstanceOf(
      UnknownQueueError,
    );
    // a tenant-scoped queue without a tenant, or with something that is not a uuid
    await expect(q.enqueue('export.run', { exportId: randomUUID() })).rejects.toBeInstanceOf(
      TenantPayloadError,
    );
    await expect(q.enqueue('export.run', { tenantId: 'acme' })).rejects.toBeInstanceOf(
      TenantPayloadError,
    );
    // never an email address, a file name, a URL, a storage key or a secret in a payload
    for (const bad of [
      { tenantId, to: 'someone@example.test' },
      { tenantId, filename: 'secret plan.xlsx' },
      { tenantId, url: 'https://files.example/x?sig=abc' },
      { tenantId, key: `tenants/${tenantId}/2026/11/x.csv` },
      { tenantId, token: 'abc' },
      { tenantId, nested: { a: { b: { c: { d: 1 } } } } },
    ]) {
      await expect(q.enqueue('import.analyze', bad), JSON.stringify(bad)).rejects.toThrow(
        /ids only/,
      );
    }
    // inside tenant A's transaction a job for another tenant is refused
    const runtime = ih.h.app.get(TenancyService, { strict: false });
    await expect(
      runtime.withTenantTx({ tenantId }, (tx) =>
        q.enqueue('export.run', { tenantId: randomUUID(), exportId: randomUUID() }, { tx }),
      ),
    ).rejects.toBeInstanceOf(TenantPayloadError);
    expect(q.jobs).toEqual([]);
  });

  it('the real producer of every catalogued queue runs once, through the lint, with an ids-only payload', async () => {
    const admin = t.admin;
    const { categoryId } = await basics(t);
    const asset = await newAsset(admin, categoryId, { name: 'job lint asset' });

    // the scheduler fan-out: every periodic producer, per tenant (and the global partition rotation)
    const scheduler = new Scheduler({
      queue: { enqueue: (name, payload, opts) => ih.h.jobs.enqueue(name, payload, opts) },
      controlPlane: {
        // only the tenant id is read by the fan-out
        listActiveTenants: async () => [{ tenantId: t.tenantId }] as never,
      },
      logger: pino({ level: 'silent' }),
    });
    expect(await scheduler.tick()).toBe(PRODUCERS.length);

    // attachments: confirm an upload (attachment.scan), the scan of a clean image (attachment.thumbnail)
    await uploadFile(
      ih.h,
      admin,
      t.tenantId,
      { entity_type: 'asset', entity_id: asset.id },
      { filename: 'photo.png', content_type: 'image/png', body: await png(), kind: 'photo' },
    );
    await drainJobs(ih.h, ['attachment.scan', 'attachment.thumbnail']);

    // labels (label.render) and exports (export.run)
    const batch = await admin.post(
      '/v1/labels/batches',
      { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
      { headers: { 'idempotency-key': randomUUID() } },
    );
    expect(batch.status, batch.raw).toBe(202);
    const exp = await admin.post('/v1/exports', { resource: 'assets' });
    expect(exp.status, exp.raw).toBe(202);

    // the importer: analyze (import.analyze), then the dry run (import.step)
    const job = await analyzed(ih, admin, t.tenantId, 'asset', {
      filename: 'assets.csv',
      body: 'Name,Category\nLint laptop,Cat\n',
    });
    const mapped = await patchImport(admin, job.id as string, {
      mapping: mappingOf(job, { Name: 'name', Category: 'category' }),
    });
    expect(mapped.status, mapped.raw).toBe(200);
    await dryRun(ih, admin, t.tenantId, job.id as string);

    // mail: the platform sender stores the message encrypted and queues { tenantId, mailId } (mail.send)
    const runtime = ih.h.app.get(TenancyService, { strict: false });
    const sender = new QueuedMailSender(testPorts.secretBox, ih.h.jobs);
    await runtime.withTenantTx({ tenantId: t.tenantId }, () =>
      sender.send({ to: 'lint@example.test', template: 'auth.mfa-enabled', data: {} }),
    );

    const produced = new Set(seen.map((j) => j.name));
    const missing = Object.keys(QUEUES).filter((name) => !produced.has(name));
    expect(missing, `catalogued queues whose producer this file does not run: ${missing}`).toEqual(
      [],
    );
    for (const j of seen) {
      expect(idsOnlyViolations(j.payload), `${j.name} ${JSON.stringify(j.payload)}`).toEqual([]);
      if (QUEUES[j.name as keyof typeof QUEUES].tenantScoped) {
        expect(j.payload.tenantId, j.name).toBe(t.tenantId);
      }
    }
  }, 120_000);
});
