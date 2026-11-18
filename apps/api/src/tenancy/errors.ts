/**
 * PostgreSQL SQLSTATE of a failed query, whatever layer wrapped it.
 *
 * Prisma 7 with a driver adapter surfaces database errors as `PrismaClientKnownRequestError`
 * (`P2002` unique violation, `P2003` foreign key, `P2010` raw query failed, `P2034` write conflict /
 * serialization failure...) and keeps the original node-postgres error in
 * `meta.driverAdapterError.cause` (`originalCode` is the SQLSTATE). Errors from `pg` itself (the
 * migrator, raw test clients) carry `code` directly. Returns undefined when no SQLSTATE is found.
 */
export function sqlStateOf(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): string | undefined => {
    if (typeof value !== 'object' || value === null || depth > 6 || seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const o = value as Record<string, unknown>;
    for (const key of ['originalCode', 'sqlState']) {
      const v = o[key];
      if (typeof v === 'string' && /^[0-9A-Z]{5}$/.test(v)) return v;
    }
    // `code` is a SQLSTATE for pg errors (P0001 is a valid one: plpgsql RAISE EXCEPTION), while
    // Prisma's own codes (P2002...) live on PrismaClient*Error objects, which carry `clientVersion`.
    const code = o.code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && !('clientVersion' in o)) {
      return code;
    }
    // Raw-query errors from Prisma 6/7 put the SQLSTATE in meta.code.
    const meta = o.meta;
    if (typeof meta === 'object' && meta !== null) {
      const metaCode = (meta as Record<string, unknown>).code;
      if (typeof metaCode === 'string' && /^[0-9A-Z]{5}$/.test(metaCode)) return metaCode;
      const nested = visit(meta, depth + 1);
      if (nested) return nested;
    }
    return (
      visit(o.driverAdapterError, depth + 1) ??
      visit(o.cause, depth + 1) ??
      visit(o.originalError, depth + 1)
    );
  };
  return visit(err, 0);
}

/** 23505 unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return sqlStateOf(err) === '23505' || prismaCodeOf(err) === 'P2002';
}

/** Prisma's own error code (`P2002`...), if the error is a Prisma known-request error. */
export function prismaCodeOf(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'clientVersion' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^P\d{4}$/.test(code)) return code;
  }
  return undefined;
}
