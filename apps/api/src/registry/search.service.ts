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
const SEARCH_TYPES_AVAILABLE: Array<{ type: SearchType; permission: string }> = [
  { type: 'asset', permission: 'asset:read' },
  { type: 'model', permission: 'catalog:read' },
  { type: 'category', permission: 'catalog:read' },
  { type: 'person', permission: 'person:read' },
  { type: 'location', permission: 'location:read' },
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
    const wanted = new Set(query.types ?? SEARCH_TYPES_AVAILABLE.map((t) => t.type));
    const types = SEARCH_TYPES_AVAILABLE.filter(
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
        if (types.includes('person')) out.push(...(await this.people(trx, q, query.limit)));
        if (types.includes('location'))
          out.push(...(await this.locations(trx, q, contains, prefix, query.limit)));
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
    return rows.map((r): SearchResult => ({
      type: 'asset',
      id: r.id,
      label: r.asset_tag,
      sublabel: r.name ?? r.serial,
      href_hint: `/assets/view?id=${r.id}`,
    }));
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

  /**
   * People (M2-USR-01): an exact email (stored lower-case key, btree through RLS) ranks first, then
   * a substring match over the stored lower-case `search_text` (name, email, employee number).
   */
  private async people(trx: Tx, q: string, limit: number) {
    type Row = {
      id: string;
      display_name: string;
      email: string | null;
      employee_ref: string | null;
      department: string | null;
    };
    const rows = await trx.$queryRaw<Row[]>`
      select p.id, p.display_name, p.email, p.employee_ref, d.name as department
        from app.person p
        left join app.department d on d.tenant_id = p.tenant_id and d.id = p.department_id
       where p.archived_at is null and strpos(p.search_text, lower(${q})) > 0
       order by case when p.email_key = lower(${q}) or lower(p.employee_ref) = lower(${q}) then 0
                     when starts_with(p.search_text, lower(${q})) then 1 else 2 end,
                lower(p.display_name)
       limit ${limit}`;
    return rows.map((r): SearchResult => ({
      type: 'person',
      id: r.id,
      label: r.display_name,
      sublabel: r.email ?? r.employee_ref ?? r.department,
      href_hint: `/people/view?id=${r.id}`,
    }));
  }

  private async locations(trx: Tx, q: string, contains: string, prefix: string, limit: number) {
    const rows = await trx.$queryRaw<
      Array<{ id: string; name: string; code: string | null; kind: string }>
    >`
      select l.id, l.name, l.code, l.kind
        from app.location l
       where l.archived_at is null and (l.name ilike ${contains} or l.code ilike ${contains})
       order by case when lower(l.name) = lower(${q}) or lower(l.code) = lower(${q}) then 0
                     when l.name ilike ${prefix} then 1 else 2 end,
                lower(l.name)
       limit ${limit}`;
    return rows.map((r): SearchResult => ({
      type: 'location',
      id: r.id,
      label: r.name,
      sublabel: [r.kind, r.code].filter(Boolean).join(' '),
      href_hint: `/locations/view?id=${r.id}`,
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
