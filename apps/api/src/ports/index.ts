/**
 * Ports shared by domain modules (auth, registry, ...) and implemented by the platform module.
 * Domain code depends only on these interfaces and injection tokens; the platform module binds the
 * implementations (M1-PLAT-04..09). Test code may bind the in-memory fakes from `./fakes.js`.
 */
import type { Tx } from '../tenancy/index.js';

/** Audit trail entry, written in the SAME transaction as the change it describes (M1-PLAT-04). */
export interface AuditEntry {
  /** e.g. 'auth.login.succeeded', 'asset.updated'. Dotted, lower-case, past tense. */
  action: string;
  entityType: string;
  entityId: string | null;
  /** Field-level before/after; sensitive fields must already be redacted by the caller. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Extra context (reason, ip is taken from the request context automatically). */
  meta?: Record<string, unknown>;
}

export interface AuditWriter {
  /** Appends to app.audit_log inside `tx` (tenant from the transaction's app.tenant_id). */
  write(tx: Tx, entry: AuditEntry): Promise<void>;
}

/** Domain event recorded in app.outbox_event inside the business transaction (M1-PLAT-05). */
export interface OutboxEvent {
  type: string;
  aggregateType: string;
  aggregateId: string;
  /** Ids and non-sensitive fields only (payloads are readable without RLS by the relay). */
  payload: Record<string, unknown>;
}

export interface OutboxPublisher {
  publish(tx: Tx, event: OutboxEvent): Promise<void>;
}

/** Background job enqueue (pg-boss behind an adapter, M1-PLAT-06). Payloads carry ids only. */
export interface JobQueue {
  /** Enqueue inside `tx` when given (transactional enqueue), otherwise immediately. */
  enqueue(
    name: string,
    payload: { tenantId?: string } & Record<string, unknown>,
    opts?: { tx?: Tx; startAfterSeconds?: number; singletonKey?: string },
  ): Promise<string>;
}

/** Outbound mail (SMTP in self-hosted / Mailpit in dev, SES in Cloud) (M1-PLAT-09). */
export interface MailMessage {
  to: string;
  /** Template id, e.g. 'auth.invitation', 'auth.password-reset', 'auth.mfa-enabled'. */
  template: string;
  locale?: string;
  data: Record<string, unknown>;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** Envelope encryption for secrets at rest (TOTP secrets, integration credentials) (M1-PLAT-08). */
export interface SecretBox {
  /** `context` binds ciphertext to its owner (e.g. tenant id + purpose); decrypt must use the same. */
  encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array, context: string): Promise<Uint8Array>;
}

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');
export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const MAIL_SENDER = Symbol('MAIL_SENDER');
export const SECRET_BOX = Symbol('SECRET_BOX');
