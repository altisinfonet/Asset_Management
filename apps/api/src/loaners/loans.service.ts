import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import {
  type CustodyResult,
  CustodyService,
  CustodySettingsService,
  todayUtc,
} from '../lifecycle/index.js';
import {
  ApiProblem,
  type FieldError,
  type Page,
  type SortTerm,
  bindingFor,
  decodeCursor,
  encodeCursor,
  parseSort,
  problem,
  runBulk,
  tsText,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import {
  RegistryBase,
  ScanResolveThrottle,
  findAssetByCode,
  inSavepoint,
  invalidRef,
  scanCandidates,
  type TxScope,
} from '../registry/index.js';
import { Prisma, TenancyService, type Tx } from '../tenancy/index.js';
import { type LoanRow, type PoolRow, addDays, isoDay, loanDto } from './dto.js';
import { PoolsService } from './pools.service.js';
import {
  OPEN_LOAN_STATES,
  type LoanExtendBody,
  type LoanListQuery,
  type LoanReturnBody,
  type LoanState,
  type LoanerCheckoutBody,
  type OverdueListQuery,
  type QuickLoanBody,
} from './schemas.js';

const TODAY = Prisma.sql`(now() at time zone 'UTC')::date`;

/** One loan (an assignment with a pool) as the loan lists read it. */
const LOAN_COLUMNS = Prisma.sql`
  s.id, s.asset_id, a.asset_tag, a.name as asset_name, s.loaner_pool_id, p.name as pool_name,
  s.person_id, pe.display_name as person_name, pe.email as person_email, pe.employee_ref as person_ref,
  s.checked_out_at, s.expected_return, s.checked_in_at, s.note,
  case when s.checked_in_at is not null then 'returned'
       when s.expected_return < ${TODAY} then 'overdue'
       when s.expected_return = ${TODAY} then 'due_today'
       else 'on_loan' end as state,
  case when s.checked_in_at is null and s.expected_return < ${TODAY}
       then ${TODAY} - s.expected_return else 0 end as days_overdue,
  to_char(s.expected_return, 'YYYY-MM-DD') as k_due,
  ${Prisma.raw(tsText('s.checked_out_at'))} as k_out`;
const LOAN_FROM = Prisma.sql`
  from app.assignment s
  join app.asset a on a.tenant_id = s.tenant_id and a.id = s.asset_id
  join app.loaner_pool p on p.tenant_id = s.tenant_id and p.id = s.loaner_pool_id
  left join app.person pe on pe.tenant_id = s.tenant_id and pe.id = s.person_id`;

type LoanSqlRow = LoanRow & { k_due: string; k_out: string };

const STATE_PREDICATE: Record<LoanState, Prisma.Sql> = {
  returned: Prisma.sql`s.checked_in_at is not null`,
  overdue: Prisma.sql`(s.checked_in_at is null and s.expected_return < ${TODAY})`,
  due_today: Prisma.sql`(s.checked_in_at is null and s.expected_return = ${TODAY})`,
  on_loan: Prisma.sql`(s.checked_in_at is null and s.expected_return > ${TODAY})`,
};

// ----------------------------------------------------------------------------- keyset paging

interface KeyColumn {
  expr: string;
  cast: string;
  shape: RegExp;
}
const KEYS: Record<string, KeyColumn> = {
  expected_return: { expr: 's.expected_return', cast: 'date', shape: /^\d{4}-\d{2}-\d{2}$/ },
  checked_out_at: {
    expr: 's.checked_out_at',
    cast: 'timestamptz',
    shape: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00$/,
  },
  id: {
    expr: 's.id',
    cast: 'uuid',
    shape: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  },
};

const badCursor = (): ApiProblem =>
  new ApiProblem({
    code: 'invalid-cursor',
    detail: 'The cursor is not valid for this list. Start again without a cursor.',
    errors: [{ pointer: 'query:cursor', message: 'invalid cursor', code: 'invalid_cursor' }],
  });

/** A cursor is not signed: a forged value PostgreSQL cannot cast must be a 400, not a 500. */
function assertCursorShape(terms: SortTerm[], values: Array<string | number | Date>): void {
  terms.forEach((term, i) => {
    const key = KEYS[term.key]!;
    const v = values[i];
    if (typeof v !== 'string' || !key.shape.test(v)) throw badCursor();
    if (key.cast !== 'uuid') {
      const iso = key.cast === 'date' ? `${v}T00:00:00Z` : v.replace(/\+00$/, 'Z');
      const d = new Date(iso);
      if (
        Number.isNaN(d.getTime()) ||
        d.getUTCFullYear() < 1 ||
        d.toISOString().slice(0, 10) !== v.slice(0, 10)
      ) {
        throw badCursor();
      }
    }
  });
}

/** Keyset condition "strictly after the cursor row" over the terms (mixed directions allowed). */
function keysetSql(terms: SortTerm[], values: Array<string | number | Date>): Prisma.Sql {
  const alternatives = terms.map((term, i) => {
    const parts: Prisma.Sql[] = [];
    for (let j = 0; j < i; j++) {
      const k = KEYS[terms[j]!.key]!;
      parts.push(Prisma.sql`${Prisma.raw(k.expr)} = ${String(values[j])}::${Prisma.raw(k.cast)}`);
    }
    const k = KEYS[term.key]!;
    const op = term.direction === 'asc' ? '>' : '<';
    parts.push(
      Prisma.sql`${Prisma.raw(k.expr)} ${Prisma.raw(op)} ${String(values[i])}::${Prisma.raw(k.cast)}`,
    );
    return Prisma.sql`(${Prisma.join(parts, ' and ')})`;
  });
  return Prisma.sql`(${Prisma.join(alternatives, ' or ')})`;
}

const orderSql = (terms: SortTerm[]): Prisma.Sql =>
  Prisma.raw(
    terms.map((t) => `${KEYS[t.key]!.expr} ${t.direction === 'desc' ? 'desc' : 'asc'}`).join(', '),
  );

const LOAN_SPEC = {
  sortable: {
    expected_return: { kind: 'string' as const, column: 'k_due' },
    checked_out_at: { kind: 'string' as const, column: 'k_out' },
  },
  defaultSort: 'expected_return',
};

/** `days_overdue` is `expected_return` read the other way round. */
const overdueSort = (sort: string | undefined): string | undefined =>
  sort
    ?.split(',')
    .map((part) => {
      const t = part.trim();
      if (t === 'days_overdue') return '-expected_return';
      if (t === '-days_overdue') return 'expected_return';
      return t;
    })
    .join(',');

const dayBefore = (): string => addDays(todayUtc(), -1);

interface PersonRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  email: string | null;
  employee_ref: string | null;
}

/** What a bulk item answers: the updated asset and the assignment (the version is the header's). */
const item = (res: CustodyResult) => ({ asset: res.asset, assignment: res.assignment });

export type ActivityKind = 'checked_out' | 'checked_in';

/**
 * Loans (M2-LOAN-01..04, ED-20, ED-21, ADR 0011): quick check-out and return by scanning, the loan
 * lists, extension, the overdue list and the dashboard. A loan is a normal custody period (the
 * `CustodyService` rules: one open assignment per asset, `If-Match`, history, audit, outbox) whose
 * assignment carries the pool. Everything here runs in the caller's tenant transaction and, for the
 * bulk flows, per item inside a savepoint, so one bad scan never takes the others down.
 */
@Injectable()
export class LoansService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    private readonly custody: CustodyService,
    private readonly settings: CustodySettingsService,
    private readonly pools: PoolsService,
    private readonly scanThrottle: ScanResolveThrottle,
  ) {
    super(tenancy, audit, outbox);
  }

  // ======================================================================== quick check-out

  /** `POST /v1/loaner-pools/{id}/checkout`: one loan, a given member or the next available one. */
  async checkoutOne(
    auth: AuthContext,
    poolId: string,
    body: LoanerCheckoutBody,
  ): Promise<CustodyResult> {
    return this.tx(auth, async (trx) => {
      const pool = await this.livePool(trx, poolId);
      const person = await this.borrowerById(trx, body.person_id, '/person_id');
      this.assertEligible(pool, person, '/person_id');
      const expected = this.dueDate(pool, body.expected_return);
      await this.lockPerson(trx, person.id);
      await this.assertUnderLimit(trx, pool, person.id, 0);

      let assetId = body.asset_id;
      if (assetId) {
        const member = await trx.loaner_pool_member.findFirst({ where: { asset_id: assetId } });
        if (!member || member.loaner_pool_id !== poolId) {
          throw problem.validation([
            {
              pointer: '/asset_id',
              message: 'is not a member of this loaner pool',
              code: 'not-in-pool',
            },
          ]);
        }
      } else {
        assetId = await this.nextAvailable(trx, poolId);
      }
      return this.custody.checkout(
        auth,
        assetId,
        { kind: 'absent' },
        {
          person_id: person.id,
          expected_return: expected,
          ...(body.note ? { note: body.note } : {}),
        },
        { poolId },
      );
    });
  }

  /** The member to lend next: the lowest asset tag that is lendable, rows locked `skip locked`. */
  private async nextAvailable(trx: Tx, poolId: string): Promise<string> {
    const [row] = await trx.$queryRaw<Array<{ id: string }>>`
      select a.id
        from app.loaner_pool_member m
        join app.asset a on a.tenant_id = m.tenant_id and a.id = m.asset_id
        join app.status_label sl on sl.tenant_id = a.tenant_id and sl.id = a.status_id
       where m.loaner_pool_id = ${poolId}::uuid and a.archived_at is null and sl.state_type = 'deployable'
         and not exists (select 1 from app.assignment s
                          where s.tenant_id = a.tenant_id and s.asset_id = a.id and s.checked_in_at is null)
       order by a.asset_tag_key, a.id
       limit 1
         for update of a skip locked`;
    if (!row) {
      throw new ApiProblem({
        code: 'no-loaner-available',
        detail: 'The pool has no device that can be lent right now.',
      });
    }
    return row.id;
  }

  /** `POST /v1/loaner-pools/{id}/quick-checkout`: one borrower, the scanned devices. */
  async quickCheckout(auth: AuthContext, poolId: string, body: QuickLoanBody) {
    await this.scanThrottle.assertAllowed(auth);
    return this.tx(auth, async (trx) => {
      const pool = await this.livePool(trx, poolId);
      const person = body.person_id
        ? await this.borrowerById(trx, body.person_id, '/person_id')
        : await this.borrowerByText(trx, body.borrower!);
      const pointer = body.person_id ? '/person_id' : '/borrower';
      this.assertEligible(pool, person, pointer);
      const expected = this.dueDate(pool, body.expected_return);
      await this.lockPerson(trx, person.id);
      const [open] = await trx.$queryRaw<Array<{ n: bigint }>>`
        select count(*) as n from app.assignment
         where person_id = ${person.id}::uuid and loaner_pool_id = ${poolId}::uuid and checked_in_at is null`;
      let held = Number(open!.n);

      const result = await runBulk(
        body.codes,
        (code, index) =>
          inSavepoint(trx, async () => {
            const hit = await findAssetByCode(trx, scanCandidates(code));
            if (!hit) {
              await this.scanThrottle.recordMiss(auth);
              throw problem.notFound('No asset matches this code.');
            }
            const member = await trx.loaner_pool_member.findFirst({
              where: { asset_id: hit.row.id },
            });
            if (!member || member.loaner_pool_id !== poolId) {
              throw problem.validation([
                {
                  pointer: `/codes/${index}`,
                  message: 'is not a member of this loaner pool',
                  code: 'not-in-pool',
                },
              ]);
            }
            this.assertBelowLimit(pool, held);
            const res = await this.custody.checkout(
              auth,
              hit.row.id,
              { kind: 'absent' },
              {
                person_id: person.id,
                expected_return: expected,
                ...(body.note ? { note: body.note } : {}),
              },
              { poolId },
            );
            held += 1;
            return item(res);
          }),
        { successStatus: 201, max: 50, pointer: '/codes' },
      );
      return {
        person: {
          id: person.id,
          display_name: person.display_name,
          kind: person.kind,
          email: person.email,
          employee_ref: person.employee_ref,
        },
        loaner_pool_id: poolId,
        expected_return: expected,
        results: result.results.map((r) => ({ ...r, code: body.codes[r.index]! })),
        summary: result.summary,
      };
    });
  }

  // ============================================================================ quick return

  /** `POST /v1/loans/return`: check the scanned devices in, answered per code. */
  async returnLoans(auth: AuthContext, body: LoanReturnBody) {
    await this.scanThrottle.assertAllowed(auth);
    return this.tx(auth, async (trx) => {
      const homes = new Map<string, string | null>();
      const result = await runBulk(
        body.codes,
        (code, index) =>
          inSavepoint(trx, async () => {
            const hit = await findAssetByCode(trx, scanCandidates(code));
            if (!hit) {
              await this.scanThrottle.recordMiss(auth);
              throw problem.notFound('No asset matches this code.');
            }
            const member = await trx.loaner_pool_member.findFirst({
              where: { asset_id: hit.row.id },
            });
            if (!member || (body.loaner_pool_id && member.loaner_pool_id !== body.loaner_pool_id)) {
              throw problem.validation([
                {
                  pointer: `/codes/${index}`,
                  message: body.loaner_pool_id
                    ? 'is not a member of that loaner pool'
                    : 'is not a member of a loaner pool',
                  code: 'not-in-pool',
                },
              ]);
            }
            if (!homes.has(member.loaner_pool_id)) {
              homes.set(member.loaner_pool_id, await this.liveHome(trx, member.loaner_pool_id));
            }
            const home = homes.get(member.loaner_pool_id) ?? null;
            // undefined = the pool's home location; an explicit null = do not move the device
            const location =
              body.checkin_location_id === undefined ? home : body.checkin_location_id;
            const res = await this.custody.checkin(
              auth,
              hit.row.id,
              { kind: 'absent' },
              {
                ...(location ? { checkin_location_id: location } : {}),
                ...(body.status_id ? { status_id: body.status_id } : {}),
                ...(body.condition ? { condition: body.condition } : {}),
                ...(body.note ? { note: body.note } : {}),
              },
            );
            return item(res);
          }),
        { successStatus: 200, max: 100, pointer: '/codes' },
      );
      return {
        results: result.results.map((r) => ({ ...r, code: body.codes[r.index]! })),
        summary: result.summary,
      };
    });
  }

  /** The pool's home location when it still exists and is live (a gone home never fails a return). */
  private async liveHome(trx: Tx, poolId: string): Promise<string | null> {
    const pool = await trx.loaner_pool.findUnique({
      where: { id: poolId },
      select: { home_location_id: true },
    });
    if (!pool?.home_location_id) return null;
    const location = await trx.location.findUnique({
      where: { id: pool.home_location_id },
      select: { archived_at: true },
    });
    return location && !location.archived_at ? pool.home_location_id : null;
  }

  // ================================================================================== extend

  async extend(auth: AuthContext, id: string, body: LoanExtendBody) {
    return this.tx(auth, async (trx) => {
      const [loan] = await trx.$queryRaw<
        Array<{ checked_out_at: Date; max_loan_days: number | null }>
      >`
        select s.checked_out_at, p.max_loan_days
          from app.assignment s
          join app.loaner_pool p on p.tenant_id = s.tenant_id and p.id = s.loaner_pool_id
         where s.id = ${id}::uuid and s.asset_id is not null`;
      if (!loan) throw problem.notFound('Loan not found.');
      const latest =
        loan.max_loan_days !== null
          ? addDays(loan.checked_out_at.toISOString().slice(0, 10), loan.max_loan_days)
          : null;
      await this.custody.extendLoan(auth, id, body.expected_return, {
        note: body.note,
        latest,
      });
      return loanDto((await this.loanById(trx, id))!);
    });
  }

  // =================================================================================== reads

  async get(auth: AuthContext, id: string) {
    return this.tx(auth, async (trx) => {
      const row = await this.loanById(trx, id);
      if (!row) throw problem.notFound('Loan not found.');
      return loanDto(row);
    });
  }

  private async loanById(trx: Tx, id: string): Promise<LoanRow | null> {
    const [row] = await trx.$queryRaw<LoanSqlRow[]>`
      select ${LOAN_COLUMNS} ${LOAN_FROM}
       where s.id = ${id}::uuid and s.loaner_pool_id is not null`;
    return row ?? null;
  }

  async list(auth: TxScope, query: LoanListQuery): Promise<Page<ReturnType<typeof loanDto>>> {
    return this.tx(auth, async (trx) => {
      const states = query.state ?? [...OPEN_LOAN_STATES];
      const terms = parseSort(query.sort, LOAN_SPEC);
      const filters = {
        q: query.q,
        pool: query.loaner_pool_id,
        person: query.person_id,
        asset: query.asset_id,
        state: [...states].sort(),
        due: query.due_within_days,
      };
      const where: Prisma.Sql[] = [Prisma.sql`s.loaner_pool_id is not null`];
      if (query.loaner_pool_id)
        where.push(Prisma.sql`s.loaner_pool_id = ${query.loaner_pool_id}::uuid`);
      if (query.person_id) where.push(Prisma.sql`s.person_id = ${query.person_id}::uuid`);
      if (query.asset_id) where.push(Prisma.sql`s.asset_id = ${query.asset_id}::uuid`);
      where.push(
        Prisma.sql`(${Prisma.join(
          states.map((st) => STATE_PREDICATE[st]),
          ' or ',
        )})`,
      );
      if (query.due_within_days !== undefined) {
        where.push(
          Prisma.sql`(s.checked_in_at is null and s.expected_return <= ${TODAY} + ${query.due_within_days}::int)`,
        );
      }
      if (query.q) {
        where.push(
          Prisma.sql`position(lower(${query.q}) in lower(concat_ws(' ', a.asset_tag, a.name, pe.display_name, pe.email, pe.employee_ref))) > 0`,
        );
      }
      const base = [...where];
      const binding = bindingFor(terms, filters);
      if (query.cursor) {
        const values = decodeCursor(query.cursor, terms, binding);
        assertCursorShape(terms, values);
        where.push(keysetSql(terms, values));
      }
      const rows = await trx.$queryRaw<LoanSqlRow[]>`
        select ${LOAN_COLUMNS} ${LOAN_FROM}
         where ${Prisma.join(where, ' and ')}
         order by ${orderSql(terms)}
         limit ${query.limit + 1}`;
      const hasMore = rows.length > query.limit;
      const data = hasMore ? rows.slice(0, query.limit) : rows;
      const last = data.at(-1);
      const page: Page<ReturnType<typeof loanDto>>['page'] = {
        next_cursor: hasMore && last ? encodeCursor(terms, binding, last as never) : null,
        has_more: hasMore,
      };
      if (query.include_total) {
        const [c] = await trx.$queryRaw<Array<{ n: bigint }>>`
          select count(*) as n ${LOAN_FROM} where ${Prisma.join(base, ' and ')}`;
        page.total = Number(c!.n);
      }
      return { data: data.map(loanDto), page };
    });
  }

  /** `GET /v1/loans/overdue`: every open asset check-out past its due date (loaner or not). */
  async overdue(auth: TxScope, query: OverdueListQuery) {
    return this.tx(auth, async (trx) => {
      const terms = parseSort(overdueSort(query.sort), LOAN_SPEC);
      const binding = bindingFor(terms, { pool: query.loaner_pool_id, person: query.person_id });
      const where: Prisma.Sql[] = [
        Prisma.sql`s.asset_id is not null`,
        Prisma.sql`s.checked_in_at is null`,
        Prisma.sql`s.expected_return < ${TODAY}`,
      ];
      if (query.loaner_pool_id)
        where.push(Prisma.sql`s.loaner_pool_id = ${query.loaner_pool_id}::uuid`);
      if (query.person_id) where.push(Prisma.sql`s.person_id = ${query.person_id}::uuid`);
      if (query.cursor) {
        const values = decodeCursor(query.cursor, terms, binding);
        assertCursorShape(terms, values);
        where.push(keysetSql(terms, values));
      }
      const rows = await trx.$queryRaw<
        Array<{
          id: string;
          asset_id: string;
          asset_tag: string;
          asset_name: string | null;
          person_id: string | null;
          location_id: string | null;
          target_asset_id: string | null;
          holder_name: string | null;
          loaner_pool_id: string | null;
          pool_name: string | null;
          expected_return: Date;
          days_overdue: number;
          k_due: string;
          k_out: string;
        }>
      >`
        select s.id, s.asset_id, a.asset_tag, a.name as asset_name, s.person_id, s.location_id,
               s.target_asset_id,
               coalesce(pe.display_name, lo.name, nullif(concat_ws(' ', ta.asset_tag, ta.name), '')) as holder_name,
               s.loaner_pool_id, p.name as pool_name, s.expected_return,
               (${TODAY} - s.expected_return) as days_overdue,
               to_char(s.expected_return, 'YYYY-MM-DD') as k_due,
               ${Prisma.raw(tsText('s.checked_out_at'))} as k_out
          from app.assignment s
          join app.asset a on a.tenant_id = s.tenant_id and a.id = s.asset_id
          left join app.loaner_pool p on p.tenant_id = s.tenant_id and p.id = s.loaner_pool_id
          left join app.person pe on pe.tenant_id = s.tenant_id and pe.id = s.person_id
          left join app.location lo on lo.tenant_id = s.tenant_id and lo.id = s.location_id
          left join app.asset ta on ta.tenant_id = s.tenant_id and ta.id = s.target_asset_id
         where ${Prisma.join(where, ' and ')}
         order by ${orderSql(terms)}
         limit ${query.limit + 1}`;
      const hasMore = rows.length > query.limit;
      const data = hasMore ? rows.slice(0, query.limit) : rows;
      const last = data.at(-1);
      return {
        data: data.map((r) => ({
          assignment_id: r.id,
          asset_id: r.asset_id,
          asset_tag: r.asset_tag,
          asset_name: r.asset_name,
          person_id: r.person_id,
          location_id: r.location_id,
          target_asset_id: r.target_asset_id,
          holder_name: r.holder_name,
          loaner_pool_id: r.loaner_pool_id,
          pool_name: r.pool_name,
          expected_return: isoDay(r.expected_return)!,
          days_overdue: Number(r.days_overdue),
        })),
        page: {
          next_cursor: hasMore && last ? encodeCursor(terms, binding, last as never) : null,
          has_more: hasMore,
        },
      };
    });
  }

  /** `GET /v1/loaners/dashboard`: per-pool counts, their totals and the latest activity. */
  async dashboard(auth: TxScope) {
    return this.tx(auth, async (trx) => {
      const [day] = await trx.$queryRaw<Array<{ today: string }>>`
        select to_char(${TODAY}, 'YYYY-MM-DD') as today`;
      const pools = await trx.loaner_pool.findMany({
        where: { archived_at: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 200,
      });
      const counts = await this.pools.counts(
        trx,
        pools.map((p) => p.id),
      );
      const rows = pools.map((p) => {
        const c = counts.get(p.id);
        return {
          id: p.id,
          name: p.name,
          is_active: p.is_active,
          member_count: c?.member_count ?? 0,
          available_count: c?.available_count ?? 0,
          checked_out_count: c?.checked_out_count ?? 0,
          overdue_count: c?.overdue_count ?? 0,
          due_today_count: c?.due_today_count ?? 0,
          due_soon_count: c?.due_soon_count ?? 0,
        };
      });
      const sum = (pick: (r: (typeof rows)[number]) => number) =>
        rows.reduce((total, r) => total + pick(r), 0);
      const recent = await trx.$queryRaw<
        Array<{
          at: Date;
          kind: ActivityKind;
          assignment_id: string;
          asset_id: string;
          asset_tag: string;
          asset_name: string | null;
          person_id: string | null;
          person_name: string | null;
          loaner_pool_id: string;
          pool_name: string;
          expected_return: Date;
        }>
      >`
        select * from (
          (select s.checked_out_at as at, 'checked_out'::text as kind, s.id as assignment_id, s.asset_id,
                  a.asset_tag, a.name as asset_name, s.person_id, pe.display_name as person_name,
                  s.loaner_pool_id, p.name as pool_name, s.expected_return
             ${LOAN_FROM}
            where s.loaner_pool_id is not null
            order by s.checked_out_at desc, s.id desc limit 20)
          union all
          (select s.checked_in_at as at, 'checked_in'::text as kind, s.id as assignment_id, s.asset_id,
                  a.asset_tag, a.name as asset_name, s.person_id, pe.display_name as person_name,
                  s.loaner_pool_id, p.name as pool_name, s.expected_return
             ${LOAN_FROM}
            where s.loaner_pool_id is not null and s.checked_in_at is not null
            order by s.checked_in_at desc, s.id desc limit 20)
        ) x
        order by at desc, assignment_id desc
        limit 20`;
      return {
        as_of: day!.today,
        totals: {
          pools: rows.length,
          members: sum((r) => r.member_count),
          available: sum((r) => r.available_count),
          checked_out: sum((r) => r.checked_out_count),
          overdue: sum((r) => r.overdue_count),
          due_today: sum((r) => r.due_today_count),
          due_soon: sum((r) => r.due_soon_count),
        },
        pools: rows,
        recent: recent.map((r) => ({
          at: r.at.toISOString(),
          kind: r.kind,
          assignment_id: r.assignment_id,
          asset_id: r.asset_id,
          asset_tag: r.asset_tag,
          asset_name: r.asset_name,
          person_id: r.person_id,
          person_name: r.person_name,
          loaner_pool_id: r.loaner_pool_id,
          pool_name: r.pool_name,
          expected_return: isoDay(r.expected_return)!,
        })),
      };
    });
  }

  // ================================================================================= helpers

  /** The pool, live and switched on (404 / `409 loaner-pool-inactive`). */
  private async livePool(trx: Tx, poolId: string): Promise<PoolRow> {
    const pool = await trx.loaner_pool.findUnique({ where: { id: poolId } });
    if (!pool || pool.archived_at) throw problem.notFound('Loaner pool not found.');
    if (!pool.is_active) {
      throw new ApiProblem({
        code: 'loaner-pool-inactive',
        detail: `The loaner pool "${pool.name}" is switched off and lends nothing.`,
      });
    }
    return pool;
  }

  private async borrowerById(trx: Tx, id: string, pointer: string): Promise<PersonRow> {
    const person = await trx.person.findUnique({
      where: { id },
      select: {
        id: true,
        display_name: true,
        kind: true,
        status: true,
        email: true,
        employee_ref: true,
        archived_at: true,
      },
    });
    if (!person || person.archived_at) {
      throw problem.validation([invalidRef(pointer, 'No such person.')]);
    }
    return this.activePerson(person, pointer);
  }

  /** The scanned text is an email address (case-insensitive) or an `employee_ref` (exact). */
  private async borrowerByText(trx: Tx, text: string): Promise<PersonRow> {
    const found = await trx.person.findMany({
      where: {
        archived_at: null,
        OR: [{ email_key: text.toLowerCase() }, { employee_ref: text }],
      },
      select: {
        id: true,
        display_name: true,
        kind: true,
        status: true,
        email: true,
        employee_ref: true,
      },
      take: 3,
    });
    if (found.length === 0) {
      throw problem.validation([
        { pointer: '/borrower', message: 'no person has this email or badge', code: 'not-found' },
      ]);
    }
    if (found.length > 1) {
      throw problem.conflict(
        'This text matches more than one person (an email and a badge number collide). Pick the person by id.',
      );
    }
    return this.activePerson(found[0]!, '/borrower');
  }

  private activePerson(person: PersonRow, pointer: string): PersonRow {
    if (person.status !== 'active') {
      throw problem.validation([
        { pointer, message: 'inactive people cannot borrow', code: 'inactive' },
      ]);
    }
    return person;
  }

  private assertEligible(pool: PoolRow, person: PersonRow, pointer: string): void {
    if (
      pool.eligible_person_kinds.length > 0 &&
      !pool.eligible_person_kinds.includes(person.kind)
    ) {
      throw problem.validation([
        {
          pointer,
          message: `this pool lends to ${pool.eligible_person_kinds.join(', ')} only`,
          code: 'not-eligible',
        },
      ]);
    }
  }

  /** Serialises loans of one borrower, so two scans cannot both slip under the limit. */
  private async lockPerson(trx: Tx, personId: string): Promise<void> {
    await trx.$queryRaw`select id from app.person where id = ${personId}::uuid for update`;
  }

  private async assertUnderLimit(trx: Tx, pool: PoolRow, personId: string, extra: number) {
    if (pool.max_loans_per_person === null) return;
    const [row] = await trx.$queryRaw<Array<{ n: bigint }>>`
      select count(*) as n from app.assignment
       where person_id = ${personId}::uuid and loaner_pool_id = ${pool.id}::uuid and checked_in_at is null`;
    this.assertBelowLimit(pool, Number(row!.n) + extra);
  }

  private assertBelowLimit(pool: PoolRow, held: number): void {
    if (pool.max_loans_per_person !== null && held >= pool.max_loans_per_person) {
      throw new ApiProblem({
        code: 'loan-limit-reached',
        detail: `The borrower already holds ${held} loan(s) from "${pool.name}"; the pool allows ${pool.max_loans_per_person}.`,
      });
    }
  }

  /** The due date of a new loan: the request's, else today + the pool's default; bounded by the pool. */
  private dueDate(pool: PoolRow, requested: string | undefined): string {
    const today = todayUtc();
    const due = requested ?? addDays(today, pool.default_loan_days);
    const errors: FieldError[] = [];
    if (due < dayBefore()) {
      errors.push({
        pointer: '/expected_return',
        message: `must not be in the past (today is ${today} UTC)`,
        code: 'in-the-past',
      });
    } else if (pool.max_loan_days !== null && due > addDays(today, pool.max_loan_days)) {
      errors.push({
        pointer: '/expected_return',
        message: `the pool allows a loan to run ${pool.max_loan_days} day(s) at most`,
        code: 'exceeds-max-loan',
      });
    }
    if (errors.length > 0) throw problem.validation(errors);
    return due;
  }
}
