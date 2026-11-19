import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIdsOnlyPayload } from '../../src/ids/ids-only.js';
import { uuidv7 } from '../../src/ids/uuidv7.js';
import { QUEUES } from '../../src/jobs/index.js';
import { newObjectKey, variantKey } from '../../src/storage/index.js';
import {
  type FixtureTenant,
  createFixtureTenant,
  dbEnabled,
  mode,
  newTenancy,
  sqlState,
} from '../support/db.js';

/**
 * M2-SEC-01 for the file tables, direct and through PgBouncer (the mode is the suite's mode):
 * `app.attachment` is invisible and immutable across tenants, storage keys are tenant-prefixed by a
 * CHECK constraint, an asset or model picture can only point at an attachment of the SAME tenant
 * (composite foreign key), and the new job queues obey the ids-only / tenant-context rules.
 */
describe.skipIf(!dbEnabled)(`attachment isolation (${mode})`, () => {
  const tenancy = newTenancy();
  let A: FixtureTenant;
  let B: FixtureTenant;
  const attA = uuidv7();
  const attB = uuidv7();

  const row = (t: FixtureTenant, id: string, over: Record<string, unknown> = {}) => ({
    id,
    tenant_id: t.id,
    entity_type: 'asset',
    entity_id: t.assetIds[0]!,
    kind: 'document',
    storage_key: newObjectKey(t.id, { objectId: id }),
    filename: `${id}.csv`,
    content_type: 'text/csv',
    size_bytes: 10n,
    ...over,
  });

  beforeAll(async () => {
    A = await createFixtureTenant(tenancy, 'FA');
    B = await createFixtureTenant(tenancy, 'FB');
    await tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
      trx.attachment.create({ data: row(A, attA) }),
    );
    await tenancy.withTenantTx({ tenantId: B.id }, (trx) =>
      trx.attachment.create({ data: row(B, attB) }),
    );
  });
  afterAll(async () => {
    await tenancy.onModuleDestroy();
  });

  it('each tenant sees only its own attachments, and cannot change or delete the other’s', async () => {
    await tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
      const ids = (await trx.attachment.findMany({ select: { id: true } })).map((r) => r.id);
      expect(ids).toEqual([attA]);
      expect(await trx.attachment.findUnique({ where: { id: attB } })).toBeNull();
      expect(
        (await trx.attachment.updateMany({ where: { id: attB }, data: { filename: 'pwned.csv' } }))
          .count,
      ).toBe(0);
    });
    // the runtime role cannot DELETE attachments at all (they are archived, never removed)
    expect(
      await sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
          trx.attachment.deleteMany({ where: { id: attA } }),
        ),
      ),
    ).toBe('42501');
    await tenancy.withTenantTx({ tenantId: B.id }, async (trx) => {
      expect((await trx.attachment.findUnique({ where: { id: attB } }))?.filename).toBe(
        `${attB}.csv`,
      );
    });
  });

  it('a tenant cannot write a row for another tenant (RLS WITH CHECK)', async () => {
    const state = await sqlState(
      tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
        trx.attachment.create({ data: row(B, uuidv7()) }),
      ),
    );
    expect(state).toBeDefined();
  });

  it('storage keys must carry the tenant prefix (CHECK) and are unique per tenant', async () => {
    // a key of tenant B stored on a row of tenant A
    const foreign = uuidv7();
    expect(
      await sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
          trx.attachment.create({
            data: row(A, foreign, { storage_key: newObjectKey(B.id, { objectId: foreign }) }),
          }),
        ),
      ),
    ).toBe('23514');
    // not a key at all
    expect(
      await sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
          trx.attachment.create({ data: row(A, uuidv7(), { storage_key: 'uploads/x' }) }),
        ),
      ),
    ).toBe('23514');
    // the thumbnail key has the same rule
    expect(
      await sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
          trx.attachment.updateMany({
            where: { id: attA },
            data: { thumb_key: variantKey(newObjectKey(B.id), 'thumb') },
          }),
        ),
      ),
    ).toBe('23514');
    // duplicate key within the tenant
    expect(
      await sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
          const existing = await trx.attachment.findUniqueOrThrow({ where: { id: attA } });
          await trx.attachment.create({
            data: row(A, uuidv7(), { storage_key: existing.storage_key }),
          });
        }),
      ),
    ).toBe('23505');
  });

  it('an asset or model picture cannot point at another tenant’s attachment (composite foreign key)', async () => {
    expect(
      await sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
          trx.asset.updateMany({
            where: { id: A.assetIds[0]! },
            data: { image_attachment_id: attB },
          }),
        ),
      ),
    ).toBe('23503');
    await tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
      const model = await trx.asset_model.create({
        data: {
          id: uuidv7(),
          tenant_id: A.id,
          category_id: A.categoryId,
          name: `m-${uuidv7()}`,
        },
      });
      expect(
        await sqlState(
          trx.asset_model.updateMany({
            where: { id: model.id },
            data: { image_attachment_id: attB },
          }),
        ),
      ).toBe('23503');
    });
    // its own is fine
    await tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
      trx.asset.updateMany({ where: { id: A.assetIds[0]! }, data: { image_attachment_id: attA } }),
    );
    await tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
      trx.asset.updateMany({ where: { id: A.assetIds[0]! }, data: { image_attachment_id: null } }),
    );
  });

  it('the status and owner type constraints hold', async () => {
    const bad = (over: Record<string, unknown>) =>
      sqlState(
        tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
          trx.attachment.create({ data: row(A, uuidv7(), over) }),
        ),
      );
    expect(await bad({ scan_status: 'quarantined' })).toBe('23514');
    expect(await bad({ entity_type: 'user_account' })).toBe('23514');
    expect(await bad({ scan_status: 'clean' })).toBe('23514'); // clean needs an upload
    expect(await bad({ entity_type: 'asset_model' })).toBeUndefined();
    expect(await bad({ scan_status: 'clean', uploaded_at: new Date() })).toBeUndefined();
    expect(await bad({ size_bytes: -1n })).toBe('23514');
    expect(await bad({ sha256: 'XYZ' })).toBe('23514');
  });

  it('the file job queues are tenant scoped, run in the worker, and take ids-only payloads', () => {
    for (const name of ['attachment.scan', 'attachment.thumbnail', 'attachment.sweep'] as const) {
      expect(QUEUES[name].tenantScoped, name).toBe(true);
      expect(QUEUES[name].runsIn, name).toBe('worker');
    }
    const ok = { tenantId: A.id, attachmentId: attA };
    expect(() => assertIdsOnlyPayload(ok, 'attachment.scan')).not.toThrow();
    // a file name, a URL or a storage key must never travel in a payload
    for (const bad of [
      { ...ok, filename: 'secret plan.pdf' },
      { ...ok, url: 'https://files.example/x?sig=abc' },
      { ...ok, key: newObjectKey(A.id) },
      { ...ok, token: 'abc' },
    ]) {
      expect(() => assertIdsOnlyPayload(bad, 'attachment.scan')).toThrow();
    }
  });
});
