import tseslint from 'typescript-eslint';
import { base } from '../../eslint.config.mjs';

/**
 * Dependency boundary (M1-TEN-02, ADR 0001): the database client is reachable only inside `tenancy`
 * (and `db`, the owner-path migrator and maintenance code). Every other module goes through
 * TenancyService / TenantRepository, so tenant context cannot be bypassed by a stray query.
 * Type-only imports are fine. Tests may use the driver directly (fixtures, raw clients).
 */
export const DRIVER_PACKAGES = [
  '@prisma/client',
  '@prisma/client/*',
  '@prisma/adapter-pg',
  'pg',
  'pg-*',
  'pg-pool',
  'kysely',
  'postgres',
  'drizzle-orm',
  'drizzle-orm/*',
];
/** The generated Prisma client (apps/api/src/generated/prisma), by any relative path. */
export const GENERATED_CLIENT_PATTERNS = ['**/generated/prisma', '**/generated/prisma/**'];

const BOUNDARY_MESSAGE =
  'The database client may only be imported inside src/tenancy (and src/db). Use TenancyService.withTenantTx / TenantRepository.';

/**
 * `$queryRawUnsafe` / `$executeRawUnsafe` take a plain string: SQL injection by construction.
 * Raw SQL is written with tagged templates (`$queryRaw`...``) only, in every file including tests.
 */
const UNSAFE_RAW_SELECTOR =
  'MemberExpression[property.name=/RawUnsafe$/], MemberExpression[computed=true][property.value=/RawUnsafe$/]';

export default tseslint.config(
  ...base,
  {
    ignores: ['src/generated/**'],
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: UNSAFE_RAW_SELECTOR,
          message:
            'Prisma $queryRawUnsafe / $executeRawUnsafe are banned: use the tagged-template $queryRaw / $executeRaw (parameters are bound, never concatenated).',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/tenancy/**', 'src/db/**', 'src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: DRIVER_PACKAGES.filter((p) => !p.includes('*')).map((name) => ({
            name,
            allowTypeImports: true,
            message: BOUNDARY_MESSAGE,
          })),
          patterns: [
            {
              group: [
                ...DRIVER_PACKAGES.filter((p) => p.includes('*')),
                ...GENERATED_CLIENT_PATTERNS,
              ],
              allowTypeImports: true,
              message: BOUNDARY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
);
