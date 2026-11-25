import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type AuthContext, permits } from '../auth/index.js';
import { ScanResolverRegistry, type ScanResolution, type ScanResolver } from '../registry/index.js';
import { locationScopeWhere, type Tx } from '../tenancy/index.js';
import { accessoryDto, consumableDto, outstandingByAccessory } from './dto.js';

/**
 * `GET /v1/scan/resolve` for the labels of accessories and consumables (M2-ACC-01/02, ADR 0006
 * section 7, ADR 0008): their `label_code` is the same 128-bit opaque QR payload as an asset's, and
 * the registry asks this resolver after the asset lookups missed. A caller without `accessory:read`
 * / `consumable:read` gets the same "nothing found" as for an unknown code.
 */
@Injectable()
export class StockScanResolver implements ScanResolver, OnModuleInit {
  constructor(private readonly registry: ScanResolverRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async resolve(
    auth: AuthContext,
    trx: Tx,
    codes: readonly string[],
  ): Promise<ScanResolution | null> {
    for (const code of codes) {
      if (permits(auth.permissions, 'accessory:read')) {
        // M2-LOC-03 (ED-26): a label outside the caller's scope resolves to nothing
        const row = await trx.accessory.findFirst({
          where: { label_code: code, ...(await locationScopeWhere(trx, 'location_id')) },
        });
        if (row) {
          const out = (await outstandingByAccessory(trx, [row.id])).get(row.id) ?? 0;
          const dto = accessoryDto(row, out);
          const live = row.archived_at === null;
          const allowed: string[] = [];
          if (live && dto.qty_available > 0 && permits(auth.permissions, 'accessory:checkout')) {
            allowed.push('checkout');
          }
          if (out > 0 && permits(auth.permissions, 'accessory:checkout')) allowed.push('checkin');
          if (live && permits(auth.permissions, 'accessory:manage')) allowed.push('update');
          return {
            data: {
              match_type: 'label_code',
              entity_type: 'accessory',
              accessory: dto,
              allowed_actions: allowed,
            },
            version: row.version,
          };
        }
      }
      if (permits(auth.permissions, 'consumable:read')) {
        // M2-LOC-03 (ED-26): a label outside the caller's scope resolves to nothing
        const row = await trx.consumable.findFirst({
          where: { label_code: code, ...(await locationScopeWhere(trx, 'location_id')) },
        });
        if (row) {
          const live = row.archived_at === null;
          const adjust = live && permits(auth.permissions, 'consumable:adjust');
          const allowed: string[] = [];
          if (adjust && row.qty_on_hand > 0) allowed.push('issue');
          if (adjust) allowed.push('receive', 'adjust');
          if (live && permits(auth.permissions, 'consumable:manage')) allowed.push('update');
          return {
            data: {
              match_type: 'label_code',
              entity_type: 'consumable',
              consumable: consumableDto(row),
              allowed_actions: allowed,
            },
            version: row.version,
          };
        }
      }
    }
    return null;
  }
}
