import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { bootstrapTenant } from '../src/bootstrap/bootstrap-tenant.js';
import {
  AllModulesOnEntitlementSource,
  ControlPlaneService,
  TenantInactiveError,
} from '../src/control-plane/index.js';
import { generateToken, hashToken, IdentityLookupService } from '../src/identity/index.js';
import { uuidv7 } from '../src/ids/uuidv7.js';
import {
  ASSETS_PER_TENANT,
  DEMO_TENANTS,
  SeedRefusedError,
  seedDemoData,
} from '../src/seed/seed.js';
import { asBytes, Prisma, type Tx } from '../src/tenancy/index.js';
import { dbEnabled, mode, newTenancy } from './support/db.js';

const TENANT_TABLES = [
  'app.tenant',
  'app.company',
  'app.role',
  'app.user_account',
  'app.invitation',
  'app.role_assignment',
  'app.api_key',
  'app.category',
  'app.manufacturer',
  'app.vendor',
  'app.asset_model',
  'app.status_label',
  'app.custom_field_def',
  'app.asset_tag_counter',
  'app.asset',
  'app.attachment',
  // M2 wave 1
  'app.location',
  'app.person',
  'app.assignment',
  'app.transfer',
  'app.asset_history',
  'app.idempotency_key',
  'app.outbox_event',
  'app.audit_log',
] as const;

/** Row count of a table from the fixed lists in this file (Prisma.raw splices a trusted identifier). */
async function countOf(trx: Tx, table: string): Promise<number> {
  const [row] = await trx.$queryRaw<Array<{ n: number }>>`
    select count(*)::int as n from ${Prisma.raw(table)}`;
  return row!.n;
}

describe.skipIf(!dbEnabled)(`control plane, identity lookups, bootstrap and seed (${mode})`, () => {
  const tenancy = newTenancy();
  const identity = new IdentityLookupService(tenancy);
  const controlPlane = new ControlPlaneService(tenancy, new AllModulesOnEntitlementSource());
  const run = uuidv7().slice(-10);

  afterAll(async () => {
    await tenancy.onModuleDestroy();
  });

  const rowCounts = (tenantId: string) =>
    tenancy.withTenantTx({ tenantId }, async (trx) => {
      const counts: Record<string, number> = {};
      for (const t of TENANT_TABLES) counts[t] = await countOf(trx, t);
      return counts;
    });

  describe('tenant bootstrap (M1-TEN-09)', () => {
    const emailA = `owner-a-${run}@bootstrap.example`;
    const emailB = `owner-b-${run}@bootstrap.example`;

    it('creates tenant, company, roles, status labels, categories, the first admin and an invitation; two tenants back to back share no rows', async () => {
      const a = await bootstrapTenant(tenancy, { name: `Boot A ${run}`, adminEmail: emailA });
      const b = await bootstrapTenant(tenancy, { name: `Boot B ${run}`, adminEmail: emailB });
      expect(a.created && b.created).toBe(true);
      expect(a.tenantId).not.toBe(b.tenantId);
      expect(a.invitationToken).toBeTruthy();

      const countsA = await rowCounts(a.tenantId);
      expect(countsA).toMatchObject({
        'app.tenant': 1,
        'app.company': 1,
        'app.role': 5,
        'app.status_label': 7,
        'app.category': 6,
        'app.user_account': 1,
        'app.role_assignment': 1,
        'app.invitation': 1,
        'app.audit_log': 1,
        'app.outbox_event': 1,
        'app.asset': 0,
      });
      expect(await rowCounts(b.tenantId)).toEqual(countsA);

      // No shared rows: ids visible to A never appear for B.
      const idsOf = (tenantId: string) =>
        tenancy.withTenantTx({ tenantId }, async (trx) => {
          const ids = new Set<string>();
          for (const rows of [
            await trx.role.findMany({ select: { id: true } }),
            await trx.status_label.findMany({ select: { id: true } }),
            await trx.category.findMany({ select: { id: true } }),
            await trx.user_account.findMany({ select: { id: true } }),
            await trx.company.findMany({ select: { id: true } }),
          ]) {
            for (const r of rows) ids.add(r.id);
          }
          return ids;
        });
      const [idsA, idsB] = [await idsOf(a.tenantId), await idsOf(b.tenantId)];
      expect([...idsA].filter((id) => idsB.has(id))).toEqual([]);

      // The admin has the tenant_admin role.
      await tenancy.withTenantTx({ tenantId: a.tenantId }, async (trx) => {
        const roles = await trx.role_assignment.findMany({
          select: { user_id: true, scope_type: true, role: { select: { key: true } } },
        });
        expect(roles).toEqual([
          { role: { key: 'tenant_admin' }, user_id: a.adminUserId, scope_type: 'tenant' },
        ]);
      });
    });

    it('is idempotent: a re-run returns the same tenant, adds nothing and issues no new invitation', async () => {
      const first = await bootstrapTenant(tenancy, {
        name: `Idem ${run}`,
        adminEmail: `idem-${run}@bootstrap.example`,
      });
      const before = await rowCounts(first.tenantId);
      const again = await bootstrapTenant(tenancy, {
        name: `Idem ${run}`,
        adminEmail: `idem-${run}@bootstrap.example`,
      });
      expect(again).toMatchObject({
        created: false,
        tenantId: first.tenantId,
        adminUserId: first.adminUserId,
      });
      expect(again.invitationToken).toBeUndefined();
      expect(await rowCounts(first.tenantId)).toEqual(before);
    });

    it('concurrent bootstraps of the same slug converge on one tenant', async () => {
      const input = { name: `Race ${run}`, adminEmail: `race-${run}@bootstrap.example` };
      const results = await Promise.all([
        bootstrapTenant(tenancy, input),
        bootstrapTenant(tenancy, input),
      ]);
      expect(results[0].tenantId).toBe(results[1].tenantId);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    });

    it('rejects an invalid admin email', async () => {
      await expect(
        bootstrapTenant(tenancy, { name: 'X Corp', adminEmail: 'not-an-email' }),
      ).rejects.toThrow();
    });
  });

  describe('identity schema: pre-tenant lookups (M1-TEN-08)', () => {
    it('resolves email, API key prefix, session token and invitation token with NO tenant set, and cannot read any tenant table', async () => {
      const email = `shared-${run}@lookup.example`;
      const a = await bootstrapTenant(tenancy, { name: `Lookup A ${run}`, adminEmail: email });
      const b = await bootstrapTenant(tenancy, { name: `Lookup B ${run}`, adminEmail: email });

      // The same email exists in two tenants.
      const candidates = await identity.findLoginCandidates(email.toUpperCase());
      expect(candidates.map((c) => c.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());
      expect(candidates.every((c) => c.tenantStatus === 'active')).toBe(true);

      // A session and an API key for tenant A.
      const sessionToken = generateToken();
      const keyPrefix = `k${run.replace(/[^a-z0-9]/gi, '').slice(0, 9)}`.padEnd(8, '0');
      const keyHash = hashToken(generateToken());
      const apiKeyId = uuidv7();
      await tenancy.withTenantTx({ tenantId: a.tenantId }, async (trx) => {
        await trx.api_key.create({
          data: {
            id: apiKeyId,
            tenant_id: a.tenantId,
            name: 'ci key',
            key_prefix: keyPrefix,
            scopes: ['asset:read'],
          },
        });
        await trx.api_key_lookup.create({
          data: {
            key_prefix: keyPrefix,
            key_hash: asBytes(keyHash),
            tenant_id: a.tenantId,
            api_key_id: apiKeyId,
          },
        });
        await trx.session.create({
          data: {
            id: uuidv7(),
            token_hash: asBytes(hashToken(sessionToken)),
            tenant_id: a.tenantId,
            user_id: a.adminUserId,
            auth_method: 'password',
            idle_expires_at: new Date(Date.now() + 3600_000),
            expires_at: new Date(Date.now() + 7200_000),
          },
        });
      });

      const session = await identity.findSessionByTokenHash(hashToken(sessionToken));
      expect(session).toMatchObject({
        tenantId: a.tenantId,
        userId: a.adminUserId,
        authMethod: 'password',
      });
      expect(await identity.findSessionByTokenHash(hashToken('forged'))).toBeNull();

      const key = await identity.findApiKeyByPrefix(keyPrefix);
      expect(key).toMatchObject({ tenantId: a.tenantId, apiKeyId });
      expect(key?.keyHash.equals(keyHash)).toBe(true);
      expect(await identity.findApiKeyByPrefix('nosuchprefix')).toBeNull();

      const invite = await identity.findInvitationByTokenHash(hashToken(a.invitationToken!));
      expect(invite).toMatchObject({ tenantId: a.tenantId });

      // ... and with no tenant context, every tenant table is invisible (fail closed).
      await tenancy.withPreTenantTx(async (trx) => {
        for (const t of TENANT_TABLES) {
          expect(await countOf(trx, t), `${t} visible without a tenant`).toBe(0);
        }
      });
    });

    it('failed logins and invalid API keys go to the control-plane security log, not the tenant audit log', async () => {
      const t = await bootstrapTenant(tenancy, {
        name: `SecLog ${run}`,
        adminEmail: `seclog-${run}@lookup.example`,
      });
      const auditBefore = (await rowCounts(t.tenantId))['app.audit_log'];
      await identity.recordSecurityEvent({
        eventType: 'login_failed',
        tenantId: t.tenantId,
        subject: `seclog-${run}@lookup.example`,
        ip: '203.0.113.9',
        detail: { reason: 'bad_password' },
      });
      await identity.recordSecurityEvent({
        eventType: 'api_key_invalid',
        subject: 'deadbeef',
        ip: '203.0.113.9',
      });
      const events = await tenancy.withPreTenantTx(
        (trx) =>
          trx.$queryRaw<Array<{ event_type: string; tenant_id: string | null; subject: string }>>`
            select event_type, tenant_id::text as tenant_id, subject
            from identity.security_event where ip = ${'203.0.113.9'}::inet`,
      );
      expect(events.map((e) => e.event_type)).toEqual(
        expect.arrayContaining(['login_failed', 'api_key_invalid']),
      );
      expect((await rowCounts(t.tenantId))['app.audit_log']).toBe(auditBefore);
    });

    it('app_user has only the narrow identity grants (no UPDATE on api_key_lookup, no DELETE on credential)', async () => {
      await tenancy.withPreTenantTx(async (trx) => {
        const rows = await trx.$queryRaw<Array<{ k: boolean; c: boolean; s: boolean }>>`
          select has_table_privilege('app_user', 'identity.api_key_lookup', 'update') as k,
                 has_table_privilege('app_user', 'identity.credential', 'delete') as c,
                 has_table_privilege('app_user', 'identity.security_event', 'update') as s`;
        expect(rows[0]).toEqual({ k: false, c: false, s: false });
      });
    });
  });

  describe('control plane (M1-TEN-07)', () => {
    it('resolves tenants to cell us-1, lists active tenants, serves an all-modules-on entitlement stub', async () => {
      const t = await bootstrapTenant(tenancy, {
        name: `CP ${run}`,
        adminEmail: `cp-${run}@cp.example`,
      });
      expect(await controlPlane.resolveTenant(t.tenantId)).toEqual({
        tenantId: t.tenantId,
        slug: t.slug,
        status: 'active',
        cell: 'us-1',
      });
      expect(await controlPlane.findBySlug(t.slug)).toMatchObject({ tenantId: t.tenantId });
      expect((await controlPlane.listActiveTenants()).map((x) => x.tenantId)).toContain(t.tenantId);
      expect(await controlPlane.resolveTenant(uuidv7())).toBeNull();

      const ent = await controlPlane.entitlementsFor(t.tenantId);
      expect(Object.values(ent.modules).every(Boolean)).toBe(true);
      expect(ent.limits).toEqual({ assets: null, users: null });
    });

    it('rejects requests and jobs for suspended, pending-deletion and unknown tenants', async () => {
      const t = await bootstrapTenant(tenancy, {
        name: `CPS ${run}`,
        adminEmail: `cps-${run}@cp.example`,
      });
      await expect(controlPlane.assertTenantActive(t.tenantId)).resolves.toMatchObject({
        status: 'active',
      });

      for (const status of ['suspended', 'pending_deletion'] as const) {
        await controlPlane.setTenantStatus(t.tenantId, status);
        await expect(controlPlane.assertTenantActive(t.tenantId)).rejects.toBeInstanceOf(
          TenantInactiveError,
        );
        expect((await controlPlane.listActiveTenants()).map((x) => x.tenantId)).not.toContain(
          t.tenantId,
        );
        // the tenant row and the registry stay in step
        const row = await tenancy.withTenantTx({ tenantId: t.tenantId }, (trx) =>
          trx.tenant.findFirstOrThrow({ select: { status: true } }),
        );
        expect(row.status).toBe(status);
      }
      await controlPlane.setTenantStatus(t.tenantId, 'active');
      await expect(controlPlane.assertTenantActive(t.tenantId)).resolves.toBeTruthy();
      await expect(controlPlane.assertTenantActive(uuidv7())).rejects.toBeInstanceOf(
        TenantInactiveError,
      );
    });
  });

  describe('seed (M1-REPO-05)', () => {
    it('refuses to run in production', async () => {
      await expect(seedDemoData(tenancy, { nodeEnv: 'production' })).rejects.toBeInstanceOf(
        SeedRefusedError,
      );
    });

    it('creates Acme and Globex with 4 users and 200 assets each, overlapping tags and serials, and is idempotent', async () => {
      const first = await seedDemoData(tenancy, { nodeEnv: 'test' });
      const second = await seedDemoData(tenancy, { nodeEnv: 'test' });
      expect(second.tenants.map((t) => t.seeded)).toEqual([false, false]);
      expect(second.tenants.map((t) => t.tenantId)).toEqual(first.tenants.map((t) => t.tenantId));
      expect(first.tenants.map((t) => t.slug)).toEqual(DEMO_TENANTS.map((t) => t.slug));

      const snapshot = async (tenantId: string) =>
        tenancy.withTenantTx({ tenantId }, async (trx) => ({
          counts: await (async () => {
            const c: Record<string, number> = {};
            for (const t of [
              'app.asset',
              'app.user_account',
              'app.category',
              'app.asset_model',
              'app.custom_field_def',
              'app.status_label',
            ] as const) {
              c[t] = await countOf(trx, t);
            }
            return c;
          })(),
          tags: (
            await trx.asset.findMany({ select: { asset_tag: true }, orderBy: { asset_tag: 'asc' } })
          ).map((r) => r.asset_tag),
          serials: (
            await trx.asset.findMany({ select: { serial: true }, orderBy: { serial: 'asc' } })
          ).map((r) => r.serial),
          roles: (
            await trx.role_assignment.findMany({
              select: { role: { select: { key: true } } },
              orderBy: { role: { key: 'asc' } },
            })
          ).map((r) => r.role.key),
        }));
      const [acme, globex] = [
        await snapshot(first.tenants[0]!.tenantId),
        await snapshot(first.tenants[1]!.tenantId),
      ];
      for (const s of [acme, globex]) {
        expect(s.counts).toMatchObject({
          'app.asset': ASSETS_PER_TENANT,
          'app.user_account': 4,
          'app.status_label': 7,
          'app.asset_model': 18,
          'app.custom_field_def': 12,
        });
        expect(s.roles).toEqual(['asset_manager', 'technician', 'tenant_admin', 'viewer']);
      }
      // M2 wave 1 demo data: a location tree, people, assets with a place, assets checked out
      for (const tenant of first.tenants) {
        await tenancy.withTenantTx({ tenantId: tenant.tenantId }, async (trx) => {
          expect(await countOf(trx, 'app.location')).toBe(18); // 2 sites, 4 buildings, 2 floors, rooms
          expect(await trx.location.count({ where: { parent_id: null } })).toBe(2);
          expect(await trx.location.count({ where: { kind: 'building' } })).toBe(4);
          expect(await trx.location.count({ where: { depth: 3 } })).toBe(5); // rooms under floors
          // 12 people without a login + one person per login account (created by the database)
          expect(await countOf(trx, 'app.person')).toBe(16);
          expect(await trx.person.count({ where: { user_id: null } })).toBe(12);
          expect(await trx.asset.count({ where: { location_id: null } })).toBe(0);
          const open = await trx.assignment.count({ where: { checked_in_at: null } });
          expect(open).toBeGreaterThan(40);
          expect(
            await trx.assignment.count({
              where: { checked_in_at: null, location_id: { not: null } },
            }),
          ).toBeGreaterThan(0);
          const [late] = await trx.$queryRaw<Array<{ n: number }>>`
            select count(*)::int as n from app.assignment
             where checked_in_at is null and expected_return < current_date`;
          expect(late!.n).toBe(3);
          // every asset has a "created" entry; every demo custody period a "checked_out" one
          const [created] = await trx.$queryRaw<Array<{ n: number }>>`
            select count(*)::int as n from app.asset_history where event_type = 'created'`;
          expect(created!.n).toBe(ASSETS_PER_TENANT);
          const [out] = await trx.$queryRaw<Array<{ n: number }>>`
            select count(*)::int as n from app.asset_history where event_type = 'checked_out'`;
          expect(out!.n).toBe(open);
        });
      }
      expect(acme.tags).toEqual(globex.tags); // deliberately overlapping
      expect(acme.serials).toEqual(globex.serials);
      expect(new Set(acme.tags).size).toBe(ASSETS_PER_TENANT);
    });
  });
});
