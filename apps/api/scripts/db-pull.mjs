// Regenerates prisma/schema.prisma from a MIGRATED database (ADR 0001): the SQL migrations are the
// source of truth, the Prisma schema is derived and committed, and CI fails when it drifts.
//
//   MIGRATOR_DATABASE_URL=postgres://app_owner:dev@localhost:5433/app pnpm --filter @assettracker/api db:pull
//
// Steps: (1) reset prisma/schema.prisma to the header below, because `prisma db pull` refuses to
// start when the previous (introspected) schema is itself invalid; (2) introspect; (3) drop the
// index lines Prisma can introspect but then cannot validate (multi-column GIN indexes mixing a
// uuid column with a trigram/jsonb operator class: `The Gin index field type Uuid has no default
// operator class`). Indexes do not affect the generated client, and the SQL migrations keep them.
// The output is deterministic, so `git diff --exit-code` is a valid drift check.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(apiRoot, 'prisma', 'schema.prisma');

const HEADER = `generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  previewFeatures     = ["partialIndexes"]
  importFileExtension = "js"
  moduleFormat        = "esm"
}

datasource db {
  provider = "postgresql"
  schemas  = ["app", "identity"]
}
`;

if (!process.env.MIGRATOR_DATABASE_URL) {
  console.error(
    'db:pull needs MIGRATOR_DATABASE_URL (owner role, direct connection, migrated database)',
  );
  process.exit(2);
}

writeFileSync(schemaPath, HEADER);
const prismaBin = createRequire(import.meta.url).resolve('prisma/build/index.js');
const pull = spawnSync(process.execPath, [prismaBin, 'db', 'pull', '--schema', schemaPath], {
  cwd: apiRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
});
if (pull.status !== 0) process.exit(pull.status ?? 1);

const text = readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');
const dropped = [];
const kept = text.split('\n').filter((line) => {
  if (/^\s*@@index\(.*\btype: Gin\b/.test(line)) {
    dropped.push(line.trim());
    return false;
  }
  return true;
});
writeFileSync(schemaPath, kept.join('\n'));
console.log(`db:pull: wrote ${schemaPath} (${dropped.length} GIN index lines omitted)`);
