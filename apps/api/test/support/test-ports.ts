import { Global, Module } from '@nestjs/common';
import {
  AUDIT_WRITER,
  type AuditEntry,
  type AuditWriter,
  JOB_QUEUE,
  MAIL_SENDER,
  OUTBOX_PUBLISHER,
  SECRET_BOX,
} from '../../src/ports/index.js';
import { FakeJobQueue, FakeMailSender, FakeOutbox, FakeSecretBox } from '../../src/ports/fakes.js';
import { currentTenantContext, currentTenantTx, type Tx } from '../../src/tenancy/index.js';

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

/** Process-wide fakes (each vitest file has its own module registry, so tests do not share them). */
export const testPorts = {
  audit: new CapturingAuditWriter(),
  mail: new FakeMailSender(),
  secretBox: new FakeSecretBox(),
  jobs: new FakeJobQueue(),
  outbox: new FakeOutbox(),
};

@Global()
@Module({
  providers: [
    { provide: AUDIT_WRITER, useValue: testPorts.audit },
    { provide: MAIL_SENDER, useValue: testPorts.mail },
    { provide: SECRET_BOX, useValue: testPorts.secretBox },
    { provide: JOB_QUEUE, useValue: testPorts.jobs },
    { provide: OUTBOX_PUBLISHER, useValue: testPorts.outbox },
  ],
  exports: [AUDIT_WRITER, MAIL_SENDER, SECRET_BOX, JOB_QUEUE, OUTBOX_PUBLISHER],
})
export class TestPortsModule {}
