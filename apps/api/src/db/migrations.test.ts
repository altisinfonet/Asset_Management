import { describe, expect, it } from 'vitest';
import { DEFAULT_MIGRATIONS_DIR, loadMigrations } from './migrator.js';

/** Static guards over the shipped SQL (the database-level guard is app.schema_lint()). */
describe('shipped migrations', async () => {
  const migrations = await loadMigrations(DEFAULT_MIGRATIONS_DIR);
  const sql = migrations.map((m) => m.sql).join('\n');

  it('have unique, strictly increasing numbers (lanes reserve ranges: 0010-0019 auth, 0020-0029 platform)', () => {
    const numbers = migrations.map((m) => Number(m.id.slice(0, 4)));
    expect(numbers[0]).toBe(1);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('M1 ships tenancy, catalogue, assets, audit, identity and provisioning only (no M2 tables)', () => {
    const tables = [...sql.matchAll(/create table (app|identity)\.([a-z_]+)/gi)].map(
      (m) => `${m[1]}.${m[2]}`,
    );
    for (const m2 of [
      'location',
      'person',
      'accessory',
      'consumable',
      'assignment',
      'transfer',
      'asset_history',
      'maintenance_record',
      'label_template',
      'import_job',
    ]) {
      expect(tables).not.toContain(`app.${m2}`);
    }
    for (const m1 of [
      'tenant',
      'company',
      'role',
      'user_account',
      'invitation',
      'role_assignment',
      'api_key',
      'category',
      'manufacturer',
      'vendor',
      'asset_model',
      'status_label',
      'custom_field_def',
      'asset_tag_counter',
      'asset',
      'attachment',
      'idempotency_key',
      'outbox_event',
      'audit_log',
    ]) {
      expect(tables).toContain(`app.${m1}`);
    }
    expect(tables.filter((t) => t.startsWith('identity.'))).toHaveLength(10);
  });

  it('every app table is passed through app.apply_tenant_conventions in the same migration', () => {
    for (const m of migrations) {
      const created = [...m.sql.matchAll(/create table app\.([a-z_]+)/gi)].map((x) => x[1]!);
      for (const table of created) {
        expect(m.sql, `${m.id}: app.${table}`).toMatch(
          new RegExp(`apply_tenant_conventions\\('app\\.${table}'`),
        );
      }
    }
  });

  it('never grants through default privileges (partitions must never inherit access)', () => {
    expect(sql).not.toMatch(/alter\s+default\s+privileges/i);
  });

  it('never uses a database-side uuidv7() default (PostgreSQL 18 only, ED-08)', () => {
    expect(sql).not.toMatch(/default\s+(public\.|pg_catalog\.)?uuidv7\s*\(/i);
  });

  it('never declares SECURITY DEFINER', () => {
    // Comments and string literals (the lint rule's own message) are not declarations.
    const code = sql.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/security\s+definer/i);
  });

  it('never grants anything on a partition by name', () => {
    expect(sql).not.toMatch(
      /grant\s+[^;]*\bon\s+(table\s+)?app\.audit_log_(\d{4}_\d{2}|default)\b/i,
    );
  });
});
