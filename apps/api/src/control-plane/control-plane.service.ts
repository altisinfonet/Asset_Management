import { Inject, Injectable } from '@nestjs/common';
import { TenancyService } from '../tenancy/index.js';
import { ENTITLEMENT_SOURCE, type EntitlementSource, type Entitlements } from './entitlements.js';

export type TenantStatus = 'active' | 'suspended' | 'pending_deletion';

/** Cloud: one cell. Self-hosted resolves to the constant `local` (plan 7.3). */
export const DEFAULT_CELL = 'us-1';

export interface TenantRegistryEntry {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  cell: string;
}

export class TenantInactiveError extends Error {
  constructor(
    readonly tenantId: string,
    readonly status: TenantStatus | 'unknown',
  ) {
    super(`tenant ${tenantId} is not active (${status})`);
    this.name = 'TenantInactiveError';
  }
}

/**
 * Control plane (minimal, M1-TEN-07): the tenant registry and entitlements. The registry lives in
 * `identity.tenant_directory` (non-tenant table, no RLS: it is read before any tenant is known) and
 * is reached through {@link TenancyService.withPreTenantTx}, never through a tenant transaction.
 */
@Injectable()
export class ControlPlaneService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(ENTITLEMENT_SOURCE) private readonly entitlements: EntitlementSource,
  ) {}

  /** Registry entry of a tenant, or null when it does not exist. */
  async resolveTenant(tenantId: string): Promise<TenantRegistryEntry | null> {
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.tenant_directory')
        .select(['tenant_id', 'slug', 'status', 'cell'])
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst(),
    );
    return row ? toEntry(row) : null;
  }

  async findBySlug(slug: string): Promise<TenantRegistryEntry | null> {
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.tenant_directory')
        .select(['tenant_id', 'slug', 'status', 'cell'])
        .where('slug', '=', slug)
        .executeTakeFirst(),
    );
    return row ? toEntry(row) : null;
  }

  /** Ids and status only: what the scheduler needs to fan out per-tenant jobs. */
  async listActiveTenants(): Promise<TenantRegistryEntry[]> {
    const rows = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.tenant_directory')
        .select(['tenant_id', 'slug', 'status', 'cell'])
        .where('status', '=', 'active')
        .orderBy('created_at')
        .execute(),
    );
    return rows.map(toEntry);
  }

  /** Requests and jobs for a non-active (or unknown) tenant are rejected here. */
  async assertTenantActive(tenantId: string): Promise<TenantRegistryEntry> {
    const entry = await this.resolveTenant(tenantId);
    if (!entry) throw new TenantInactiveError(tenantId, 'unknown');
    if (entry.status !== 'active') throw new TenantInactiveError(tenantId, entry.status);
    return entry;
  }

  /** Changes the status in the registry and on the tenant row, atomically. */
  async setTenantStatus(tenantId: string, status: TenantStatus): Promise<void> {
    await this.tenancy.withTenantTx({ tenantId }, async (trx) => {
      const dir = await trx
        .updateTable('identity.tenant_directory')
        .set({ status })
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (dir.numUpdatedRows === 0n) throw new Error(`unknown tenant ${tenantId}`);
      await trx.updateTable('app.tenant').set({ status }).where('id', '=', tenantId).execute();
    });
  }

  entitlementsFor(tenantId: string): Promise<Entitlements> {
    return this.entitlements.entitlementsFor(tenantId);
  }
}

function toEntry(row: {
  tenant_id: string;
  slug: string;
  status: TenantStatus;
  cell: string;
}): TenantRegistryEntry {
  return { tenantId: row.tenant_id, slug: row.slug, status: row.status, cell: row.cell };
}
