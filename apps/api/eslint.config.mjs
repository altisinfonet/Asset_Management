import tseslint from 'typescript-eslint';
import { base } from '../../eslint.config.mjs';

/**
 * Dependency boundaries (ADR 0001, ADR 0003; architecture 4 "Boundary rules"), enforced with ESLint
 * `no-restricted-imports` (no extra tool):
 *
 *  1. The database client is reachable only inside `tenancy` (and `db`, the owner-path migrator
 *     and maintenance code). Every other module goes through TenancyService / TenantRepository,
 *     so tenant context cannot be bypassed by a stray query. Type-only imports are fine.
 *  2. A module is used through its facade: `src/<module>/index.ts`. Importing another module's
 *     internals (`../tenancy/tenant-tx.js`) fails lint.
 *  3. The platform kernel never imports a domain module or an application entry point.
 * Tests may use the driver and module internals directly (fixtures, raw clients).
 */

/** Modules with a public facade (`index.ts`). */
export const FACADE_MODULES = [
  'tenancy',
  'platform',
  'control-plane',
  'identity',
  'auth',
  'audit',
  'outbox',
  'jobs',
  'crypto',
  'mail',
  'observability',
  'registry',
  'locations',
  'people',
  'lifecycle',
  'openapi',
  'storage',
  'scanner',
  'files',
];
/** Platform kernel directories (may import each other's facades, never domain/application code). */
export const KERNEL_DIRS = [
  'platform',
  'tenancy',
  'control-plane',
  'identity',
  'auth',
  'audit',
  'outbox',
  'jobs',
  'crypto',
  'mail',
  'observability',
  'config',
  'logging',
  'ids',
  'db',
  'context',
  'storage',
  'scanner',
];
/** Domain modules (architecture 4); they depend on the kernel, never the other way round. */
export const DOMAIN_DIRS = [
  'registry',
  'locations',
  'people',
  'files',
  'lifecycle',
  'tagging',
  'licenses',
  'maintenance',
  'finance',
  'importer',
  'connectors',
  'discovery',
  'reporting',
  'workflow',
  'relationships',
  'ai',
];
/** Application-level code that wires modules together. */
export const APP_DIRS = ['bootstrap', 'seed', 'cli', 'health'];

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

const DRIVER_MESSAGE =
  'The database client may only be imported inside src/tenancy (and src/db). Use TenancyService.withTenantTx / TenantRepository.';
const INTERNALS_MESSAGE =
  'Import a module only through its facade (src/<module>/index.ts), never its internals.';
const AWS_MESSAGE =
  'Object storage is reached through the StorageAdapter port (src/ports); only src/storage may import the AWS SDK.';
const KERNEL_MESSAGE =
  'The platform kernel must not import domain modules or application entry points (dependencies point downward).';

/**
 * `$queryRawUnsafe` / `$executeRawUnsafe` take a plain string: SQL injection by construction.
 * Raw SQL is written with tagged templates (`$queryRaw`...``) only, in every file including tests.
 */
const UNSAFE_RAW_SELECTOR =
  'MemberExpression[property.name=/RawUnsafe$/], MemberExpression[computed=true][property.value=/RawUnsafe$/]';

const dirs = (list) => list.flatMap((d) => [`**/${d}`, `**/${d}/**`]);

/** `no-restricted-imports` options for a file group. */
function restricted({ driver, kernel, allowPgBoss = false, allowAws = false }) {
  const patterns = [
    ...FACADE_MODULES.map((m) => ({
      group: [`**/${m}/*`, `!**/${m}/index.js`],
      allowTypeImports: false,
      message: INTERNALS_MESSAGE,
    })),
  ];
  if (kernel) {
    patterns.push({ group: dirs([...DOMAIN_DIRS, ...APP_DIRS]), message: KERNEL_MESSAGE });
  }
  if (!allowAws) {
    patterns.push({ group: ['@aws-sdk/*', '@smithy/*'], message: AWS_MESSAGE });
  }
  const paths = [];
  if (driver) {
    paths.push(
      ...DRIVER_PACKAGES.filter((p) => !p.includes('*')).map((name) => ({
        name,
        allowTypeImports: true,
        message: DRIVER_MESSAGE,
      })),
    );
    patterns.push({
      // pg-boss matches `pg-*`; the jobs adapter is the one place besides db/ that may import it.
      group: [
        ...DRIVER_PACKAGES.filter((p) => p.includes('*')),
        ...(allowPgBoss ? ['!pg-boss'] : []),
        ...GENERATED_CLIENT_PATTERNS,
      ],
      allowTypeImports: true,
      message: DRIVER_MESSAGE,
    });
  }
  return ['error', { paths, patterns }];
}

const srcOf = (list) => list.map((d) => `src/${d}/**/*.ts`);
const testFiles = ['src/**/*.test.ts'];

export default tseslint.config(
  ...base,
  { ignores: ['src/generated/**'] },
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
  // Kernel code that must not touch the database client: platform, control-plane, identity, config, ...
  {
    files: srcOf(KERNEL_DIRS.filter((d) => !['tenancy', 'db', 'jobs', 'storage'].includes(d))),
    ignores: testFiles,
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted({ driver: true, kernel: true }),
    },
  },
  // The jobs adapter: like the rest of the kernel, but the only module (with db/) allowed to import pg-boss.
  {
    files: srcOf(['jobs']),
    ignores: testFiles,
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted({
        driver: true,
        kernel: true,
        allowPgBoss: true,
      }),
    },
  },
  // The storage adapters: the one place that may import the AWS SDK (and, like the rest of the kernel, no database client).
  {
    files: srcOf(['storage']),
    ignores: testFiles,
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted({
        driver: true,
        kernel: true,
        allowAws: true,
      }),
    },
  },
  // tenancy and db own the client; they still obey the facade and downward-dependency rules.
  {
    files: srcOf(['tenancy', 'db']),
    ignores: testFiles,
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted({ driver: false, kernel: true }),
    },
  },
  // Everything else under src: domain modules, bootstrap, seed, cli, health, entry points.
  {
    files: ['src/**/*.ts'],
    ignores: [...testFiles, ...srcOf(KERNEL_DIRS)],
    rules: {
      '@typescript-eslint/no-restricted-imports': restricted({ driver: true, kernel: false }),
    },
  },
);
