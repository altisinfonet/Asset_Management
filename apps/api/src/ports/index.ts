/**
 * Ports shared by domain modules (auth, registry, ...) and implemented by the platform module.
 * Domain code depends only on these interfaces and injection tokens; the platform module binds the
 * implementations (M1-PLAT-04..09). Test code may bind the in-memory fakes from `./fakes.js`.
 */
import type { Readable } from 'node:stream';
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
  /**
   * Enqueue inside `tx` when given (transactional enqueue), otherwise immediately. Resolves to the
   * job id, or `null` when a `singletonKey` deduplicated the job (an equivalent one already exists).
   */
  enqueue(
    name: string,
    payload: { tenantId?: string } & Record<string, unknown>,
    opts?: { tx?: Tx; startAfterSeconds?: number; singletonKey?: string },
  ): Promise<string | null>;
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

// ---------------------------------------------------------------------------------------------
// Files (M2-FILE-01/02)

/** A presigned (or token-signed) request the CLIENT performs against the object store. */
export interface PresignedUpload {
  method: 'PUT';
  url: string;
  /** Headers the client must send with the PUT (the signature covers them). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

export interface StorageObjectInfo {
  sizeBytes: number;
  /** Content type recorded by the store (informational: the allow-list decides what is served). */
  contentType: string | null;
  etag: string | null;
}

/** A requested object does not exist. */
export class StorageNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`storage object not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}

/**
 * Object storage for attachments (architecture 3, 7.3): S3-compatible (MinIO in dev and self-hosted,
 * S3 in Cloud) or a local-filesystem volume (self-hosted fallback). Chosen once at boot. Keys are
 * `tenants/<tenant_id>/<yyyy>/<uuid>[.<ext>]`: every implementation REFUSES any other shape
 * (`storage/keys.ts`), so a fuzzed or traversal key can never reach the store.
 */
export interface StorageAdapter {
  readonly driver: 's3' | 'local' | 'fake';
  /** Creates what the store needs (bucket, directory). Idempotent; called at boot. */
  ensureReady(): Promise<void>;
  /**
   * A PUT the client can perform without credentials. The signature covers `content-type` and
   * `content-length`, so the object must have exactly the declared type and size.
   */
  presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds: number;
  }): Promise<PresignedUpload>;
  /** A short-lived GET. `disposition` and `contentType` are forced on the response. */
  presignDownload(input: {
    key: string;
    filename: string;
    contentType: string;
    disposition: 'inline' | 'attachment';
    ttlSeconds: number;
  }): Promise<PresignedDownload>;
  /** `null` when the object does not exist. */
  head(key: string): Promise<StorageObjectInfo | null>;
  /** Streams the object (optionally a byte range, inclusive). Throws {@link StorageNotFoundError}. */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  /** Server-side write (derivatives, re-encoded originals). Overwrites. */
  write(key: string, body: Buffer, opts: { contentType: string }): Promise<{ etag: string | null }>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}

/** Outcome of scanning one object. */
export type ScanVerdict = { status: 'clean' } | { status: 'infected'; signature: string };

/** Virus scanning over a byte stream (ClamAV `INSTREAM`). Chosen once at boot. */
export interface VirusScanner {
  /** False when no scanner is configured (no CLAMD_HOST): `SCAN_REQUIRED` decides what that means. */
  readonly enabled: boolean;
  /**
   * Streams `body` to the scanner. Resolves with the verdict; REJECTS when the scanner cannot
   * answer (down, timeout, size limit): the caller retries, it must never treat that as clean.
   */
  scan(body: Readable): Promise<ScanVerdict>;
  /** Cheap liveness probe (clamd PING). */
  ping(): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------------
// Notifications (M2-NOT-01)

/** One notification to create for one or more users. */
export interface NotificationRequest {
  /** A registered notification type (`src/notifications/types.ts`), e.g. `attachment.infected`. */
  type: string;
  /** Login accounts (user ids) to notify; duplicates are folded. */
  recipients: readonly string[];
  /** Template variables (names, counts): rendered into the in-app text and the email. */
  vars: Readonly<Record<string, string | number>>;
  /** The record the notification is about, so the bell can link to it. */
  entity?: { type: string; id: string };
  /** Path inside the web app that shows the subject (`/assets/view?id=...`). */
  link?: string;
  /**
   * What makes this notification "the same" for a recipient: a second request with the same key and
   * recipient is ignored (an outbox redelivery, a producer that fires twice).
   */
  dedupeKey: string;
}

export interface NotifyResult {
  /** Notifications created (one per recipient that wants this type and was not notified already). */
  created: number;
  /** Recipients left out: duplicate, switched off by preference or rule, no longer active. */
  skipped: number;
}

/**
 * Creates in-app notifications and queues their email (per user preference: immediately, in the daily
 * digest, or not at all). MUST be called inside a tenant transaction (ADR 0004): the rows, the delivery
 * log and the mail commit together with the change that caused them, like audit rows and outbox events.
 */
export interface Notifier {
  notify(tx: Tx, request: NotificationRequest): Promise<NotifyResult>;
}

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');
export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const MAIL_SENDER = Symbol('MAIL_SENDER');
export const SECRET_BOX = Symbol('SECRET_BOX');
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');
export const NOTIFIER = Symbol('NOTIFIER');
