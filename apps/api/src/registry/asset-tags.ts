import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { ApiProblem, type IfMatch, assertIfMatch } from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { TenancyService, type Prisma, type Tx } from '../tenancy/index.js';
import { RegistryBase, stalePrecondition } from './registry-base.js';
import { type AssetTagTemplate, assetTagTemplateSchema } from './schemas.js';

export const DEFAULT_TEMPLATE: AssetTagTemplate = {
  prefix: '',
  width: 5,
  use_category_prefix: true,
};

/** `prefix` + (category prefix) + zero-padded counter. */
export function formatAssetTag(
  template: AssetTagTemplate,
  categoryPrefix: string | null,
  n: number,
): string {
  return `${tagPrefixFor(template, categoryPrefix)}${String(n).padStart(template.width, '0')}`;
}

export const tagPrefixFor = (template: AssetTagTemplate, categoryPrefix: string | null): string =>
  template.prefix + (template.use_category_prefix ? (categoryPrefix ?? '') : '');

/** Gives up after this many generated tags collided with manually entered ones. */
const MAX_COLLISIONS = 500;

/**
 * Asset tag numbering (M1-REG-06). The template (prefix, counter width, whether the category prefix
 * is added) lives in `app.tenant.settings.asset_tag_template`. The counter is one row per
 * (tenant, prefix) in `app.asset_tag_counter`, bumped with `INSERT .. ON CONFLICT DO UPDATE`, which
 * takes a row lock held until the transaction ends: concurrent creates serialise on the counter
 * and each get a distinct number (no global sequence, no cross-tenant contention). Rolled-back
 * transactions roll the counter back with them, so a tag that was never stored is never skipped
 * past; a stored tag is never issued again (the tag index also covers archived assets, ED-12). A
 * manually entered tag overrides the template; a generated tag that collides with one is skipped.
 */
@Injectable()
export class AssetTagService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  async templateOf(trx: Tx): Promise<AssetTagTemplate> {
    const tenant = await trx.tenant.findFirst({ select: { settings: true } });
    const raw = (tenant?.settings as Record<string, unknown> | null)?.asset_tag_template;
    const parsed = assetTagTemplateSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : DEFAULT_TEMPLATE;
  }

  /** The template per transaction (a bulk import numbers thousands of assets in one transaction). */
  private readonly templates = new WeakMap<Tx, Promise<AssetTagTemplate>>();

  /** The next free tag for an asset of a category with `categoryPrefix`. */
  async allocate(trx: Tx, categoryPrefix: string | null): Promise<string> {
    let pending = this.templates.get(trx);
    if (!pending) {
      pending = this.templateOf(trx);
      this.templates.set(trx, pending);
    }
    const template = await pending;
    const prefix = tagPrefixFor(template, categoryPrefix);
    for (let attempt = 0; attempt < MAX_COLLISIONS; attempt++) {
      const [row] = await trx.$queryRaw<Array<{ last_value: bigint }>>`
        insert into app.asset_tag_counter as c (tenant_id, prefix, last_value)
        values (nullif(current_setting('app.tenant_id', true), '')::uuid, ${prefix}, 1)
        on conflict (tenant_id, prefix) do update set last_value = c.last_value + 1
        returning c.last_value`;
      const tag = formatAssetTag(template, categoryPrefix, Number(row!.last_value));
      if (!(await tagExists(trx, tag))) return tag;
    }
    throw new ApiProblem({
      code: 'conflict',
      detail: `Could not generate a free asset tag with the prefix "${prefix}": ${MAX_COLLISIONS} consecutive numbers are taken. Enter a tag manually or change the numbering template.`,
    });
  }

  // --------------------------------------------------------------------------------- HTTP

  async get(auth: AuthContext): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const tenant = await trx.tenant.findFirstOrThrow({ select: { version: true } });
      return { data: await this.view(trx), version: tenant.version };
    });
  }

  private async view(trx: Tx) {
    const template = await this.templateOf(trx);
    return {
      ...template,
      example: formatAssetTag(template, template.use_category_prefix ? 'LAP-' : null, 42),
    };
  }

  async put(
    auth: AuthContext,
    ifMatch: IfMatch,
    template: AssetTagTemplate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const tenant = await trx.tenant.findFirstOrThrow({
        select: { id: true, version: true, settings: true },
      });
      assertIfMatch(ifMatch, tenant.version);
      const before = await this.templateOf(trx);
      const settings = {
        ...((tenant.settings as Record<string, unknown> | null) ?? {}),
        asset_tag_template: template,
      };
      this.templates.delete(trx);
      const result = await trx.tenant.updateMany({
        where: { id: tenant.id, version: tenant.version },
        data: { settings: settings as Prisma.InputJsonObject },
      });
      if (result.count === 0) {
        return stalePrecondition(
          () => trx.tenant.findFirst({ select: { version: true } }),
          'Tenant settings',
        );
      }
      const after = await trx.tenant.findFirstOrThrow({ select: { version: true } });
      await this.record(trx, {
        entity: 'tenant_settings',
        verb: 'asset_tag_template_updated',
        id: tenant.id,
        version: after.version,
        before: { ...before },
        after: { ...template },
      });
      return { data: await this.view(trx), version: after.version };
    });
  }
}

export async function tagExists(trx: Tx, tag: string): Promise<boolean> {
  const rows = await trx.$queryRaw<Array<{ one: number }>>`
    select 1 as one from app.asset where asset_tag_key = lower(${tag}) limit 1`;
  return rows.length > 0;
}
