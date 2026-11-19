/** In-memory port implementations for unit tests. Never bound in the application module. */
import { Readable } from 'node:stream';
import { assertObjectKey } from '../storage/index.js';
import {
  StorageNotFoundError,
  type AuditEntry,
  type AuditWriter,
  type JobQueue,
  type MailMessage,
  type MailSender,
  type OutboxEvent,
  type OutboxPublisher,
  type PresignedDownload,
  type PresignedUpload,
  type ScanVerdict,
  type SecretBox,
  type StorageAdapter,
  type StorageObjectInfo,
  type VirusScanner,
} from './index.js';

export class FakeAuditWriter implements AuditWriter {
  readonly entries: AuditEntry[] = [];
  async write(_tx: unknown, entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export class FakeOutbox implements OutboxPublisher {
  readonly events: OutboxEvent[] = [];
  async publish(_tx: unknown, event: OutboxEvent): Promise<void> {
    this.events.push(event);
  }
}

export class FakeJobQueue implements JobQueue {
  readonly jobs: { name: string; payload: Record<string, unknown> }[] = [];
  async enqueue(name: string, payload: Record<string, unknown>): Promise<string | null> {
    this.jobs.push({ name, payload });
    return String(this.jobs.length);
  }
}

export class FakeMailSender implements MailSender {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** Reversible, context-checked transform. NOT cryptography; tests only. */
export class FakeSecretBox implements SecretBox {
  async encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    return new TextEncoder().encode(`${context}|${Buffer.from(plaintext).toString('base64')}`);
  }
  async decrypt(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    const [ctx, body] = new TextDecoder().decode(ciphertext).split('|');
    if (ctx !== context || body === undefined) throw new Error('secret context mismatch');
    return new Uint8Array(Buffer.from(body, 'base64'));
  }
}

/**
 * In-memory StorageAdapter. "Presigned" URLs are inert strings; tests play the client with
 * {@link FakeStorageAdapter.putObject}. Keys are validated exactly as the real adapters do.
 */
export class FakeStorageAdapter implements StorageAdapter {
  readonly driver = 'fake' as const;
  readonly objects = new Map<string, { body: Buffer; contentType: string; version: number }>();
  readonly deleted: string[] = [];
  private version = 0;

  async ensureReady(): Promise<void> {}

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds: number;
  }): Promise<PresignedUpload> {
    assertObjectKey(input.key);
    return {
      method: 'PUT',
      url: `https://storage.fake/put/${input.key}?size=${input.sizeBytes}`,
      headers: { 'content-type': input.contentType },
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }

  async presignDownload(input: {
    key: string;
    filename: string;
    contentType: string;
    disposition: 'inline' | 'attachment';
    ttlSeconds: number;
  }): Promise<PresignedDownload> {
    assertObjectKey(input.key);
    return {
      url: `https://storage.fake/get/${input.key}?disposition=${input.disposition}`,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }

  /** What the browser's PUT would have done. */
  putObject(key: string, body: Buffer | string, contentType = 'application/octet-stream'): void {
    assertObjectKey(key);
    this.objects.set(key, {
      body: Buffer.isBuffer(body) ? body : Buffer.from(body),
      contentType,
      version: ++this.version,
    });
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    assertObjectKey(key);
    const o = this.objects.get(key);
    return o
      ? { sizeBytes: o.body.length, contentType: o.contentType, etag: `"fake-${o.version}"` }
      : null;
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    assertObjectKey(key);
    const o = this.objects.get(key);
    if (!o) throw new StorageNotFoundError(key);
    return Readable.from([range ? o.body.subarray(range.start, range.end + 1) : o.body]);
  }

  async write(
    key: string,
    body: Buffer,
    opts: { contentType: string },
  ): Promise<{ etag: string | null }> {
    this.putObject(key, body, opts.contentType);
    return { etag: `"fake-${this.version}"` };
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    this.objects.delete(key);
    this.deleted.push(key);
  }
}

/** The standard anti-malware test string (https://www.eicar.org/): harmless, detected by every scanner. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Scanner that flags the EICAR string and nothing else; `failing` makes it reject like an outage. */
export class FakeVirusScanner implements VirusScanner {
  failing = false;
  scanned = 0;
  constructor(readonly enabled = true) {}

  async scan(body: Readable): Promise<ScanVerdict> {
    const chunks: Buffer[] = [];
    for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
    this.scanned += 1;
    if (this.failing) throw new Error('fake scanner is down');
    return Buffer.concat(chunks).includes(EICAR)
      ? { status: 'infected', signature: 'Eicar-Test-Signature' }
      : { status: 'clean' };
  }

  async ping(): Promise<boolean> {
    return !this.failing;
  }
}
