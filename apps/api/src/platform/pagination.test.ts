import { describe, expect, it } from 'vitest';
import {
  bindingFor,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  listPage,
  listQuerySchema,
  parseFields,
  parseSort,
  type ListSpec,
} from './pagination.js';
import type { ApiProblem } from './problem.js';

const spec: ListSpec = {
  sortable: {
    name: { kind: 'string' },
    created_at: { kind: 'date' },
    qty: { kind: 'number', column: 'quantity' },
  },
  defaultSort: '-created_at',
};

describe('listQuerySchema', () => {
  it('defaults limit to 50 and include_total to false', () => {
    expect(listQuerySchema.parse({})).toMatchObject({ limit: 50, include_total: false });
  });
  it('coerces and bounds limit to 1-200', () => {
    expect(listQuerySchema.parse({ limit: '200' }).limit).toBe(200);
    expect(listQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(listQuerySchema.safeParse({ limit: 'abc' }).success).toBe(false);
  });
  it('accepts include_total=true only as a boolean word', () => {
    expect(listQuerySchema.parse({ include_total: 'true' }).include_total).toBe(true);
    expect(listQuerySchema.safeParse({ include_total: 'yes' }).success).toBe(false);
  });
});

describe('parseSort', () => {
  it('uses the default and always appends the id tiebreaker', () => {
    expect(
      parseSort(undefined, spec).map((t) => `${t.direction === 'desc' ? '-' : ''}${t.key}`),
    ).toEqual(['-created_at', 'id']);
  });

  it('parses multiple keys, maps columns and keeps an explicit id', () => {
    const terms = parseSort('qty,-name,-id', spec);
    expect(terms.map((t) => [t.key, t.column, t.direction])).toEqual([
      ['qty', 'quantity', 'asc'],
      ['name', 'name', 'desc'],
      ['id', 'id', 'desc'],
    ]);
  });

  it('ignores a repeated key and rejects unknown keys with the allowed list', () => {
    expect(parseSort('name,name', spec).map((t) => t.key)).toEqual(['name', 'id']);
    try {
      parseSort('password', spec);
      throw new Error('expected a 400');
    } catch (err) {
      const p = err as ApiProblem;
      expect(p.getStatus()).toBe(400);
      expect(p.detail).toContain('name, created_at, qty');
      expect(p.errors?.[0]?.pointer).toBe('query:sort');
    }
  });
});

describe('parseFields', () => {
  it('builds a select that always includes id, and rejects unknown fields', () => {
    expect(parseFields(undefined, ['name'])).toBeUndefined();
    expect(parseFields('name,serial', ['name', 'serial'])).toEqual({
      id: true,
      name: true,
      serial: true,
    });
    expect(() => parseFields('secret', ['name'])).toThrow(/not a field/);
  });
});

describe('cursor', () => {
  const terms = parseSort('-created_at,name', spec);
  const binding = bindingFor(terms, { q: 'x' });
  const row = {
    id: '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f',
    name: 'Zed',
    created_at: new Date('2026-01-02T03:04:05.678Z'),
  };

  it('round-trips typed values (dates come back as Dates)', () => {
    const decoded = decodeCursor(encodeCursor(terms, binding, row), terms, binding);
    expect(decoded).toEqual([row.created_at, 'Zed', row.id]);
    expect(decoded[0]).toBeInstanceOf(Date);
  });

  it('is opaque url-safe text', () => {
    const c = encodeCursor(terms, binding, row);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c).not.toContain('Zed');
  });

  it('is bound to sort and filters', () => {
    const c = encodeCursor(terms, binding, row);
    expect(() =>
      decodeCursor(c, parseSort('name', spec), bindingFor(parseSort('name', spec), { q: 'x' })),
    ).toThrow(/different sort or filter/);
    expect(() => decodeCursor(c, terms, bindingFor(terms, { q: 'y' }))).toThrow(
      /different sort or filter/,
    );
    // filter key order does not matter
    expect(bindingFor(terms, { a: 1, b: 2 })).toBe(bindingFor(terms, { b: 2, a: 1 }));
    // undefined filters do not matter either
    expect(bindingFor(terms, { a: 1, b: undefined })).toBe(bindingFor(terms, { a: 1 }));
  });

  it.each([
    ['not base64 json', '%%%'],
    [
      'wrong version',
      Buffer.from(JSON.stringify({ v: 2, b: binding, k: [] })).toString('base64url'),
    ],
    [
      'wrong arity',
      Buffer.from(JSON.stringify({ v: 1, b: binding, k: [1] })).toString('base64url'),
    ],
    [
      'null key',
      Buffer.from(JSON.stringify({ v: 1, b: binding, k: [null, 'a', 'b'] })).toString('base64url'),
    ],
    [
      'bad date',
      Buffer.from(JSON.stringify({ v: 1, b: binding, k: ['not-a-date', 'a', 'b'] })).toString(
        'base64url',
      ),
    ],
    ['array', Buffer.from('[]').toString('base64url')],
  ])('rejects a tampered cursor: %s', (_name, cursor) => {
    try {
      decodeCursor(cursor, terms, binding);
      throw new Error('expected 400 invalid-cursor');
    } catch (err) {
      expect((err as ApiProblem).code).toBe('invalid-cursor');
      expect((err as ApiProblem).getStatus()).toBe(400);
    }
  });

  it('refuses to encode a row that lacks a sort column (developer error, not a client error)', () => {
    expect(() => encodeCursor(terms, binding, { id: 'x' })).toThrow(/include every sort column/);
  });
});

// ---- keyset correctness, evaluated against an in-memory table -------------------------------

type Row = { id: string; name: string; quantity: number; created_at: Date };
type Cond = Record<string, unknown>;

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  return Object.entries(cond).every(([key, expected]) => {
    if (key === 'OR') return (expected as Cond[]).some((c) => matches(row, c));
    if (key === 'AND') return (expected as Cond[]).every((c) => matches(row, c));
    const actual = row[key] as string | number | Date;
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const e = expected as { gt?: unknown; lt?: unknown };
      if ('gt' in e) return actual > (e.gt as typeof actual);
      if ('lt' in e) return actual < (e.lt as typeof actual);
    }
    return actual instanceof Date
      ? actual.getTime() === (expected as Date).getTime()
      : actual === expected;
  });
}

function makeTable(n: number): Row[] {
  // Deliberate ties on name, quantity and created_at so only the id tiebreaker separates rows.
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-7000-8000-${String(i).padStart(12, '0')}`,
    name: `n${i % 4}`,
    quantity: i % 3,
    created_at: new Date(Date.UTC(2026, 0, 1 + (i % 5))),
  }));
}

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as string | number);
  const y = b instanceof Date ? b.getTime() : (b as string | number);
  return x < y ? -1 : x > y ? 1 : 0;
}

async function walk(
  table: Row[],
  sort: string,
  limit: number,
  filters: Record<string, unknown> = {},
) {
  const seen: Row[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await listPage<Row>({
      query: { limit, cursor, sort, include_total: true },
      spec,
      filters,
      fetch: async ({ take, orderBy, where }) =>
        table
          .filter((r) => (where ? matches(r, where) : true))
          .sort((a, b) => {
            for (const o of orderBy) {
              const [col, dir] = Object.entries(o)[0]! as [keyof Row, 'asc' | 'desc'];
              const c = cmp(a[col], b[col]);
              if (c !== 0) return dir === 'asc' ? c : -c;
            }
            return 0;
          })
          .slice(0, take),
      count: async () => table.length,
    });
    seen.push(...page.data);
    expect(page.page.total).toBe(table.length);
    if (!page.page.next_cursor) return seen;
    cursor = page.page.next_cursor;
  }
  throw new Error('pagination did not terminate');
}

describe('listPage keyset pagination', () => {
  const table = makeTable(37);

  it.each([
    '-created_at',
    'created_at',
    'name,-created_at',
    '-qty,name',
    '-name,-qty,created_at',
    'id',
    '-id',
  ])('visits every row exactly once, in sort order, for sort=%s (ties included)', async (sort) => {
    for (const limit of [1, 5, 36, 37, 200]) {
      const seen = await walk(table, sort, limit);
      expect(seen.map((r) => r.id).sort()).toEqual(table.map((r) => r.id).sort());
      expect(new Set(seen.map((r) => r.id)).size).toBe(table.length);
      const terms = parseSort(sort, spec);
      for (let i = 1; i < seen.length; i++) {
        let order = 0;
        for (const t of terms) {
          const c = cmp(seen[i - 1]![t.column as keyof Row], seen[i]![t.column as keyof Row]);
          if (c !== 0) {
            order = t.direction === 'asc' ? c : -c;
            break;
          }
        }
        expect(order, `${sort} at ${i}`).toBeLessThan(0);
      }
    }
  });

  it('reports has_more/next_cursor exactly: a full last page has no cursor', async () => {
    const small = makeTable(10);
    const exact = await listPage<Row>({
      query: { limit: 10, include_total: false },
      spec,
      fetch: async ({ take }) => small.slice(0, take),
    });
    expect(exact.page).toEqual({ next_cursor: null, has_more: false });
    const more = await listPage<Row>({
      query: { limit: 9, include_total: false },
      spec,
      fetch: async ({ take }) => small.slice(0, take),
    });
    expect(more.page.has_more).toBe(true);
    expect(more.data).toHaveLength(9);
    expect(more.page.next_cursor).toBeTruthy();
    expect(more.page).not.toHaveProperty('total');
  });

  it('only counts when include_total is set', async () => {
    let counted = 0;
    await listPage<Row>({
      query: { limit: 5, include_total: false },
      spec,
      fetch: async () => [],
      count: async () => ++counted,
    });
    expect(counted).toBe(0);
  });

  it('keysetWhere shape: OR of (equal prefix AND strict comparison)', () => {
    const terms = parseSort('name,-created_at', spec);
    const d = new Date('2026-01-01T00:00:00Z');
    expect(keysetWhere(terms, ['a', d, 'id1'])).toEqual({
      OR: [
        { name: { gt: 'a' } },
        { AND: [{ name: 'a' }, { created_at: { lt: d } }] },
        { AND: [{ name: 'a' }, { created_at: d }, { id: { gt: 'id1' } }] },
      ],
    });
  });
});
