import { Body, Controller, Get, Inject, Injectable, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { diffRecords } from '../audit/index.js';
import { CurrentAuth, RequirePermission, type AuthContext } from '../auth/index.js';
import {
  type IfMatch,
  RequiredIfMatch,
  ZodValidationPipe,
  assertIfMatch,
  etagFor,
  problem,
  setEtag,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { Prisma, TenancyService, type Tx } from '../tenancy/index.js';

/**
 * Organisation-wide custody settings (M2-LIFE-09, ED-21): stored in `app.tenant.settings.custody`
 * next to the other settings and versioned with the tenant row (`ETag` / `If-Match`, audit and outbox
 * like `/v1/settings/files`).
 *
 *  - `default_expected_return_days`: what the web app pre-fills into the expected return of the
 *    check-out and transfer dialogs (today + N days). The API itself NEVER applies it: a check-out
 *    without `expected_return` stays open-ended (M2-LIFE-09 acceptance criteria).
 *  - `loan_reminder_days`: lead time of the "loan due soon" reminder of loaner loans (M2-LOAN-01/03).
 */
export const custodySettingsSchema = z.strictObject({
  default_expected_return_days: z.number().int().min(1).max(366).nullable().optional(),
  loan_reminder_days: z.number().int().min(0).max(30).optional(),
});
export type CustodySettingsInput = z.output<typeof custodySettingsSchema>;

export interface CustodySettings {
  default_expected_return_days: number | null;
  loan_reminder_days: number;
}

export const DEFAULT_CUSTODY_SETTINGS: CustodySettings = {
  default_expected_return_days: null,
  loan_reminder_days: 2,
};

/** Reads `app.tenant.settings.custody` defensively (it is a free-form jsonb object). */
export function parseCustodySettings(raw: unknown): CustodySettings {
  const parsed = custodySettingsSchema.safeParse(raw && typeof raw === 'object' ? raw : {});
  if (!parsed.success) return DEFAULT_CUSTODY_SETTINGS;
  return {
    default_expected_return_days:
      parsed.data.default_expected_return_days ??
      DEFAULT_CUSTODY_SETTINGS.default_expected_return_days,
    loan_reminder_days:
      parsed.data.loan_reminder_days ?? DEFAULT_CUSTODY_SETTINGS.loan_reminder_days,
  };
}

@Injectable()
export class CustodySettingsService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
  ) {}

  /** The settings of the tenant of the open transaction (jobs and services read them this way). */
  async read(trx: Tx): Promise<CustodySettings> {
    const tenant = await trx.tenant.findFirstOrThrow({ select: { settings: true } });
    return parseCustodySettings((tenant.settings as Record<string, unknown> | null)?.custody);
  }

  async get(auth: AuthContext): Promise<{ data: CustodySettings; version: number }> {
    return this.tx(auth, async (trx) => {
      const tenant = await trx.tenant.findFirstOrThrow({
        select: { settings: true, version: true },
      });
      return {
        data: parseCustodySettings((tenant.settings as Record<string, unknown> | null)?.custody),
        version: tenant.version,
      };
    });
  }

  async put(
    auth: AuthContext,
    ifMatch: IfMatch,
    input: CustodySettingsInput,
  ): Promise<{ data: CustodySettings; version: number }> {
    return this.tx(auth, async (trx) => {
      const tenant = await trx.tenant.findFirstOrThrow({
        select: { id: true, version: true, settings: true },
      });
      assertIfMatch(ifMatch, tenant.version);
      const settings = (tenant.settings as Record<string, unknown> | null) ?? {};
      const before = parseCustodySettings(settings.custody);
      const next = parseCustodySettings(input);
      const updated = await trx.tenant.updateMany({
        where: { id: tenant.id, version: tenant.version },
        data: {
          settings: { ...settings, custody: { ...next } } as Prisma.InputJsonObject,
        },
      });
      if (updated.count === 0) {
        const now = await trx.tenant.findFirst({ select: { version: true } });
        throw problem.preconditionFailed(
          `The settings have changed (current ETag ${etagFor(now?.version ?? 0)}). Re-read them and retry.`,
        );
      }
      const after = await trx.tenant.findFirstOrThrow({ select: { version: true } });
      const diff = diffRecords({ ...before }, { ...next });
      await this.audit.write(trx, {
        action: 'tenant_settings.custody_updated',
        entityType: 'tenant_settings',
        entityId: tenant.id,
        before: diff.before,
        after: diff.after,
      });
      await this.outbox.publish(trx, {
        type: 'tenant_settings.custody_updated',
        aggregateType: 'tenant_settings',
        aggregateId: tenant.id,
        payload: { version: after.version },
      });
      return { data: next, version: after.version };
    });
  }

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }
}

/** `/v1/settings/custody` (tag Custody). */
@Controller('settings/custody')
export class CustodySettingsController {
  constructor(private readonly settings: CustodySettingsService) {}

  @Get()
  @RequirePermission('catalog:read')
  async get(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) reply: FastifyReply) {
    const { data, version } = await this.settings.get(auth);
    setEtag(reply, version);
    return data;
  }

  @Put()
  @RequirePermission('catalog:manage')
  async put(
    @CurrentAuth() auth: AuthContext,
    @RequiredIfMatch() ifMatch: IfMatch,
    @Body(new ZodValidationPipe(custodySettingsSchema)) body: CustodySettingsInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { data, version } = await this.settings.put(auth, ifMatch, body);
    setEtag(reply, version);
    return data;
  }
}
