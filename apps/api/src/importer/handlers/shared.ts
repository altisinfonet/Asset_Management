import type { z } from 'zod';
import type { AuthContext } from '../../auth/index.js';
import { ApiProblem } from '../../platform/index.js';
import type { Tx } from '../../tenancy/index.js';
import type { ColumnPlan } from '../mapper.js';
import type { RefServices } from '../refs.js';
import type {
  ImportOptions,
  JobRow,
  MappedRecord,
  Outcome,
  RowIssue,
  ValueMap,
  Verdict,
} from '../types.js';

/** What every entity handler needs from its surroundings; built once per worker step. */
export interface HandlerEnv {
  tx: Tx;
  auth: AuthContext;
  job: JobRow;
  options: ImportOptions;
  valueMap: ValueMap;
  columns: readonly ColumnPlan[];
  baseCurrency: string;
  refs: RefServices;
  /** Per-step memo (reference resolvers, catalogue reads): lives as long as the step's transaction. */
  memo: Map<string, unknown>;
}

/** A row as the planner and the committer see it. */
export interface WorkRow {
  row_no: number;
  mapped: MappedRecord;
  dup_of: number | null;
  match_key: string | null;
  match_key2: string | null;
  plan: Verdict['plan'] | null;
  entity_id: string | null;
  entity_version: number | null;
}

export interface EntityHandler {
  /** Normalised de-duplication keys of a mapped record (null when the row has none). */
  keys(
    rec: MappedRecord,
    env: Pick<HandlerEnv, 'options' | 'columns'>,
  ): { k1: string | null; k2: string | null };
  /** Dry run of a batch: one verdict per row, in order; writes nothing to the registry. */
  plan(env: HandlerEnv, rows: WorkRow[]): Promise<Verdict[]>;
  /** Rows of a commit batch may defer their audit, event and history inserts to one multi-row INSERT each. */
  readonly bulkWrites?: boolean;
  /** Called once with the rows of a commit batch, before the first `apply`: preload what they will look up. */
  begin?(env: HandlerEnv, rows: WorkRow[]): Promise<void>;
  /** Commit of ONE row, inside the engine's savepoint (an exception rolls the row back). */
  apply(env: HandlerEnv, row: WorkRow): Promise<Outcome>;
}

/**
 * A named savepoint inside the step's transaction: a failing row is rolled back without losing the rows
 * before it (M2-IMP-05: failed rows are recorded without aborting the job). Unlike the registry's
 * constant-named helper, the name is chosen by the caller so the importer's row savepoint and its inner
 * ones (check-out after create) can nest.
 */
export async function inNamedSavepoint<T>(
  tx: Tx,
  name: 'import_row' | 'import_inner' | 'import_probe' | 'import_batch',
  fn: () => Promise<T>,
): Promise<T> {
  switch (name) {
    case 'import_row':
      await tx.$executeRaw`savepoint import_row`;
      break;
    case 'import_inner':
      await tx.$executeRaw`savepoint import_inner`;
      break;
    case 'import_probe':
      await tx.$executeRaw`savepoint import_probe`;
      break;
    case 'import_batch':
      await tx.$executeRaw`savepoint import_batch`;
      break;
  }
  try {
    const out = await fn();
    await release(tx, name);
    return out;
  } catch (err) {
    await rollbackTo(tx, name);
    throw err;
  }
}

async function release(tx: Tx, name: string): Promise<void> {
  if (name === 'import_row') await tx.$executeRaw`release savepoint import_row`;
  else if (name === 'import_inner') await tx.$executeRaw`release savepoint import_inner`;
  else if (name === 'import_batch') await tx.$executeRaw`release savepoint import_batch`;
  else await tx.$executeRaw`release savepoint import_probe`;
}

async function rollbackTo(tx: Tx, name: string): Promise<void> {
  if (name === 'import_row') {
    await tx.$executeRaw`rollback to savepoint import_row`;
    await tx.$executeRaw`release savepoint import_row`;
  } else if (name === 'import_inner') {
    await tx.$executeRaw`rollback to savepoint import_inner`;
    await tx.$executeRaw`release savepoint import_inner`;
  } else if (name === 'import_batch') {
    await tx.$executeRaw`rollback to savepoint import_batch`;
    await tx.$executeRaw`release savepoint import_batch`;
  } else {
    await tx.$executeRaw`rollback to savepoint import_probe`;
    await tx.$executeRaw`release savepoint import_probe`;
  }
}

/** Runs `fn`, then rolls EVERYTHING it did back (the dry run of services that write): the result or error is kept. */
export async function probe<T>(
  tx: Tx,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  await tx.$executeRaw`savepoint import_probe`;
  let result: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    result = { ok: true, value: await fn() };
  } catch (error) {
    result = { ok: false, error };
  }
  await tx.$executeRaw`rollback to savepoint import_probe`;
  await tx.$executeRaw`release savepoint import_probe`;
  return result;
}

/** The field of the import a service's JSON pointer belongs to. */
export type PointerMap = (pointer: string) => string | null;

const COLUMN_OF_POINTER: Record<string, string> = {
  category_id: 'category',
  model_id: 'model',
  status_id: 'status',
  location_id: 'location',
  department_id: 'department',
  vendor_id: 'vendor',
  manager_person_id: 'manager',
  parent_id: 'parent_path',
  purchase_cost_minor: 'purchase_cost',
  company_id: 'company',
};

export const assetPointer: PointerMap = (p) => {
  const parts = p.replace(/^\//, '').split('/');
  if (parts[0] === 'custom_data' && parts[1]) return `cf:${parts[1]}`;
  const first = parts[0] ?? '';
  return first === '' ? null : (COLUMN_OF_POINTER[first] ?? first);
};

export const plainPointer =
  (extra: Record<string, string> = {}): PointerMap =>
  (p) => {
    const parts = p.replace(/^\//, '').split('/');
    const first = parts[0] ?? '';
    if (first === 'address' && parts[1])
      return parts[1] === 'line1' || parts[1] === 'line2' ? `address_${parts[1]}` : parts[1]!;
    return first === '' ? null : (extra[first] ?? COLUMN_OF_POINTER[first] ?? first);
  };

/** An ApiProblem (validation, conflict, precondition...) as issues of a row; anything else is rethrown. */
export function issuesOf(err: unknown, pointer: PointerMap): RowIssue[] {
  if (!(err instanceof ApiProblem)) throw err;
  if (err.errors && err.errors.length > 0) {
    return err.errors.map((e) => ({
      field: pointer(e.pointer),
      message: e.message,
      code: e.code ?? err.code,
    }));
  }
  return [{ field: null, message: err.detail ?? err.message, code: err.code }];
}

/** Zod issues of a candidate body as issues of a row. */
export function zodIssues(
  issues: ReadonlyArray<z.core.$ZodIssue>,
  pointer: PointerMap,
): RowIssue[] {
  return issues.map((i) => ({
    field: pointer(`/${i.path.map(String).join('/')}`),
    message: i.message,
    code: i.code === 'unrecognized_keys' ? 'unknown-field' : String(i.code),
  }));
}

/** The acting user of an import, as the services expect to see an `AuthContext`. */
export function jobAuth(tenantId: string, userId: string): AuthContext {
  return {
    method: 'session',
    tenantId,
    userId,
    principalId: userId,
    sessionId: null,
    apiKeyId: null,
    apiKeyScopes: null,
    sessionToken: null,
    user: {
      id: userId,
      email: '',
      displayName: 'import',
      status: 'active',
      locale: null,
      timezone: null,
      mfaEnabled: false,
      lastLoginAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      version: 1,
    },
    grants: [],
    permissions: ['*'],
    mfaVerified: true,
    mfaEnrolmentRequired: false,
    session: null,
    csrfToken: null,
  } as AuthContext;
}

/** Everything present in `body` and not undefined (a PATCH body without the holes). */
export function compact<T extends Record<string, unknown>>(body: T): Partial<T> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Partial<T>;
}
