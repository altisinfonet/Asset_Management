import type { Tx } from '../tenancy/index.js';
import type { FieldDef } from './custom-fields.js';
import { normaliseOptions } from './dto.js';
import type { FieldType } from './schemas.js';

/**
 * Reference data an asset write validates against (category, model, status label, vendor, company,
 * custom field definitions), memoised for the lifetime of one transaction: a bulk edit or a clone of
 * 100 assets reads each referenced row once. The cache is keyed by the transaction client, so it
 * can never outlive the tenant context it was filled under.
 */
export class AssetRefs {
  private readonly cache = new Map<string, Promise<unknown>>();

  private constructor(private readonly trx: Tx) {}

  private static readonly byTx = new WeakMap<Tx, AssetRefs>();
  static for(trx: Tx): AssetRefs {
    let refs = AssetRefs.byTx.get(trx);
    if (!refs) {
      refs = new AssetRefs(trx);
      AssetRefs.byTx.set(trx, refs);
    }
    return refs;
  }

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let hit = this.cache.get(key) as Promise<T> | undefined;
    if (!hit) {
      hit = load();
      this.cache.set(key, hit);
    }
    return hit;
  }

  category(id: string) {
    return this.memo(`category:${id}`, () => this.trx.category.findUnique({ where: { id } }));
  }
  model(id: string) {
    return this.memo(`model:${id}`, () => this.trx.asset_model.findUnique({ where: { id } }));
  }
  status(id: string) {
    return this.memo(`status:${id}`, () => this.trx.status_label.findUnique({ where: { id } }));
  }
  defaultStatus() {
    return this.memo('status:default', () =>
      this.trx.status_label.findFirst({ where: { is_default: true, archived_at: null } }),
    );
  }
  vendor(id: string) {
    return this.memo(`vendor:${id}`, () => this.trx.vendor.findUnique({ where: { id } }));
  }
  company(id: string) {
    return this.memo(`company:${id}`, () => this.trx.company.findUnique({ where: { id } }));
  }
  defaultCompany() {
    return this.memo('company:default', () =>
      this.trx.company.findFirst({ where: { is_default: true } }),
    );
  }
  location(id: string) {
    return this.memo(`location:${id}`, () => this.trx.location.findUnique({ where: { id } }));
  }
  asset(id: string) {
    return this.memo(`asset:${id}`, () =>
      this.trx.asset.findUnique({ where: { id }, select: { id: true, parent_asset_id: true } }),
    );
  }

  /** Active definitions that apply to assets of `categoryId` (its own plus the global ones). */
  defs(categoryId: string): Promise<FieldDef[]> {
    return this.memo(`defs:${categoryId}`, async () => {
      const rows = await this.trx.custom_field_def.findMany({
        where: { archived_at: null, OR: [{ category_id: null }, { category_id: categoryId }] },
        orderBy: [{ position: 'asc' }, { key: 'asc' }],
      });
      return rows.map(toFieldDef);
    });
  }

  /** Keys of every active definition in the tenant (category change: which stored keys are "someone's field"). */
  activeKeys(): Promise<Set<string>> {
    return this.memo('keys', async () => {
      const rows = await this.trx.custom_field_def.findMany({
        where: { archived_at: null },
        select: { key: true },
      });
      return new Set(rows.map((r) => r.key));
    });
  }
}

export function toFieldDef(r: {
  key: string;
  label: string;
  data_type: string;
  required: boolean;
  options: unknown;
  validation: unknown;
}): FieldDef {
  return {
    key: r.key,
    label: r.label,
    dataType: r.data_type as FieldType,
    required: r.required,
    options: normaliseOptions(r.options),
    validation: (r.validation as Record<string, unknown> | null) ?? null,
  };
}
