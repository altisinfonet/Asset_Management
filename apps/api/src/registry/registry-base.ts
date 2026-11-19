import { Inject } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { diffRecords } from '../audit/index.js';
import {
  ApiProblem,
  type FieldError,
  type IfMatch,
  assertIfMatch,
  etagFor,
  problem,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { isUniqueViolation, sqlStateOf, TenancyService, type Tx } from '../tenancy/index.js';

/** What a state-changing registry operation records next to the change (DoD 7). */
export interface ChangeRecord {
  /** Entity name: audit `entity_type`, the prefix of the audit action and of the outbox event type. */
  entity: string;
  verb: 'created' | 'updated' | 'archived' | 'restored' | string;
  id: string;
  version: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  /** Extra ids for the outbox payload (ids only). */
  refs?: Record<string, string | null>;
}

/** Shared plumbing of the registry services: tenant transaction, audit + outbox in the same tx. */
export abstract class RegistryBase {
  constructor(
    protected readonly tenancy: TenancyService,
    @Inject(AUDIT_WRITER) protected readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) protected readonly outbox: OutboxPublisher,
  ) {}

  /** Joins the keyed-request transaction when there is one, otherwise opens its own. */
  protected tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }

  /** Audit row + outbox event, in the caller's transaction. */
  protected async record(trx: Tx, change: ChangeRecord): Promise<void> {
    const diff =
      change.before !== undefined || change.after !== undefined
        ? diffRecords(change.before ?? null, change.after ?? null)
        : { before: null, after: null };
    await this.audit.write(trx, {
      action: `${change.entity}.${change.verb}`,
      entityType: change.entity,
      entityId: change.id,
      before: diff.before,
      after: diff.after,
      ...(change.meta ? { meta: change.meta } : {}),
    });
    await this.outbox.publish(trx, {
      type: `${change.entity}.${change.verb}`,
      aggregateType: change.entity,
      aggregateId: change.id,
      payload: { version: change.version, ...(change.refs ?? {}) },
    });
  }
}

/** `409 conflict` listing what references the entity (RFC 9457 extension member `usage`). */
export function inUse(label: string, usage: Record<string, number>): ApiProblem {
  const parts = Object.entries(usage)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${what}: ${n}`);
  return new ApiProblem({
    code: 'conflict',
    detail: `${label} is in use (${parts.join(', ')}) and cannot be deleted.`,
    extensions: { usage },
  });
}

/** The entries of `counts` that are not zero: optional `usage` members that older clients never saw. */
export const nonZero = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));

export const duplicate = (label: string, pointer: string, value: string): ApiProblem =>
  new ApiProblem({
    code: 'conflict',
    detail: `${label} "${value}" already exists.`,
    errors: [{ pointer, message: 'is already in use', code: 'duplicate' }],
  });

export const invalidRef = (pointer: string, message: string): FieldError => ({
  pointer,
  message,
  code: 'not-found',
});

/** A write-time race on `version`: 404 when the row vanished, 412 when it changed. */
export async function stalePrecondition(
  exists: () => Promise<{ version: number } | null>,
  label: string,
): Promise<never> {
  const now = await exists();
  if (!now) throw problem.notFound(`${label} not found.`);
  throw problem.preconditionFailed(
    `The resource has changed (current ETag ${etagFor(now.version)}). Re-read it and retry.`,
  );
}

export { assertIfMatch, isUniqueViolation, sqlStateOf, type IfMatch };

/** Foreign-key violation (a referenced row disappeared or belongs elsewhere). */
export const isForeignKeyViolation = (err: unknown): boolean => sqlStateOf(err) === '23503';
