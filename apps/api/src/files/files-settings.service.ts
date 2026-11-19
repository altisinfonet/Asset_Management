import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { diffRecords } from '../audit/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { type IfMatch, assertIfMatch, etagFor, problem } from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { Prisma, TenancyService, type Tx } from '../tenancy/index.js';
import {
  type FilesSettings,
  type FilesSettingsInput,
  parseFilesSettings,
  toFilesSettings,
} from './settings.js';

/**
 * Per-tenant file settings (M2-FILE-01 caps, M2-FILE-03 EXIF), stored in
 * `app.tenant.settings.files` next to the asset-tag template and versioned with the tenant row
 * (`ETag` / `If-Match` like `/v1/settings/asset-tag-template`).
 */
@Injectable()
export class FilesSettingsService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }

  async get(auth: AuthContext): Promise<{ data: FilesSettings; version: number }> {
    return this.tx(auth, async (trx) => {
      const tenant = await trx.tenant.findFirstOrThrow({
        select: { plan: true, settings: true, version: true },
      });
      return {
        data: toFilesSettings(
          tenant.plan,
          parseFilesSettings((tenant.settings as Record<string, unknown> | null)?.files),
          this.config.FILES_MAX_BYTES_CEILING,
        ),
        version: tenant.version,
      };
    });
  }

  async put(
    auth: AuthContext,
    ifMatch: IfMatch,
    input: FilesSettingsInput,
  ): Promise<{ data: FilesSettings; version: number }> {
    return this.tx(auth, async (trx) => {
      const tenant = await trx.tenant.findFirstOrThrow({
        select: { id: true, plan: true, version: true, settings: true },
      });
      assertIfMatch(ifMatch, tenant.version);
      const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
      const before = parseFilesSettings(settings.files);
      const updated = await trx.tenant.updateMany({
        where: { id: tenant.id, version: tenant.version },
        data: { settings: { ...settings, files: input } as Prisma.InputJsonObject },
      });
      if (updated.count === 0) {
        const now = await trx.tenant.findFirst({ select: { version: true } });
        throw problem.preconditionFailed(
          `The settings have changed (current ETag ${etagFor(now?.version ?? 0)}). Re-read them and retry.`,
        );
      }
      const after = await trx.tenant.findFirstOrThrow({ select: { version: true } });
      const diff = diffRecords({ ...before }, { ...input });
      await this.audit.write(trx, {
        action: 'tenant_settings.files_updated',
        entityType: 'tenant_settings',
        entityId: tenant.id,
        before: diff.before,
        after: diff.after,
      });
      await this.outbox.publish(trx, {
        type: 'tenant_settings.files_updated',
        aggregateType: 'tenant_settings',
        aggregateId: tenant.id,
        payload: { version: after.version },
      });
      return {
        data: toFilesSettings(tenant.plan, input, this.config.FILES_MAX_BYTES_CEILING),
        version: after.version,
      };
    });
  }
}
