import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PgAuditWriter } from '../audit/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { EnvelopeSecretBox, createKeyProvider } from '../crypto/index.js';
import { JobHandlerRegistry, JobsModule, JobsRuntime } from '../jobs/index.js';
import {
  type MailTransport,
  QueuedMailSender,
  SmtpMailTransport,
  UnconfiguredMailTransport,
  registerMailJob,
} from '../mail/index.js';
import { OutboxSubscribers, PgOutboxPublisher } from '../outbox/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  MAIL_SENDER,
  OUTBOX_PUBLISHER,
  SECRET_BOX,
  type JobQueue,
  type SecretBox,
} from '../ports/index.js';

/** The mail delivery edge (SMTP). Injectable so tests and the worker can reach or replace it. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * Binds the real implementations of the shared ports (src/ports/index.ts) so ANY module can inject
 * them by token, without importing an implementation:
 *
 *   AUDIT_WRITER      PgAuditWriter           append to app.audit_log in the caller's tx   (PLAT-04)
 *   OUTBOX_PUBLISHER  PgOutboxPublisher       insert into app.outbox_event in the tx        (PLAT-05)
 *   JOB_QUEUE         PgBossJobQueue          pg-boss, transactional enqueue                (PLAT-06)
 *   SECRET_BOX        EnvelopeSecretBox       AES-256-GCM envelope, KeyProvider-wrapped     (PLAT-08)
 *   MAIL_SENDER       QueuedMailSender        row + `mail.send` job in the tx, SMTP in worker (PLAT-09)
 *
 * It also registers the `mail.send` handler with the job registry (the worker role runs it) and
 * exposes {@link OutboxSubscribers} (where modules subscribe to outbox events; the relay runs in
 * the worker role). Global: importing PlatformModule once (AppModule does) is enough.
 */
@Global()
@Module({
  imports: [JobsModule],
  providers: [
    { provide: AUDIT_WRITER, useFactory: () => new PgAuditWriter() },
    { provide: OUTBOX_PUBLISHER, useFactory: () => new PgOutboxPublisher() },
    {
      provide: JOB_QUEUE,
      inject: [JobsRuntime],
      useFactory: (jobs: JobsRuntime): JobQueue => jobs.queue,
    },
    {
      provide: SECRET_BOX,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SecretBox => {
        const { provider, ephemeral } = createKeyProvider(config);
        if (ephemeral) {
          new Logger('SecretBox').warn(
            'no MASTER_KEY / MASTER_KEY_FILE configured: using a throwaway key. Secrets encrypted by this process cannot be read after a restart or by another role.',
          );
        }
        return new EnvelopeSecretBox(provider);
      },
    },
    {
      provide: MAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): MailTransport =>
        config.SMTP_URL ? new SmtpMailTransport(config.SMTP_URL) : new UnconfiguredMailTransport(),
    },
    {
      provide: MAIL_SENDER,
      inject: [SECRET_BOX, JOB_QUEUE],
      useFactory: (secrets: SecretBox, jobs: JobQueue) => new QueuedMailSender(secrets, jobs),
    },
    OutboxSubscribers,
  ],
  exports: [
    AUDIT_WRITER,
    OUTBOX_PUBLISHER,
    JOB_QUEUE,
    MAIL_SENDER,
    SECRET_BOX,
    MAIL_TRANSPORT,
    OutboxSubscribers,
  ],
})
export class PortsModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    private readonly registry: JobHandlerRegistry,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    registerMailJob(this.registry, {
      secrets: this.secrets,
      transport: this.transport,
      from: this.config.MAIL_FROM,
    });
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
