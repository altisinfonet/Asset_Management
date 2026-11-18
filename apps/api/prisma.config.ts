import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (ADR 0001). Prisma is used as a typed client ONLY: the SQL migrations in
 * ./migrations are the source of truth, `prisma/schema.prisma` is generated from a migrated database
 * (`pnpm db:pull`), and `prisma migrate` / `prisma db push` are never used.
 * The CLI introspects through a DIRECT connection as the owner role (MIGRATOR_DATABASE_URL).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.MIGRATOR_DATABASE_URL ?? '',
  },
});
