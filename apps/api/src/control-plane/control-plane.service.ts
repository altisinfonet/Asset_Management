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
      trx.tenant_directory.findUnique({ where: { tenant_id: tenantId }, select: REGISTRY_FIELDS }),
    );
    return row ? toEntry(row) : null;
  }

  async findBySlug(slug: string): Promise<TenantRegistryEntry | null> {
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx.tenant_directory.findUnique({ where: { slug }, select: REGISTRY_FIELDS }),
    );
    return row ? toEntry(row) : null;
  }

  /** Ids and status only: what the scheduler needs to fan out per-tenant jobs. */
  async listActiveTenants(): Promise<TenantRegistryEntry[]> {
    const rows = await this.tenancy.withPreTenantTx((trx) =>
      trx.tenant_directory.findMany({
        where: { status: 'active' },
        select: REGISTRY_FIELDS,
        orderBy: { created_at: 'asc' },
      }),
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
      const dir = await trx.tenant_directory.updateMany({
        where: { tenant_id: tenantId },
        data: { status },
      });
      if (dir.count === 0) throw new Error(`unknown tenant ${tenantId}`);
      await trx.tenant.update({ where: { id: tenantId }, data: { status } });
    });
  }

  entitlementsFor(tenantId: string): Promise<Entitlements> {
    return this.entitlements.entitlementsFor(tenantId);
  }
}

const REGISTRY_FIELDS = { tenant_id: true, slug: true, status: true, cell: true } as const;

function toEntry(row: {
  tenant_id: string;
  slug: string;
  status: string;
  cell: string;
}): TenantRegistryEntry {
  // The CHECK constraint on identity.tenant_directory.status guarantees the union.
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    status: row.status as TenantStatus,
    cell: row.cell,
  };
}
