import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { permits } from '../auth/index.js';
import { TenancyService, type Tx } from '../tenancy/index.js';
import { escapeLike } from './asset-queries.js';
import type { SearchType } from './schemas.js';

export interface SearchResult {
  type: SearchType;
  id: string;
  label: string;
  sublabel: string | null;
  href_hint: string;
}

/** Entity types M1 can search, with the permission each needs (`x-permission-by-type`). */
const M1_TYPES: Array<{ type: SearchType; permission: string }> = [
  { type: 'asset', permission: 'asset:read' },
  { type: 'model', permission: 'catalog:read' },
  { type: 'category', permission: 'catalog:read' },
];

/**
 * `GET /v1/search` (M1-REG-08): one box over assets, models and categories. Each type is searched
 * only when the caller holds its permission (a type the caller may not read is left out, never a
 * 403). Archived records are excluded; tenant scoping is RLS.
 *
 * Assets, in two steps: (1) EXACT tag or serial through the btree on the stored lower-case key
 * columns (leakproof equality, so the index is usable through RLS: O(log n)) ranks first;
 * (2) when the page is not full, a substring scan of `search_text` (tag, serial and name) fills it,
 * prefix matches before inner matches. Step 2 is a tenant-bounded scan: `ILIKE`, `@@` and jsonb
 * `@>` are not leakproof, so no trigram / full-text / GIN index can serve them under RLS (ADR 0005).
 */
@Injectable()
export class SearchService {
  constructor(private readonly tenancy: TenancyService) {}

  async search(
    auth: AuthContext,
    query: { q: string; types?: string[]; limit: number },
  ): Promise<{ data: SearchResult[] }> {
    const wanted = new Set(query.types ?? M1_TYPES.map((t) => t.type));
    const types = M1_TYPES.filter(
      (t) => wanted.has(t.type) && permits(auth.permissions, t.permission),
    ).map((t) => t.type);
    if (types.length === 0) return { data: [] };

    const q = query.q;
    const contains = `%${escapeLike(q)}%`;
    const prefix = `${escapeLike(q)}%`;
    return this.tenancy.withTenantTx(
      { tenantId: auth.tenantId, actorId: auth.principalId },
      async (trx) => {
        // The three searches are independent statements of one transaction: run in sequence
        // (a Prisma interactive transaction is a single connection).
        const out: SearchResult[] = [];
        if (types.includes('asset'))
          out.push(...(await this.assets(trx, q, contains, prefix, query.limit)));
        if (types.includes('model'))
          out.push(...(await this.models(trx, q, contains, prefix, query.limit)));
        if (types.includes('category'))
          out.push(...(await this.categories(trx, q, contains, prefix, query.limit)));
        return { data: out };
      },
    );
  }

  private async assets(trx: Tx, q: string, _contains: string, _prefix: string, limit: number) {
    type Row = { id: string; asset_tag: string; name: string | null; serial: string | null };
    const exact = await trx.$queryRaw<Row[]>`
      select a.id, a.asset_tag, a.name, a.serial
        from app.asset a
       where a.archived_at is null and (a.asset_tag_key = lower(${q}) or a.serial_key = lower(${q}))
       order by a.asset_tag_key
       limit ${limit}`;
    let rows = exact;
    if (exact.length < limit) {
      const seen = exact.map((r) => r.id);
      const rest = await trx.$queryRaw<Row[]>`
        select a.id, a.asset_tag, a.name, a.serial
          from app.asset a
         where a.archived_at is null
           and strpos(a.search_text, lower(${q})) > 0
           and a.id <> all (${seen}::uuid[])
         order by case when starts_with(a.search_text, lower(${q}))
                         or strpos(a.search_text, chr(31) || lower(${q})) > 0 then 0 else 1 end,
                  a.asset_tag_key
         limit ${limit - exact.length}`;
      rows = [...exact, ...rest];
    }
    return rows.map(
      (r): SearchResult => ({
        type: 'asset',
        id: r.id,
        label: r.asset_tag,
        sublabel: r.name ?? r.serial,
        href_hint: `/assets/view?id=${r.id}`,
      }),
    );
  }

  private async models(trx: Tx, q: string, contains: string, prefix: string, limit: number) {
    const rows = await trx.$queryRaw<
      Array<{ id: string; name: string; model_number: string | null; manufacturer: string | null }>
    >`
      select m.id, m.name, m.model_number, f.name as manufacturer
        from app.asset_model m
        left join app.manufacturer f on f.tenant_id = m.tenant_id and f.id = m.manufacturer_id
       where m.archived_at is null
         and (m.name ilike ${contains} or m.model_number ilike ${contains} or f.name ilike ${contains})
       order by case when lower(m.name) = lower(${q}) or lower(m.model_number) = lower(${q}) then 0
                     when m.name ilike ${prefix} then 1 else 2 end,
                lower(m.name)
       limit ${limit}`;
    return rows.map((r): SearchResult => ({
      type: 'model',
      id: r.id,
      label: r.name,
      sublabel: [r.manufacturer, r.model_number].filter(Boolean).join(' ') || null,
      href_hint: `/models/view?id=${r.id}`,
    }));
  }

  private async categories(trx: Tx, q: string, contains: string, prefix: string, limit: number) {
    const rows = await trx.$queryRaw<Array<{ id: string; name: string; kind: string }>>`
      select c.id, c.name, c.kind
        from app.category c
       where c.archived_at is null and c.name ilike ${contains}
       order by case when lower(c.name) = lower(${q}) then 0 when c.name ilike ${prefix} then 1 else 2 end,
                lower(c.name)
       limit ${limit}`;
    return rows.map((r): SearchResult => ({
      type: 'category',
      id: r.id,
      label: r.name,
      sublabel: r.kind,
      href_hint: `/categories/view?id=${r.id}`,
    }));
  }
}
