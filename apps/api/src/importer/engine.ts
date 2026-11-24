import { createHash } from 'node:crypto';
import type { AuthContext } from '../auth/index.js';
import type { JobContextBase } from '../jobs/index.js';
import type { AuditWriter, JobQueue, OutboxPublisher, StorageAdapter } from '../ports/index.js';
import type { Tx } from '../tenancy/index.js';
import { flushAuditRows } from '../audit/index.js';
import { withBulkSink } from '../context/bulk-writes.js';
import { flushOutboxRows } from '../outbox/index.js';
import { flushHistoryRows } from '../registry/index.js';
import { analyseFile } from './analysis.js';
import { FileFormatError } from './csv-reader.js';
import { CUSTOM_PREFIX, type CustomTarget, type EntityType } from './fields.js';
import {
  type EntityHandler,
  type HandlerEnv,
  type WorkRow,
  inNamedSavepoint,
  jobAuth,
} from './handlers/shared.js';
import { type ColumnPlan, checkMapping, mapRow, planColumns } from './mapper.js';
import { applyPreset } from './presets.js';
import type { RefServices } from './refs.js';
import {
  type ImportOptions,
  type JobRow,
  type MappedRecord,
  type Outcome,
  type RowIssue,
  type Verdict,
  RUNNING_STATES,
  optionsSchema,
} from './types.js';

export const IMPORT_ANALYZE_JOB = 'import.analyze';
export const IMPORT_STEP_JOB = 'import.step';

export interface EngineConfig {
  /** Rows per worker step (one transaction each). */
  batchRows: number;
  /** Most data rows of one file. */
  maxRows: number;
}

export interface EngineDeps {
  storage: StorageAdapter;
  jobs: JobQueue;
  audit: AuditWriter;
  outbox: OutboxPublisher;
  handlers: Record<EntityType, EntityHandler>;
  refs: RefServices;
  config: EngineConfig;
}

/** Step memo entries that hold a reference resolver (handlers/asset.ts `asset:<mode>`, service-handler.ts `service:<mode>`). */
const RESOLVER_MEMO_KEYS = ['asset:commit', 'asset:dry', 'service:commit', 'service:dry'] as const;

/** The fast path of a batch met a row it cannot settle without a savepoint of its own. */
class BatchNeedsRowSavepoints extends Error {
  constructor() {
    super('batch needs row savepoints');
  }
}

/** Thrown to roll a row's savepoint back and carry its outcome out of it. */
class RowRolledBack extends Error {
  constructor(readonly outcome: Outcome) {
    super('row rolled back');
  }
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The shape of the `import_row` columns a step reads. */
interface RowRecord {
  row_no: number;
  line_no: number;
  raw: string[];
  mapped: MappedRecord | null;
  match_key: string | null;
  match_key2: string | null;
  dup_of: number | null;
  plan: Verdict['plan'] | null;
  entity_id: string | null;
  entity_version: number | null;
}

/**
 * The import state machine as the worker runs it (M2-IMP-01/02/04/05). `analyze` runs once (reads the file,
 * stores rows); `step` runs one batch of a dry run or a commit and queues the next step in the SAME
 * transaction. Everything a batch changes (registry rows, audit, outbox, the rows' results, the job's
 * cursor) commits together or not at all, which is what makes a crashed or retried step harmless.
 */
export class ImportEngine {
  constructor(private readonly deps: EngineDeps) {}

  // ------------------------------------------------------------------------------------- loading

  async loadJob(tx: Tx, id: string): Promise<JobRow | null> {
    const rows = await tx.$queryRaw<
      JobRow[]
    >`select * from app.import_job where id = ${id}::uuid for update`;
    return rows[0] ?? null;
  }

  private async requesterActive(tx: Tx, userId: string): Promise<boolean> {
    const u = await tx.user_account.findUnique({ where: { id: userId }, select: { status: true } });
    return u?.status === 'active';
  }

  private async customTargets(tx: Tx): Promise<CustomTarget[]> {
    const rows = await tx.custom_field_def.findMany({
      where: { archived_at: null },
      select: { key: true, label: true, data_type: true, category_id: true },
    });
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      dataType: r.data_type,
      categoryId: r.category_id,
    }));
  }

  /** The sweep gives up on an import whose worker jobs kept failing for hours. */
  async abandon(tx: Tx, importId: string, ctx: JobContextBase): Promise<void> {
    const job = await this.loadJob(tx, importId);
    if (!job || !RUNNING_STATES.includes(job.state)) return;
    await this.fail(
      tx,
      job,
      'The import did not finish: the worker kept failing. Start it again, and report this if it happens twice.',
      ctx,
    );
  }

  private async fail(tx: Tx, job: JobRow, message: string, ctx: JobContextBase): Promise<void> {
    await tx.import_job.update({
      where: { id: job.id },
      data: { state: 'failed', error: message.slice(0, 1000), finished_at: new Date() },
    });
    await this.deps.audit.write(tx, {
      action: 'import.failed',
      entityType: 'import_job',
      entityId: job.id,
      meta: { import_job_id: job.id, error: message.slice(0, 300), phase: job.state },
    });
    await this.deps.outbox.publish(tx, {
      type: 'import.failed',
      aggregateType: 'import_job',
      aggregateId: job.id,
      payload: { requestedBy: job.requested_by },
    });
    ctx.logger.warn({ import_id: job.id, err: message }, 'import failed');
  }

  // ------------------------------------------------------------------------------------ analysis

  /** `import.analyze`: reads the file, stores its rows, the profile and the suggested mapping. */
  async analyze(
    tx: Tx,
    tenantId: string,
    importId: string,
    ctx: JobContextBase & { retryCount: number },
  ): Promise<void> {
    const job = await this.loadJob(tx, importId);
    if (!job || job.state !== 'analyzing') {
      ctx.logger.info({ import_id: importId }, 'analyze skipped: not an analyzing import');
      return;
    }
    if (!(await this.requesterActive(tx, job.requested_by)))
      return this.fail(tx, job, 'The user who started the import is no longer active.', ctx);
    const att = job.file_attachment_id
      ? await tx.attachment.findUnique({ where: { id: job.file_attachment_id } })
      : null;
    if (!att || att.archived_at) return this.fail(tx, job, 'The uploaded file is gone.', ctx);
    if (att.scan_status === 'infected')
      return this.fail(tx, job, 'The file was rejected by the virus scan.', ctx);
    if (att.scan_status === 'error')
      return this.fail(tx, job, 'The upload was rejected (see the attachment).', ctx);
    if (att.scan_status === 'pending' || !att.uploaded_at) {
      // still being scanned: look again shortly (the job row stays `analyzing`); give up after ~15 minutes
      return this.waitForScan(tx, tenantId, job, ctx);
    }

    const defs = await this.customTargets(tx);
    await tx.import_row.deleteMany({ where: { job_id: job.id } }).catch(() => undefined);
    const open = () => this.deps.storage.read(att.storage_key);
    try {
      const overrides = (job.parse ?? {}) as Record<string, unknown>;
      const analysis = await analyseFile({
        open,
        filename: att.filename,
        overrides: {
          ...(overrides.encoding ? { encoding: overrides.encoding as never } : {}),
          ...(overrides.delimiter ? { delimiter: overrides.delimiter as string } : {}),
          ...(overrides.sheet ? { sheet: overrides.sheet as string } : {}),
          ...(overrides.header_line ? { header_line: overrides.header_line as number } : {}),
        },
        entity: job.entity_type,
        custom: defs,
        maxRows: this.deps.config.maxRows,
        sink: async (rows) => {
          await tx.import_row.createMany({
            data: rows.map((r) => ({
              tenant_id: tenantId,
              job_id: job.id,
              row_no: r.row_no,
              line_no: r.line_no,
              raw: r.raw,
            })),
          });
        },
      });
      let mapping = analysis.mapping;
      let options = job.options;
      let valueMap = job.value_map;
      if (job.preset_key) {
        const applied = await applyPreset(
          tx,
          job.preset_key,
          analysis.headers,
          analysis.mapping,
          async (index) => {
            const rows = await tx.$queryRaw<Array<{ v: string }>>`
            select distinct btrim(raw->>${index}::int) as v from app.import_row
             where job_id = ${job.id}::uuid and nullif(btrim(raw->>${index}::int), '') is not null limit 200`;
            return rows.map((r) => r.v);
          },
        );
        if (applied) {
          mapping = applied.mapping;
          options = { ...applied.options, ...job.options };
          valueMap = { ...applied.valueMap, ...job.value_map };
        }
      }
      await tx.import_job.update({
        where: { id: job.id },
        data: {
          state: 'analyzed',
          parse: {
            ...analysis.parse,
            header_line: analysis.headerLine,
            confidence: analysis.confidence,
          } as never,
          headers: analysis.headers,
          profile: analysis.profile as never,
          samples: analysis.samples,
          mapping: mapping as never,
          options: options as never,
          value_map: valueMap as never,
          rows_total: analysis.rowsTotal,
          error: null,
          cursor_row: 0,
          rows_processed: 0,
          plan_create: 0,
          plan_update: 0,
          plan_skip: 0,
          plan_error: 0,
          dry_run_digest: null,
        },
      });
      await this.deps.audit.write(tx, {
        action: 'import.analyzed',
        entityType: 'import_job',
        entityId: job.id,
        meta: { import_job_id: job.id, rows: analysis.rowsTotal, format: analysis.parse.format },
      });
    } catch (err) {
      if (err instanceof FileFormatError) return this.fail(tx, job, err.message, ctx);
      throw err;
    }
  }

  private async waitForScan(
    tx: Tx,
    tenantId: string,
    job: JobRow,
    ctx: JobContextBase & { retryCount: number },
  ): Promise<void> {
    const age =
      Date.now() - new Date((job as unknown as { updated_at: Date }).updated_at).getTime();
    if (age > 15 * 60_000)
      return this.fail(
        tx,
        job,
        'The virus scan of the uploaded file did not finish in time. Upload it again.',
        ctx,
      );
    await this.deps.jobs.enqueue(
      IMPORT_ANALYZE_JOB,
      { tenantId, importId: job.id },
      { tx, startAfterSeconds: 5 },
    );
  }

  // ---------------------------------------------------------------------------------- environment

  private async env(tx: Tx, job: JobRow): Promise<HandlerEnv> {
    const options = optionsSchema.parse(job.options ?? {});
    const columns = planColumns(job.entity_type, (job.mapping ?? {}) as never);
    const tenant = await tx.tenant.findFirst({ select: { base_currency: true } });
    return {
      tx,
      auth: jobAuth(job.tenant_id, job.requested_by) as AuthContext,
      job,
      options,
      valueMap: job.value_map ?? {},
      columns,
      baseCurrency: tenant?.base_currency ?? 'USD',
      refs: this.deps.refs,
      memo: new Map(),
    };
  }

  /** Mapping problems that make the job unrunnable (checked before a dry run is queued and again by the worker). */
  async mappingIssues(
    tx: Tx,
    job: Pick<JobRow, 'entity_type' | 'mapping' | 'options' | 'headers'>,
  ): Promise<RowIssue[]> {
    const options = optionsSchema.parse(job.options ?? {});
    const custom = await this.customTargets(tx);
    return checkMapping(
      job.entity_type,
      (job.mapping ?? {}) as never,
      options,
      new Set(custom.map((c) => c.key)),
      job.headers?.length ?? null,
    );
  }

  // --------------------------------------------------------------------------------------- steps

  /** `import.step`: one batch of the phase the job is in. */
  async step(tx: Tx, tenantId: string, importId: string, ctx: JobContextBase): Promise<void> {
    const job = await this.loadJob(tx, importId);
    if (!job) return;
    if (job.state !== 'dry_running' && job.state !== 'committing') {
      ctx.logger.info(
        { import_id: importId, state: job.state },
        'step skipped: nothing to do in this state',
      );
      return;
    }
    if (job.cancel_requested) {
      await tx.import_job.update({
        where: { id: job.id },
        data: { state: 'cancelled', finished_at: new Date(), cancel_requested: false },
      });
      await this.deps.audit.write(tx, {
        action: 'import.cancelled',
        entityType: 'import_job',
        entityId: job.id,
        meta: { import_job_id: job.id, phase: job.state, rows_processed: job.rows_processed },
      });
      await this.deps.outbox.publish(tx, {
        type: 'import.cancelled',
        aggregateType: 'import_job',
        aggregateId: job.id,
        payload: { requestedBy: job.requested_by },
      });
      return;
    }
    if (!(await this.requesterActive(tx, job.requested_by)))
      return this.fail(tx, job, 'The user who started the import is no longer active.', ctx);
    const env = await this.env(tx, job);
    const issues = await this.mappingIssues(tx, job);
    if (issues.length > 0)
      return this.fail(tx, job, `The mapping is not valid: ${issues[0]!.message}`, ctx);
    const started = performance.now();
    if (job.state === 'dry_running') await this.dryRunStep(env, tenantId, ctx);
    else await this.commitStep(env, tenantId, ctx);
    ctx.logger.info(
      {
        import_id: job.id,
        phase: job.state,
        from_row: job.cursor_row + 1,
        ms: Math.round(performance.now() - started),
      },
      'import step',
    );
  }

  private async nextRows(
    tx: Tx,
    job: JobRow,
    limit: number,
    pendingOnly: boolean,
  ): Promise<RowRecord[]> {
    if (pendingOnly) {
      return tx.$queryRaw<RowRecord[]>`
        select row_no, line_no, raw, mapped, match_key, match_key2, dup_of, plan, entity_id, entity_version
          from app.import_row
         where job_id = ${job.id}::uuid and row_no > ${job.cursor_row} and result is null and plan in ('create','update')
         order by row_no limit ${limit}`;
    }
    return tx.$queryRaw<RowRecord[]>`
      select row_no, line_no, raw, mapped, match_key, match_key2, dup_of, plan, entity_id, entity_version
        from app.import_row
       where job_id = ${job.id}::uuid and row_no > ${job.cursor_row}
       order by row_no limit ${limit}`;
  }

  private queueNext(tx: Tx, tenantId: string, importId: string): Promise<string | null> {
    return this.deps.jobs.enqueue(IMPORT_STEP_JOB, { tenantId, importId }, { tx });
  }

  // ------------------------------------------------------------------------------------- dry run

  private async dryRunStep(env: HandlerEnv, tenantId: string, ctx: JobContextBase): Promise<void> {
    const { tx, job } = env;
    const started = performance.now();
    if (job.cursor_row === 0 && job.rows_processed === 0) {
      // first step: forget any earlier dry run (mapping or options changed, or a re-run)
      await tx.$executeRaw`
        update app.import_row set mapped = null, match_key = null, match_key2 = null, dup_of = null, plan = null,
               errors = null, warnings = null, entity_id = null, entity_version = null,
               result = null, result_errors = null, created_id = null, before_image = null, processed_at = null
         where job_id = ${job.id}::uuid and (plan is not null or mapped is not null or result is not null)`;
    }
    const rows = await this.nextRows(tx, job, this.deps.config.batchRows, false);
    if (rows.length > 0) {
      const handler = this.deps.handlers[job.entity_type];
      const out: Array<Record<string, unknown>> = [];
      // 1. cells -> typed records and keys
      const prepared = rows.map((r) => {
        const { record, issues } = mapRow(r.raw, {
          columns: env.columns,
          options: env.options,
          baseCurrency: env.baseCurrency,
          constants: (job.mapping as { constants?: Record<string, string> }).constants ?? {},
        });
        const keys = handler.keys(record, env);
        return { r, record, issues, keys };
      });
      // 2. in-file duplicates: against earlier batches (stored keys) and inside this batch
      const first = await this.earlierKeys(
        tx,
        job.id,
        rows[0]!.row_no,
        prepared.flatMap((p) => [p.keys.k1, p.keys.k2]).filter((k): k is string => k !== null),
      );
      const seen = new Map<string, number>();
      const dups = new Map<number, number>();
      for (const p of prepared) {
        let dup: number | null = null;
        for (const k of [p.keys.k1, p.keys.k2]) {
          if (!k) continue;
          const earlier = first.get(k) ?? seen.get(k);
          if (earlier !== undefined && (dup === null || earlier < dup)) dup = earlier;
        }
        for (const k of [p.keys.k1, p.keys.k2])
          if (k && !seen.has(k) && !first.has(k)) seen.set(k, p.r.row_no);
        if (dup !== null) dups.set(p.r.row_no, dup);
      }
      // 3. the handler plans the rows whose cells parsed
      const work: WorkRow[] = [];
      const verdicts = new Map<number, Verdict>();
      for (const p of prepared) {
        if (p.issues.length > 0) {
          verdicts.set(p.r.row_no, { plan: 'error', errors: p.issues, warnings: [] });
          continue;
        }
        work.push({
          row_no: p.r.row_no,
          mapped: p.record,
          dup_of: dups.get(p.r.row_no) ?? null,
          match_key: p.keys.k1,
          match_key2: p.keys.k2,
          plan: null,
          entity_id: null,
          entity_version: null,
        });
      }
      if (work.length > 0) {
        const results = await handler.plan(env, work);
        work.forEach((w, i) => verdicts.set(w.row_no, results[i]!));
      }
      for (const p of prepared) {
        const v = verdicts.get(p.r.row_no)!;
        out.push({
          row_no: p.r.row_no,
          mapped: p.record,
          match_key: p.keys.k1,
          match_key2: p.keys.k2,
          dup_of: dups.get(p.r.row_no) ?? null,
          plan: v.plan,
          errors: v.errors,
          warnings: v.warnings,
          entity_id: v.entityId ?? null,
          entity_version: v.entityVersion ?? null,
        });
      }
      const json = JSON.stringify(out);
      await tx.$executeRaw`
        update app.import_row r
           set mapped = v.mapped, match_key = v.match_key, match_key2 = v.match_key2, dup_of = v.dup_of, plan = v.plan,
               errors = v.errors, warnings = v.warnings, entity_id = v.entity_id, entity_version = v.entity_version
          from jsonb_to_recordset(${json}::jsonb) as v(row_no int, mapped jsonb, match_key text, match_key2 text,
                 dup_of int, plan text, errors jsonb, warnings jsonb, entity_id uuid, entity_version int)
         where r.job_id = ${job.id}::uuid and r.row_no = v.row_no`;
      await tx.import_job.update({
        where: { id: job.id },
        data: {
          cursor_row: rows[rows.length - 1]!.row_no,
          rows_processed: job.rows_processed + rows.length,
        },
      });
    }
    const done = rows.length < this.deps.config.batchRows;
    if (!done) {
      await this.queueNext(tx, tenantId, job.id);
      ctx.logger.debug(
        { import_id: job.id, rows: rows.length, ms: Math.round(performance.now() - started) },
        'dry-run step',
      );
      return;
    }
    await this.finishDryRun(env, ctx);
  }

  private async earlierKeys(
    tx: Tx,
    jobId: string,
    beforeRow: number,
    keys: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (keys.length === 0 || beforeRow <= 1) return out;
    const rows = await tx.$queryRaw<Array<{ k: string; n: number }>>`
      select k, min(n)::int as n from (
        select match_key as k, row_no as n from app.import_row
         where job_id = ${jobId}::uuid and row_no < ${beforeRow} and match_key = any(${keys}::text[])
        union all
        select match_key2 as k, row_no as n from app.import_row
         where job_id = ${jobId}::uuid and row_no < ${beforeRow} and match_key2 = any(${keys}::text[])
      ) s group by k`;
    for (const r of rows) out.set(r.k, r.n);
    return out;
  }

  private async finishDryRun(env: HandlerEnv, ctx: JobContextBase): Promise<void> {
    const { tx, job } = env;
    const counts = await tx.$queryRaw<Array<{ plan: string; n: number }>>`
      select plan, count(*)::int as n from app.import_row where job_id = ${job.id}::uuid group by plan`;
    const n = (p: string) => counts.find((c) => c.plan === p)?.n ?? 0;
    const errorCodes = await tx.$queryRaw<Array<{ code: string; field: string | null; n: number }>>`
      select e->>'code' as code, e->>'field' as field, count(*)::int as n
        from app.import_row, jsonb_array_elements(errors) e
       where job_id = ${job.id}::uuid and plan = 'error' group by 1, 2 order by n desc limit 50`;
    const creates = await tx.$queryRaw<Array<{ field: string; message: string; n: number }>>`
      select w->>'field' as field, w->>'message' as message, count(*)::int as n
        from app.import_row, jsonb_array_elements(warnings) w
       where job_id = ${job.id}::uuid and plan in ('create','update') and w->>'code' = 'will-create'
       group by 1, 2 order by n desc limit 200`;
    const rowDigest = await tx.$queryRaw<Array<{ d: string | null }>>`
      select md5(string_agg(row_no::text || ':' || plan || ':' || coalesce(entity_id::text, ''), ',' order by row_no)) as d
        from app.import_row where job_id = ${job.id}::uuid`;
    const att = job.file_attachment_id
      ? await tx.attachment.findUnique({
          where: { id: job.file_attachment_id },
          select: { sha256: true, size_bytes: true, etag: true } as never,
        })
      : null;
    const digest = sha256(
      JSON.stringify({
        file: att
          ? [
              (att as { sha256?: string | null }).sha256,
              String((att as { size_bytes?: bigint }).size_bytes),
              (att as { etag?: string | null }).etag,
            ]
          : null,
        parse: job.parse,
        mapping: job.mapping,
        options: job.options,
        value_map: job.value_map,
        rows: job.rows_total,
        plan: [n('create'), n('update'), n('skip'), n('error')],
        rowDigest: rowDigest[0]?.d ?? null,
      }),
    );
    const summary = {
      counts: { create: n('create'), update: n('update'), skip: n('skip'), error: n('error') },
      errors_by_code: errorCodes,
      will_create: creates,
    };
    await tx.import_job.update({
      where: { id: job.id },
      data: {
        state: 'dry_run_done',
        plan_create: n('create'),
        plan_update: n('update'),
        plan_skip: n('skip'),
        plan_error: n('error'),
        dry_run_digest: digest,
        dry_run_at: new Date(),
        summary: summary as never,
        error: null,
      },
    });
    await this.deps.audit.write(tx, {
      action: 'import.dry_run_completed',
      entityType: 'import_job',
      entityId: job.id,
      meta: { import_job_id: job.id, ...summary.counts },
    });
    ctx.logger.info({ import_id: job.id, ...summary.counts }, 'dry run complete');
  }

  // --------------------------------------------------------------------------------------- commit

  private async commitStep(env: HandlerEnv, tenantId: string, ctx: JobContextBase): Promise<void> {
    const { tx, job } = env;
    const handler = this.deps.handlers[job.entity_type];
    if (job.cursor_row === 0 && job.rows_processed === 0) {
      // rows the dry run decided not to write are finished at once (skip and error stay what they were)
      await tx.$executeRaw`
        update app.import_row
           set result = case plan when 'skip' then 'skipped' else 'error' end, result_errors = errors, processed_at = now()
         where job_id = ${job.id}::uuid and plan in ('skip','error') and result is null`;
    }
    const rows = await this.nextRows(tx, job, this.deps.config.batchRows, true);
    const works: WorkRow[] = rows.map((r) => ({
      row_no: r.row_no,
      mapped: r.mapped!,
      dup_of: r.dup_of,
      match_key: r.match_key,
      match_key2: r.match_key2,
      plan: r.plan,
      entity_id: r.entity_id,
      entity_version: r.entity_version,
    }));
    // Fast path: the whole batch in one savepoint, no savepoint per row (a savepoint per row is two statements
    // and a sub-transaction id each). It is only trusted when every row went through; the first row that fails,
    // or throws, undoes the batch and runs it again row by row, each row in its own savepoint.
    let outcomes: Outcome[] | null = null;
    if (works.length > 1) {
      try {
        outcomes = await inNamedSavepoint(tx, 'import_batch', async () => {
          if (handler.begin) await handler.begin(env, works);
          const run = async (): Promise<Outcome[]> => {
            const fast: Outcome[] = [];
            for (const work of works) {
              const o = await handler.apply(env, work);
              if (o.result === 'error') throw new BatchNeedsRowSavepoints();
              fast.push(o);
            }
            return fast;
          };
          if (!handler.bulkWrites) return run();
          // audit rows, events and history rows of the batch are inserted together, before the savepoint is released
          return withBulkSink(async (sink) => {
            const fast = await run();
            await flushAuditRows(tx, sink.audit);
            await flushOutboxRows(tx, sink.outbox);
            await flushHistoryRows(tx, sink.history);
            return fast;
          });
        });
      } catch (err) {
        if (!(err instanceof BatchNeedsRowSavepoints)) {
          // an unexpected exception: the transaction may be poisoned; the savepoint rollback has repaired it
          ctx.logger.warn({ import_id: job.id, err }, 'import batch retried row by row');
        }
        env.memo.clear(); // caches of what the undone batch created
        outcomes = null;
      }
    }
    if (outcomes === null) {
      if (handler.begin) await handler.begin(env, works);
      outcomes = [];
      for (const work of works) {
        try {
          outcomes.push(
            await inNamedSavepoint(tx, 'import_row', async () => {
              const o = await handler.apply(env, work);
              if (o.result === 'error') throw new RowRolledBack(o);
              return o;
            }),
          );
        } catch (err) {
          // The row's savepoint undid whatever the row created, a model or a location it had to make. The
          // reference resolvers remember what they created, so a later row would point at a record that no
          // longer exists (a foreign key error): drop them, they are rebuilt from the database on first use.
          for (const key of RESOLVER_MEMO_KEYS) env.memo.delete(key);
          if (err instanceof RowRolledBack) outcomes.push(err.outcome);
          else {
            ctx.logger.error(
              { import_id: job.id, row_no: work.row_no, err },
              'import row failed unexpectedly',
            );
            outcomes.push({
              result: 'error',
              errors: [
                {
                  field: null,
                  code: 'internal',
                  message:
                    'The row could not be written (unexpected error). It was skipped; try it again later.',
                },
              ],
            });
          }
        }
      }
    }
    const rowOutcomes = works.map((w, i) => {
      const outcome = outcomes![i]!;
      return {
        row_no: w.row_no,
        result: outcome.result,
        result_errors: outcome.errors.length > 0 ? outcome.errors : null,
        created_id: outcome.createdId ?? null,
        before_image: outcome.before ?? null,
        warnings: outcome.warnings ?? [],
      };
    });
    if (rowOutcomes.length > 0) {
      const json = JSON.stringify(rowOutcomes);
      await tx.$executeRaw`
        update app.import_row r
           set result = v.result, result_errors = v.result_errors, created_id = v.created_id,
               before_image = v.before_image, processed_at = now(),
               warnings = case when jsonb_array_length(v.warnings) > 0 then v.warnings else r.warnings end
          from jsonb_to_recordset(${json}::jsonb) as v(row_no int, result text, result_errors jsonb, created_id uuid,
                 before_image jsonb, warnings jsonb)
         where r.job_id = ${job.id}::uuid and r.row_no = v.row_no`;
    }
    const count = (res: string) => rowOutcomes.filter((o) => o.result === res).length;
    await tx.import_job.update({
      where: { id: job.id },
      data: {
        cursor_row: rows.length > 0 ? rows[rows.length - 1]!.row_no : job.cursor_row,
        rows_processed: job.rows_processed + rows.length,
        done_create: { increment: count('created') },
        done_update: { increment: count('updated') },
        done_skip: { increment: count('skipped') },
        done_error: { increment: count('error') },
      },
    });
    if (rows.length > 0) {
      await this.deps.audit.write(tx, {
        action: 'import.batch_committed',
        entityType: 'import_job',
        entityId: job.id,
        meta: {
          import_job_id: job.id,
          first_row: rows[0]!.row_no,
          last_row: rows[rows.length - 1]!.row_no,
          created: count('created'),
          updated: count('updated'),
          skipped: count('skipped'),
          errors: count('error'),
        },
      });
    }
    if (rows.length >= this.deps.config.batchRows) {
      await this.queueNext(tx, tenantId, job.id);
      return;
    }
    await this.finishCommit(env, ctx);
  }

  private async finishCommit(env: HandlerEnv, ctx: JobContextBase): Promise<void> {
    const { tx, job } = env;
    const fresh = (await tx.import_job.findUnique({ where: { id: job.id } }))!;
    const counts = await tx.$queryRaw<Array<{ result: string; n: number }>>`
      select result, count(*)::int as n from app.import_row where job_id = ${job.id}::uuid group by result`;
    const n = (r: string) => counts.find((c) => c.result === r)?.n ?? 0;
    await tx.import_job.update({
      where: { id: job.id },
      data: {
        state: 'completed',
        done_create: n('created'),
        done_update: n('updated'),
        done_skip: n('skipped'),
        done_error: n('error'),
        committed_at: new Date(),
        finished_at: new Date(),
      },
    });
    const meta = {
      import_job_id: job.id,
      created: n('created'),
      updated: n('updated'),
      skipped: n('skipped'),
      errors: n('error'),
      rows: fresh.rows_total,
    };
    await this.deps.audit.write(tx, {
      action: 'import.completed',
      entityType: 'import_job',
      entityId: job.id,
      meta,
    });
    await this.deps.outbox.publish(tx, {
      type: 'import.completed',
      aggregateType: 'import_job',
      aggregateId: job.id,
      payload: { requestedBy: job.requested_by },
    });
    ctx.logger.info({ ...meta }, 'import completed');
  }
}

export { CUSTOM_PREFIX };
export type { ColumnPlan, ImportOptions };
