import 'reflect-metadata';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  analyzed,
  auditRows,
  commit,
  contractViolations,
  createTenant,
  csv,
  dryRun,
  newTenancy,
  ownerTenantSql,
  startImportApp,
} from './support.js';

/**
 * Import data retention (ED-25) and the sweep's six-hour give-up. Both run through the scheduled
 * `import.sweep` handler with an INJECTED clock: nothing here waits for time to pass or edits
 * `updated_at`.
 */
describe.skipIf(!dbEnabled)(`import retention and sweep (${mode})`, { timeout: 120_000 }, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  let other: TenantFixture;
  const admin = () => t.admin;
  const DAY = 86_400_000;

  beforeAll(async () => {
    ih = await startImportApp({ IMPORT_ROW_RETENTION_DAYS: '30', IMPORT_BATCH_ROWS: '5' });
    t = await createTenant(ih.h.app, tenancy, 'impret');
    other = await createTenant(ih.h.app, tenancy, 'impret2');
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  /** The `import.sweep` handler of `fixture`'s tenant, as the worker runs it, at the clock `now`. */
  const sweep = (fixture: TenantFixture, now: Date) =>
    ih.runtime.withTenantTx({ tenantId: fixture.tenantId }, (tx) =>
      ih.runner.sweep(
        { tenantId: fixture.tenantId },
        {
          tenantId: fixture.tenantId,
          tx: tx as never,
          jobId: 'sweep-1',
          queue: 'import.sweep',
          retryCount: 0,
          logger: pino({ level: 'silent' }),
        },
        now,
      ),
    );

  const peopleFile = (prefix: string, n: number) =>
    csv([
      ['Name', 'Email'],
      ...Array.from({ length: n }, (_, i) => [
        `${prefix} ${i}`,
        `${prefix}${i}@x.example`.toLowerCase(),
      ]),
    ]);

  /** A committed people import with `n` rows. */
  async function completed(fixture: TenantFixture, prefix: string, n = 3) {
    const job = await analyzed(ih, fixture.admin, fixture.tenantId, 'person', {
      filename: `${prefix}.csv`,
      body: peopleFile(prefix, n),
    });
    expect(job.state, job.error ?? '').toBe('analyzed');
    const dry = await dryRun(ih, fixture.admin, fixture.tenantId, job.id);
    const fin = await commit(ih, fixture.admin, fixture.tenantId, job.id, dry.dry_run_digest);
    expect(fin.state).toBe('completed');
    return fin;
  }
  const sql = async (fixture: TenantFixture, query: string) =>
    (await ownerTenantSql(fixture.tenantId, query)).rows as Json[];
  const rowCount = async (fixture: TenantFixture, id: string) =>
    (
      (
        await sql(fixture, `select count(*)::int as n from app.import_row where job_id = '${id}'`)
      )[0] as Json
    ).n;

  describe('retention (ED-25)', () => {
    it('keeps the content for the retention period, then removes rows, profile, samples, value map and the file, and keeps the job', async () => {
      const job = await completed(t, 'Keep');
      const before = (await admin().get(`/v1/imports/${job.id}`)).body;
      expect(before.data_purged_at).toBeNull();
      expect(before.profile).not.toBeNull();
      expect(before.samples).not.toBeNull();
      expect(await rowCount(t, job.id)).toBe(3);
      const [att] = await sql(
        t,
        `select id, storage_key from app.attachment where id = '${before.file_attachment_id}'`,
      );
      expect(await ih.h.storage.head(att!.storage_key)).not.toBeNull();

      const finished = new Date(
        ((await sql(t, `select finished_at from app.import_job where id = '${job.id}'`))[0] as Json)
          .finished_at,
      );
      // 29 days later: nothing happens
      await sweep(t, new Date(finished.getTime() + 29 * DAY));
      expect(await rowCount(t, job.id)).toBe(3);
      expect(((await admin().get(`/v1/imports/${job.id}`)).body as Json).data_purged_at).toBeNull();

      // 31 days later: purged
      const at = new Date(finished.getTime() + 31 * DAY);
      await sweep(t, at);
      expect(await rowCount(t, job.id)).toBe(0);
      const after = (await admin().get(`/v1/imports/${job.id}`)).body as Json;
      expect(after.data_purged_at).toBe(at.toISOString());
      expect(after).toMatchObject({
        state: 'completed',
        filename: 'Keep.csv',
        rows_total: 3,
        file_attachment_id: null,
        profile: null,
        samples: null,
        value_map: {},
        counts: { commit: { created: 3, updated: 0, skipped: 0, error: 0 } },
      });
      expect(after.summary).toEqual(before.summary);
      expect(after.mapping).toEqual(before.mapping);
      expect(after.version ?? null).toBeNull(); // no version member on the read model
      // the rows endpoint has nothing left to page, the error report is just its header
      expect((await admin().get(`/v1/imports/${job.id}/rows`)).body.data).toEqual([]);
      // the uploaded file: archived and its object gone
      const [file] = await sql(t, `select archived_at from app.attachment where id = '${att!.id}'`);
      expect(file!.archived_at).not.toBeNull();
      expect(await ih.h.storage.head(att!.storage_key)).toBeNull();
      // audited, with the number of rows
      const audit = await auditRows(
        t.tenantId,
        `entity_id = '${job.id}' and action = 'import.data_purged'`,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]!.diff?.meta).toMatchObject({ rows_deleted: 3, retention_days: 30 });
      // running the sweep again changes nothing and audits nothing more
      await sweep(t, new Date(at.getTime() + DAY));
      expect(
        await auditRows(t.tenantId, `entity_id = '${job.id}' and action = 'import.data_purged'`),
      ).toHaveLength(1);
      // the records the import wrote are untouched
      expect(
        (
          (
            await sql(
              t,
              `select count(*)::int as n from app.person where email like 'keep%@x.example'`,
            )
          )[0] as Json
        ).n,
      ).toBe(3);
    });

    it('purges failed and cancelled imports too, never one that is still open, and only its own tenant', async () => {
      // cancelled before any dry run
      const cancelled = await analyzed(ih, admin(), t.tenantId, 'person', {
        filename: 'Cancelled.csv',
        body: peopleFile('Cx', 2),
      });
      expect((await admin().post(`/v1/imports/${cancelled.id}/cancel`, {})).body.state).toBe(
        'cancelled',
      );
      // analyzed and left alone (never finishes)
      const open = await analyzed(ih, admin(), t.tenantId, 'person', {
        filename: 'Open.csv',
        body: peopleFile('Op', 2),
      });
      // another tenant's finished import
      const foreign = await completed(other, 'Fx');
      const farFuture = new Date(Date.now() + 400 * DAY);

      await sweep(t, farFuture);
      const c = (await admin().get(`/v1/imports/${cancelled.id}`)).body as Json;
      expect(c.data_purged_at).toBe(farFuture.toISOString());
      expect(await rowCount(t, cancelled.id)).toBe(0);
      const o = (await admin().get(`/v1/imports/${open.id}`)).body as Json;
      expect(o.data_purged_at).toBeNull();
      expect(o.state).toBe('analyzed');
      expect(await rowCount(t, open.id)).toBe(2);
      // the other tenant keeps everything: its own sweep has not run
      expect(await rowCount(other, foreign.id)).toBe(3);
      expect(
        ((await other.admin.get(`/v1/imports/${foreign.id}`)).body as Json).data_purged_at,
      ).toBeNull();
      await sweep(other, farFuture);
      expect(await rowCount(other, foreign.id)).toBe(0);
    });

    it('purges at most five imports per run and the next run continues', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        const job = await analyzed(ih, admin(), t.tenantId, 'person', {
          filename: `Many${i}.csv`,
          body: peopleFile(`Mn${i}x`, 1),
        });
        await admin().post(`/v1/imports/${job.id}/cancel`, {});
        ids.push(job.id as string);
      }
      const later = new Date(Date.now() + 500 * DAY);
      await sweep(t, later);
      const purged = async () =>
        (
          (
            await sql(
              t,
              `select count(*)::int as n from app.import_job where id in (${ids.map((i) => `'${i}'`).join(',')}) and data_purged_at is not null`,
            )
          )[0] as Json
        ).n;
      expect(await purged()).toBe(5);
      await sweep(t, later);
      expect(await purged()).toBe(7);
    });
  });

  describe('the sweep gives up on a stuck import after six hours (injected clock)', () => {
    it('leaves a recent one alone, queues a stale one again, and fails one older than six hours', async () => {
      const job = await analyzed(ih, admin(), t.tenantId, 'person', {
        filename: 'Stuck.csv',
        body: peopleFile('St', 3),
      });
      expect((await admin().post(`/v1/imports/${job.id}/dry-run`, {})).status).toBe(202);
      ih.h.jobs.jobs.splice(0, ih.h.jobs.jobs.length);
      const state = async () => ((await admin().get(`/v1/imports/${job.id}`)).body as Json).state;
      expect(await state()).toBe('dry_running');

      // just now: it is not stale, nothing is queued
      await sweep(t, new Date());
      expect(ih.h.jobs.jobs).toEqual([]);
      expect(await state()).toBe('dry_running');

      // 30 minutes without progress: the worker job is queued again (one per import: singleton key)
      await sweep(t, new Date(Date.now() + 30 * 60_000));
      expect(ih.h.jobs.jobs.map((j) => j.name)).toEqual(['import.step']);
      expect(ih.h.jobs.jobs[0]!.payload).toMatchObject({ importId: job.id });
      expect(await state()).toBe('dry_running');

      // 5 hours 59 minutes after it started: still re-queued, not given up
      ih.h.jobs.jobs.splice(0, ih.h.jobs.jobs.length);
      const startedAt = new Date(
        (
          (
            await sql(
              t,
              `select coalesce(started_at, created_at) as at from app.import_job where id = '${job.id}'`,
            )
          )[0] as Json
        ).at,
      );
      await sweep(t, new Date(startedAt.getTime() + (6 * 60 - 1) * 60_000));
      expect(await state()).toBe('dry_running');
      expect(ih.h.jobs.jobs).toHaveLength(1);

      // more than six hours: it ends `failed` with an explanation, nothing is queued, the audit says so
      ih.h.jobs.jobs.splice(0, ih.h.jobs.jobs.length);
      await sweep(t, new Date(startedAt.getTime() + (6 * 60 + 1) * 60_000));
      const failed = (await admin().get(`/v1/imports/${job.id}`)).body as Json;
      expect(failed.state).toBe('failed');
      expect(failed.error).toContain('worker kept failing');
      expect(ih.h.jobs.jobs).toEqual([]);
      expect(
        await auditRows(t.tenantId, `entity_id = '${job.id}' and action = 'import.failed'`),
      ).toHaveLength(1);
      // a failed import can be started over (a new one), and is purged by retention later
      await sweep(t, new Date(startedAt.getTime() + 40 * DAY));
      expect(
        ((await admin().get(`/v1/imports/${job.id}`)).body as Json).data_purged_at,
      ).not.toBeNull();
    });
  });
});
