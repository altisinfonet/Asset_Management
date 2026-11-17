import tseslint from 'typescript-eslint';
import { base } from '../../eslint.config.mjs';

/**
 * Dependency boundary (M1-TEN-02): the database driver is reachable only inside `tenancy` (and
 * `db`, the owner-path migrator and maintenance code). Every other module goes through
 * TenancyService / TenantRepository, so tenant context cannot be bypassed by a stray query.
 * Type-only imports are fine. Tests may use the driver directly (fixtures, raw clients).
 */
const DRIVER_PACKAGES = [
  'pg',
  'pg-*',
  'pg-pool',
  'kysely',
  'postgres',
  'drizzle-orm',
  'drizzle-orm/*',
];

export default tseslint.config(...base, {
  files: ['src/**/*.ts'],
  ignores: ['src/tenancy/**', 'src/db/**', 'src/**/*.test.ts'],
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: DRIVER_PACKAGES.filter((p) => !p.includes('*')).map((name) => ({
          name,
          allowTypeImports: true,
          message:
            'The database driver may only be imported inside src/tenancy (and src/db). Use TenancyService.withTenantTx / TenantRepository.',
        })),
        patterns: [
          {
            group: DRIVER_PACKAGES.filter((p) => p.includes('*')),
            allowTypeImports: true,
            message: 'The database driver may only be imported inside src/tenancy (and src/db).',
          },
        ],
      },
    ],
  },
});
