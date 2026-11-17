import { parseArgs } from 'node:util';
import { bootstrapTenant } from '../bootstrap/bootstrap-tenant.js';
import { auditRoles, ensurePartitions, schemaLint, withOwnerClient } from '../db/maintenance.js';
import { seedDemoData } from '../seed/seed.js';
import { TenancyService } from '../tenancy/index.js';

const USAGE = `usage: cli <command> [options]

  tenant:create --name <name> --admin-email <email> [--admin-name <name>] [--slug <slug>] [--currency USD]
      Bootstrap a tenant (idempotent per slug). Uses DATABASE_URL (runtime role).
  seed
      Create the demo tenants Acme and Globex (idempotent; refuses NODE_ENV=production). Uses DATABASE_URL.
  schema:lint
      Run app.schema_lint() and the role audit; exit 1 on any violation. Uses MIGRATOR_DATABASE_URL.
  db:ensure-partitions [--months 12]
      Create audit_log partitions for the next N months. Uses MIGRATOR_DATABASE_URL.
`;

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required for this command`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'tenant:create': {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: 'string' },
          'admin-email': { type: 'string' },
          'admin-name': { type: 'string' },
          slug: { type: 'string' },
          currency: { type: 'string' },
        },
      });
      if (!values.name || !values['admin-email']) {
        console.error('tenant:create needs --name and --admin-email\n\n' + USAGE);
        return 2;
      }
      const tenancy = new TenancyService({
        connectionString: need('DATABASE_URL'),
        poolMax: 2,
        applicationName: 'assettracker-cli',
      });
      try {
        const result = await bootstrapTenant(tenancy, {
          name: values.name,
          adminEmail: values['admin-email'],
          adminName: values['admin-name'],
          slug: values.slug,
          baseCurrency: values.currency,
        });
        const { invitationToken, ...summary } = result;
        console.log(JSON.stringify(summary, null, 2));
        if (invitationToken) {
          // Dev convenience until the invitation mail (M1-AUTH) exists. Shown once; only its hash is stored.
          console.log(`invitation token (shown once): ${invitationToken}`);
        } else {
          console.log('tenant already existed: no new invitation was issued');
        }
        return 0;
      } finally {
        await tenancy.onModuleDestroy();
      }
    }

    case 'seed': {
      const tenancy = new TenancyService({
        connectionString: need('DATABASE_URL'),
        poolMax: 2,
        applicationName: 'assettracker-cli',
      });
      try {
        const { tenants } = await seedDemoData(tenancy, {
          logger: { info: (m) => console.log(m) },
        });
        console.log(JSON.stringify(tenants, null, 2));
        return 0;
      } finally {
        await tenancy.onModuleDestroy();
      }
    }

    case 'schema:lint': {
      const violations = await withOwnerClient(need('MIGRATOR_DATABASE_URL'), async (client) => [
        ...(await schemaLint(client)),
        ...(await auditRoles(client)),
      ]);
      if (violations.length > 0) {
        console.error(`schema lint FAILED (${violations.length} violation(s)):`);
        for (const v of violations) console.error(`  - ${v}`);
        return 1;
      }
      console.log('schema lint OK (0 violations); role audit OK');
      return 0;
    }

    case 'db:ensure-partitions': {
      const { values } = parseArgs({ args: rest, options: { months: { type: 'string' } } });
      const months = Number(values.months ?? 12);
      if (!Number.isInteger(months) || months < 1 || months > 120) {
        console.error('--months must be an integer between 1 and 120');
        return 2;
      }
      const created = await withOwnerClient(need('MIGRATOR_DATABASE_URL'), (c) =>
        ensurePartitions(c, new Date(), months),
      );
      console.log(`partitions created: ${created}`);
      return 0;
    }

    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  },
);
