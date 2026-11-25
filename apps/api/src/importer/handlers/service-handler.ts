import type { z } from 'zod';
import { RefResolver } from '../refs.js';
import type { MappedRecord, Outcome, RowIssue, Verdict } from '../types.js';
import {
  type EntityHandler,
  type HandlerEnv,
  type PointerMap,
  type WorkRow,
  inNamedSavepoint,
  issuesOf,
  probe,
  rehearse,
  zodIssues,
} from './shared.js';

/** What a subclass derives from one row: candidate bodies (ids resolved) and the problems found on the way. */
export interface Prep {
  issues: RowIssue[];
  warnings: RowIssue[];
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  /** A reference is only announced (dry run): the service-level checks that need its id are skipped. */
  pending: boolean;
}

export interface Existing {
  id: string;
  version: number;
  label: string;
}

/**
 * The shared flow of the people, location and department imports: map -> resolve references -> find the
 * existing record -> decide by policy -> validate or write THROUGH THE SERVICE of the API. A dry run
 * executes the service call inside a savepoint it always rolls back, so the validation is the service's own
 * (and so are its audit rows, events and database constraints, all rolled back with it); a commit executes
 * it for real with the import job in the audit metadata. Asset imports are volume-critical and use the
 * facade's own dry-run option instead (`handlers/asset.ts`).
 */
export abstract class ServiceHandler implements EntityHandler {
  protected abstract readonly label: string;
  protected abstract readonly pointer: PointerMap;
  protected abstract readonly createSchema: z.ZodType;
  protected abstract readonly updateSchema: z.ZodType;

  abstract keys(
    rec: MappedRecord,
    env: Pick<HandlerEnv, 'options' | 'columns'>,
  ): { k1: string | null; k2: string | null };
  protected abstract prepare(
    env: HandlerEnv,
    resolver: RefResolver,
    rec: MappedRecord,
  ): Promise<Prep>;
  /** The existing records the batch may mean, as a function from a mapped record. */
  protected abstract lookup(
    env: HandlerEnv,
    recs: MappedRecord[],
    preps: Prep[],
  ): Promise<(i: number) => { hit: Existing | null; issue?: RowIssue }>;
  protected abstract doCreate(
    env: HandlerEnv,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<string>;
  protected abstract doUpdate(
    env: HandlerEnv,
    id: string,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<number>;
  protected abstract currentOf(
    env: HandlerEnv,
    id: string,
  ): Promise<{ version: number; row: Record<string, unknown> } | null>;
  /** Fields of the body that the importer treats as identifying (never part of an update). */
  protected abstract readonly identity: readonly string[];
  /**
   * Does the dry run rehearse the batch (ED-29: create the missing references in a savepoint that is
   * rolled back, then check every row through the service)? Location imports do not: their references
   * are rows of the same file (a parent created on the way is adopted by its own row at commit), which a
   * rehearsal would report as already existing.
   */
  protected readonly rehearsed: boolean = true;

  private resolver(env: HandlerEnv, mode: 'dry' | 'commit'): RefResolver {
    const key = `service:${mode}`;
    let r = env.memo.get(key) as RefResolver | undefined;
    if (!r) {
      r = new RefResolver(
        env.tx,
        env.auth,
        env.options,
        env.valueMap,
        env.refs,
        mode,
        (kind) => this.refField(kind),
        { import_job_id: env.job.id },
      );
      env.memo.set(key, r);
    }
    return r;
  }

  /** Was this record created by the import itself (as the missing parent of an earlier row)? */
  protected createdByThisImport(_env: HandlerEnv, _id: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected refField(kind: string): string {
    return kind;
  }

  async plan(env: HandlerEnv, rows: WorkRow[]): Promise<Verdict[]> {
    if (!this.rehearsed) return this.planWith(env, rows, this.resolver(env, 'dry'), false);
    // a fresh resolver: what it creates is rolled back with the rehearsal, so it is never memoised
    return rehearse(env.tx, () =>
      this.planWith(
        env,
        rows,
        new RefResolver(
          env.tx,
          env.auth,
          env.options,
          env.valueMap,
          env.refs,
          'commit',
          (kind) => this.refField(kind),
          { import_job_id: env.job.id },
        ),
        true,
      ),
    );
  }

  private async planWith(
    env: HandlerEnv,
    rows: WorkRow[],
    resolver: RefResolver,
    guarded: boolean,
  ): Promise<Verdict[]> {
    const preps: Prep[] = [];
    const failed = new Map<number, RowIssue[]>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!guarded) {
        preps.push(await this.prepare(env, resolver, row.mapped));
        continue;
      }
      // creating a reference can break the transaction: one row's savepoint keeps the others
      try {
        preps.push(
          await inNamedSavepoint(env.tx, 'import_row', () =>
            this.prepare(env, resolver, row.mapped),
          ),
        );
      } catch (err) {
        failed.set(i, issuesOf(err, this.pointer));
        preps.push({ issues: [], warnings: [], create: {}, update: {}, pending: false });
      }
    }
    const find = await this.lookup(
      env,
      rows.map((r) => r.mapped),
      preps,
    );
    const out: Verdict[] = [];
    for (let i = 0; i < rows.length; i++) {
      const issues = failed.get(i);
      out.push(
        issues
          ? { plan: 'error', errors: issues, warnings: [] }
          : await this.planRow(env, rows[i]!, preps[i]!, find(i)),
      );
    }
    return out;
  }

  private async planRow(
    env: HandlerEnv,
    row: WorkRow,
    prep: Prep,
    found: { hit: Existing | null; issue?: RowIssue },
  ): Promise<Verdict> {
    const warnings = [...prep.warnings];
    const fail = (issues: RowIssue[]): Verdict => ({ plan: 'error', errors: issues, warnings });
    if (prep.issues.length > 0) return fail(prep.issues);
    if (found.issue) return fail([found.issue]);
    const policy = env.options.on_match;
    const { hit } = found;

    if (hit) {
      if (policy === 'skip') {
        warnings.push({
          field: null,
          code: 'exists',
          message: `Already exists (${hit.label}); left unchanged.`,
        });
        return { plan: 'skip', errors: [], warnings, entityId: hit.id, entityVersion: hit.version };
      }
      if (policy === 'error')
        return fail([
          {
            field: null,
            code: 'exists',
            message: `A ${this.label} like this already exists (${hit.label}).`,
          },
        ]);
      const parsed = this.updateSchema.safeParse(prep.update);
      if (!parsed.success) return fail(zodIssues(parsed.error.issues, this.pointer));
      const res = await probe(env.tx, () =>
        this.doUpdate(env, hit.id, parsed.data as Record<string, unknown>, {}),
      );
      if (!res.ok) return fail(issuesOf(res.error, this.pointer));
      if (res.value === hit.version) {
        warnings.push({
          field: null,
          code: 'unchanged',
          message: 'Nothing to change; left as it is.',
        });
        return { plan: 'skip', errors: [], warnings, entityId: hit.id, entityVersion: hit.version };
      }
      return { plan: 'update', errors: [], warnings, entityId: hit.id, entityVersion: hit.version };
    }
    if (row.dup_of !== null) {
      if (policy === 'skip') {
        warnings.push({
          field: null,
          code: 'duplicate-in-file',
          message: `Same key as row ${row.dup_of} of the file; skipped.`,
        });
        return { plan: 'skip', errors: [], warnings };
      }
      if (policy === 'error')
        return fail([
          {
            field: null,
            code: 'duplicate-in-file',
            message: `Same key as row ${row.dup_of} of the file.`,
          },
        ]);
      warnings.push({
        field: null,
        code: 'duplicate-in-file',
        message: `Applied on top of row ${row.dup_of}.`,
      });
    }
    const parsed = this.createSchema.safeParse(prep.create);
    if (!parsed.success) return fail(zodIssues(parsed.error.issues, this.pointer));
    if (prep.pending) {
      // only without the rehearsal (a location under a parent this import creates): checked when committed
      warnings.push({
        field: null,
        code: 'validated-at-commit',
        message: 'Checked when the import runs (a record it needs is created on the way).',
      });
    } else {
      const res = await probe(env.tx, () =>
        this.doCreate(env, parsed.data as Record<string, unknown>, {}),
      );
      if (!res.ok) return fail(issuesOf(res.error, this.pointer));
    }
    return { plan: row.dup_of !== null ? 'update' : 'create', errors: [], warnings };
  }

  async apply(env: HandlerEnv, row: WorkRow): Promise<Outcome> {
    const resolver = this.resolver(env, 'commit');
    const prep = await this.prepare(env, resolver, row.mapped);
    const warnings = [...prep.warnings];
    if (prep.issues.length > 0) return { result: 'error', errors: prep.issues, warnings };
    const find = await this.lookup(env, [row.mapped], [prep]);
    const { hit, issue } = find(0);
    if (issue) return { result: 'error', errors: [issue], warnings };
    // a record this very import created as a missing parent of an earlier row is the row's own record: apply the row to it
    const adopted = hit ? await this.createdByThisImport(env, hit.id) : false;
    const policy = adopted ? 'update' : env.options.on_match;
    const meta = { import_job_id: env.job.id, import_row: row.row_no };

    try {
      if (hit) {
        if (policy === 'skip')
          return {
            result: 'skipped',
            errors: [],
            warnings: [
              ...warnings,
              {
                field: null,
                code: 'exists',
                message: `Already exists (${hit.label}); left unchanged.`,
              },
            ],
            entityId: hit.id,
          };
        if (policy === 'error')
          return {
            result: 'error',
            errors: [
              {
                field: null,
                code: 'exists',
                message: `A ${this.label} like this already exists (${hit.label}).`,
              },
            ],
            warnings,
          };
        const current = await this.currentOf(env, hit.id);
        if (!current)
          return {
            result: 'error',
            errors: [
              { field: null, code: 'not-found', message: `The ${this.label} no longer exists.` },
            ],
            warnings,
          };
        if (
          env.options.detect_changes &&
          row.entity_version !== null &&
          row.dup_of === null &&
          row.entity_id === hit.id &&
          current.version !== row.entity_version
        ) {
          return {
            result: 'error',
            errors: [
              {
                field: null,
                code: 'changed-since-dry-run',
                message: `The ${this.label} was edited after the dry run; it was not touched. Run the dry run again.`,
              },
            ],
            warnings,
          };
        }
        const parsed = this.updateSchema.safeParse(prep.update);
        if (!parsed.success)
          return {
            result: 'error',
            errors: zodIssues(parsed.error.issues, this.pointer),
            warnings,
          };
        const body = parsed.data as Record<string, unknown>;
        const before = pickBefore(current.row, body);
        const version = await this.doUpdate(env, hit.id, body, meta);
        if (version === current.version)
          return {
            result: 'skipped',
            errors: [],
            warnings: [
              ...warnings,
              { field: null, code: 'unchanged', message: 'Nothing to change; left as it is.' },
            ],
            entityId: hit.id,
          };
        return { result: 'updated', errors: [], entityId: hit.id, before, warnings };
      }
      const parsed = this.createSchema.safeParse(prep.create);
      if (!parsed.success)
        return { result: 'error', errors: zodIssues(parsed.error.issues, this.pointer), warnings };
      const id = await this.doCreate(env, parsed.data as Record<string, unknown>, meta);
      return { result: 'created', errors: [], createdId: id, warnings };
    } catch (err) {
      return { result: 'error', errors: issuesOf(err, this.pointer), warnings };
    }
  }
}

/** The values of `row` under the keys `body` names (the before-image of an update). */
export function pickBefore(
  row: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) out[key] = row[key] ?? null;
  return out;
}
