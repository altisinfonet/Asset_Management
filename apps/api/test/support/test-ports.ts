import { Global, Module } from '@nestjs/common';
import {
  AUDIT_WRITER,
  type AuditEntry,
  type AuditWriter,
  JOB_QUEUE,
  MAIL_SENDER,
  OUTBOX_PUBLISHER,
  SECRET_BOX,
  STORAGE_ADAPTER,
  VIRUS_SCANNER,
} from '../../src/ports/index.js';
import {
  FakeJobQueue,
  FakeMailSender,
  FakeOutbox,
  FakeSecretBox,
  FakeStorageAdapter,
  FakeVirusScanner,
} from '../../src/ports/fakes.js';
import { assertEnqueueable } from '../../src/jobs/index.js';
import { parseTemplateData } from '../../src/mail/index.js';
import {
  currentTenantContext,
  currentTenantTx,
  NoTenantTransactionError,
  type Tx,
} from '../../src/tenancy/index.js';

/**
 * Audit writer for tests: records each entry together with the tenant context it was written in and
 * fails when it is NOT written through the active tenant transaction ("audit in the same tx").
 */
export class CapturingAuditWriter implements AuditWriter {
  readonly entries: Array<AuditEntry & { tenantId: string; actorId?: string }> = [];

  async write(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = currentTenantContext();
    if (!ctx) throw new Error(`audit ${entry.action} written outside withTenantTx`);
    if (tx !== currentTenantTx()) {
      throw new Error(
        `audit ${entry.action} written with a transaction that is not the active tenant tx`,
      );
    }
    this.entries.push({ ...entry, tenantId: ctx.tenantId, actorId: ctx.actorId });
  }

  actions(tenantId?: string): string[] {
    return this.entries.filter((e) => !tenantId || e.tenantId === tenantId).map((e) => e.action);
  }
}

/**
 * Mail sender for tests with the same contract as the platform one (ADR 0004): it must be called
 * inside `withTenantTx`, and the template data must satisfy the platform template schema.
 */
export class CapturingMailSender extends FakeMailSender {
  override async send(message: Parameters<FakeMailSender['send']>[0]): Promise<void> {
    if (!currentTenantContext()) throw new NoTenantTransactionError();
    parseTemplateData(message.template, message.data);
    await super.send(message);
  }
}

/**
 * Job queue for tests (M2-SEC-01): records the jobs like the in-memory fake, but first applies the SAME
 * job payload lint as the pg-boss adapter (`assertEnqueueable`: catalogued queue, ids-only payload, the
 * tenantId of a tenant-scoped queue, and inside a tenant transaction that tenant). Every job any e2e test
 * makes the application queue is therefore linted, whichever module queues it.
 */
export class LintingJobQueue extends FakeJobQueue {
  override async enqueue(
    name: string,
    payload: Record<string, unknown>,
    opts?: { tx?: unknown },
  ): Promise<string | null> {
    assertEnqueueable(name, payload, Boolean(opts?.tx));
    return super.enqueue(name, payload);
  }
}

/** Process-wide fakes (each vitest file has its own module registry, so tests do not share them). */
export const testPorts = {
  audit: new CapturingAuditWriter(),
  mail: new CapturingMailSender(),
  secretBox: new FakeSecretBox(),
  jobs: new LintingJobQueue(),
  outbox: new FakeOutbox(),
  storage: new FakeStorageAdapter(),
  scanner: new FakeVirusScanner(),
};

@Global()
@Module({
  providers: [
    { provide: AUDIT_WRITER, useValue: testPorts.audit },
    { provide: MAIL_SENDER, useValue: testPorts.mail },
    { provide: SECRET_BOX, useValue: testPorts.secretBox },
    { provide: JOB_QUEUE, useValue: testPorts.jobs },
    { provide: OUTBOX_PUBLISHER, useValue: testPorts.outbox },
    { provide: STORAGE_ADAPTER, useValue: testPorts.storage },
    { provide: VIRUS_SCANNER, useValue: testPorts.scanner },
  ],
  exports: [
    AUDIT_WRITER,
    MAIL_SENDER,
    SECRET_BOX,
    JOB_QUEUE,
    OUTBOX_PUBLISHER,
    STORAGE_ADAPTER,
    VIRUS_SCANNER,
  ],
})
export class TestPortsModule {}
