/** In-memory port implementations for unit tests. Never bound in the application module. */
import type {
  AuditEntry,
  AuditWriter,
  JobQueue,
  MailMessage,
  MailSender,
  OutboxEvent,
  OutboxPublisher,
  SecretBox,
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
  async enqueue(name: string, payload: Record<string, unknown>): Promise<string> {
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
