/**
 * TEMPORARY dev bindings for the shared ports (src/ports). REMOVE WHEN THE PLATFORM PORTS LAND
 * (M1-PLAT-04, -05, -06, -08, -09): delete this file, its import in `app.module.ts`, and the
 * `TemporaryPortBindingsModule` line there. Nothing else references it.
 *
 * Why it exists: the auth module depends only on the port interfaces, and another branch implements
 * them. So the app can boot and be exercised end to end here, these minimal stand-ins are bound:
 *  - AUDIT_WRITER  writes app.audit_log in the caller's transaction (same SQL as the bootstrap CLI);
 *  - MAIL_SENDER   logs the message (the mail template data, including the link, is visible in dev logs);
 *  - SECRET_BOX    AES-256-GCM with a key derived from DEV_SECRET_BOX_KEY (dev default when unset);
 *  - JOB_QUEUE / OUTBOX_PUBLISHER  no-ops (the auth module does not use them yet).
 * Not bound when NODE_ENV=test (the e2e tests bind capturing fakes).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { currentRequestId } from '../context/request-context.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  AUDIT_WRITER,
  type AuditEntry,
  type AuditWriter,
  JOB_QUEUE,
  type JobQueue,
  MAIL_SENDER,
  type MailMessage,
  type MailSender,
  OUTBOX_PUBLISHER,
  type OutboxPublisher,
  SECRET_BOX,
  type SecretBox,
} from '../ports/index.js';
import { currentTenantContext, type Tx } from '../tenancy/index.js';

@Injectable()
class TempAuditWriter implements AuditWriter {
  async write(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = currentTenantContext();
    if (!ctx) throw new Error('audit entries are written inside withTenantTx');
    const actor = ctx.actorId ?? null;
    const diff = JSON.stringify({
      ...(entry.before ? { before: entry.before } : {}),
      ...(entry.after ? { after: entry.after } : {}),
      ...(entry.meta ? { meta: entry.meta } : {}),
    });
    await tx.$executeRaw`
      insert into app.audit_log (id, tenant_id, actor_type, actor_user_id, action, entity_type, entity_id, diff, request_id)
      values (${uuidv7()}::uuid, ${ctx.tenantId}::uuid, ${actor ? 'user' : 'system'}, ${actor}::uuid,
              ${entry.action}, ${entry.entityType}, ${entry.entityId}::uuid, ${diff}::jsonb,
              ${currentRequestId() ?? null})`;
  }
}

@Injectable()
class TempMailSender implements MailSender {
  private readonly logger = new Logger('TempMailSender');
  async send(message: MailMessage): Promise<void> {
    this.logger.log(`mail ${message.template} to ${message.to}: ${JSON.stringify(message.data)}`);
  }
}

@Injectable()
class TempSecretBox implements SecretBox {
  private readonly key = createHash('sha256')
    .update(process.env.DEV_SECRET_BOX_KEY ?? 'dev-only-secret-box-key')
    .digest();

  async encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  async decrypt(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    const buf = Buffer.from(ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(buf.subarray(12, 28));
    return new Uint8Array(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]));
  }
}

/** For the seed and CLI, which run without the Nest container. REMOVE with this file (use the platform SecretBox). */
export const createTemporarySecretBox = (): SecretBox => new TempSecretBox();

const noopQueue: JobQueue = { enqueue: async () => 'temporary-noop' };
const noopOutbox: OutboxPublisher = { publish: async () => undefined };

@Global()
@Module({
  providers: [
    { provide: AUDIT_WRITER, useClass: TempAuditWriter },
    { provide: MAIL_SENDER, useClass: TempMailSender },
    { provide: SECRET_BOX, useClass: TempSecretBox },
    { provide: JOB_QUEUE, useValue: noopQueue },
    { provide: OUTBOX_PUBLISHER, useValue: noopOutbox },
  ],
  exports: [AUDIT_WRITER, MAIL_SENDER, SECRET_BOX, JOB_QUEUE, OUTBOX_PUBLISHER],
})
export class TemporaryPortBindingsModule {}
