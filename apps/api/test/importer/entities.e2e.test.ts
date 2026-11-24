import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import {
  type ImportHarness,
  type Json,
  type TenantFixture,
  allRows,
  analyzed,
  auditRows,
  commit,
  contractViolations,
  createTenant,
  csv,
  dryRun,
  mappingOf,
  newTenancy,
  patchImport,
  registryCounts,
  startImportApp,
} from './support.js';

/** M2-IMP-07: people, locations and departments, with parent resolution and the recommended order. */
describe.skipIf(!dbEnabled)(`people, location and department imports (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let t: TenantFixture;
  const admin = () => t.admin;

  beforeAll(async () => {
    ih = await startImportApp();
    t = await createTenant(ih.h.app, tenancy, 'impent');
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  async function run(
    entity: string,
    body: string,
    create: Record<string, unknown> = {},
    patch?: Record<string, unknown>,
  ) {
    const job = await analyzed(
      ih,
      admin(),
      t.tenantId,
      entity,
      { filename: `${entity}.csv`, body },
      create,
    );
    expect(job.state, job.error ?? '').toBe('analyzed');
    if (patch) {
      const res = await patchImport(admin(), job.id, patch);
      expect(res.status, res.raw).toBe(200);
    }
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.state, dry.error ?? '').toBe('dry_run_done');
    return { job, dry };
  }

  it('imports a location tree from paths in any order; parents are created; a re-import is a no-op', async () => {
    const body = csv([
      ['Path', 'Kind', 'Code', 'City', 'Country', 'Notes'],
      ['HQ > Building 2 > Room 14', 'room', 'HQ-B2-14', '', '', 'Store room'],
      ['HQ', 'site', 'HQ', 'Oslo', 'no', ''],
      ['HQ > Building 2', 'building', 'HQ-B2', '', '', ''],
      ['Warehouse', 'site', '', 'Bergen', 'NO', ''],
      ['HQ > Building 2 > Room 14', 'room', 'DUP', '', '', ''],
    ]);
    const before = await registryCounts(t.tenantId);
    const { job, dry } = await run('location', body);
    expect(await registryCounts(t.tenantId)).toEqual(before);
    expect(dry.counts.dry_run).toEqual({ create: 4, update: 0, skip: 1, error: 0 });
    expect(dry.summary.will_create.map((w: Json) => w.message)).toContain(
      'Will create location "HQ"',
    );
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    // HQ and Building 2 were created as parents of the first row; their own rows then filled them in
    expect(fin.counts.commit).toEqual({ created: 2, updated: 2, skipped: 1, error: 0 });
    const locs = (await admin().get('/v1/locations?limit=100')).body.data as Json[];
    const byName = Object.fromEntries(locs.map((l) => [l.name, l]));
    expect(byName['Room 14']).toMatchObject({
      kind: 'room',
      code: 'HQ-B2-14',
      depth: 2,
      notes: 'Store room',
    });
    expect(byName.HQ).toMatchObject({
      kind: 'site',
      depth: 0,
      address: expect.objectContaining({ city: 'Oslo', country: 'NO' }),
    });
    expect(byName['Building 2'].parent_id).toBe(byName.HQ.id);
    expect(byName.Room14).toBeUndefined();
    // the same file again: everything exists, nothing changes
    const again = await run('location', body, {}, undefined);
    expect(again.dry.counts.dry_run.create).toBe(0);
    // an update changes the cells of the file only (the address merges)
    const upd = await run(
      'location',
      csv([
        ['Path', 'City'],
        ['HQ', 'Trondheim'],
      ]),
      { options: { on_match: 'update' } },
    );
    expect(upd.dry.counts.dry_run).toEqual({ create: 0, update: 1, skip: 0, error: 0 });
    const done = await commit(ih, admin(), t.tenantId, upd.job.id, upd.dry.dry_run_digest);
    expect(done.counts.commit.updated).toBe(1);
    const hq = (await admin().get(`/v1/locations/${byName.HQ.id}`)).body;
    expect(hq.address).toMatchObject({ city: 'Trondheim', country: 'NO' });
    expect(hq.kind).toBe('site');
    // the before-image of the update is kept
    const rows = await allRows(admin(), upd.job.id);
    expect(rows[0]!.before_image).toMatchObject({
      address: expect.objectContaining({ city: 'Oslo' }),
    });
    // import rows are audited with the job
    const audit = await auditRows(
      t.tenantId,
      `diff->'meta'->>'import_job_id' = '${upd.job.id}' and action = 'location.updated'`,
    );
    expect(audit).toHaveLength(1);
  });

  it('validates locations like the API: too deep, bad country, bad kind', async () => {
    const deep = Array.from({ length: 11 }, (_, i) => `L${i}`).join(' > ');
    const { dry, job } = await run(
      'location',
      csv([
        ['Path', 'Kind', 'Country'],
        [deep, '', ''],
        ['Okay > Fine', 'castle', ''],
        ['X > Y', 'room', 'Norway'],
      ]),
    );
    expect(dry.counts.dry_run.error).toBe(3);
    const rows = await allRows(admin(), job.id);
    expect(rows[0]!.errors[0].message).toMatch(/level|deep/i);
    expect(rows[1]!.errors[0]).toMatchObject({ field: 'kind', code: 'enum' });
    expect(rows[2]!.errors[0]).toMatchObject({ field: 'country' });
  });

  it('imports departments and people, matching existing ones; the manager and department are references', async () => {
    const dep = await run(
      'department',
      csv([
        ['Name', 'Code', 'Description'],
        ['Finance', 'CC-100', 'Money'],
        ['IT', 'CC-200', ''],
        ['finance ', 'CC-300', 'dup'],
      ]),
    );
    expect(dep.dry.counts.dry_run).toEqual({ create: 2, update: 0, skip: 1, error: 0 });
    await commit(ih, admin(), t.tenantId, dep.job.id, dep.dry.dry_run_digest);
    expect(
      ((await admin().get('/v1/departments?limit=50')).body.data as Json[])
        .map((d) => d.name)
        .sort(),
    ).toEqual(expect.arrayContaining(['Finance', 'IT']));

    const people = csv([
      ['Name', 'Email', 'Employee number', 'Department', 'Kind', 'Location', 'Job title'],
      [
        'Anna Berg',
        'Anna.Berg@Example.com',
        'E-1',
        'Finance',
        'employee',
        'HQ > Building 2',
        'Accountant',
      ],
      ['Omar Haddad', 'omar@example.com', 'E-2', 'Marketing', 'contractor', '', ''],
      ['', 'no.name@example.com', '', 'IT', '', '', ''],
      ['Anna Again', 'anna.berg@example.com', 'E-9', '', '', '', ''],
      ['Bad Email', 'not-an-email', '', '', '', '', ''],
    ]);
    const { job, dry } = await run('person', people, {
      options: { references: { department: 'create' } },
    });
    const rows = await allRows(admin(), job.id);
    expect(rows.map((r) => r.outcome)).toEqual(['create', 'create', 'create', 'skip', 'error']);
    expect(rows[3]!.warnings[0].code).toBe('duplicate-in-file');
    expect(rows[4]!.errors[0]).toMatchObject({ field: 'email' });
    expect(dry.summary.will_create.map((w: Json) => w.message)).toContain(
      'Will create department "Marketing"',
    );
    const fin = await commit(ih, admin(), t.tenantId, job.id, dry.dry_run_digest);
    expect(fin.counts.commit).toEqual({ created: 3, updated: 0, skipped: 1, error: 1 });
    const anna = ((await admin().get('/v1/people?q=anna&limit=5')).body.data as Json[])[0]!;
    expect(anna).toMatchObject({
      email: 'anna.berg@example.com',
      department: 'Finance',
      employee_ref: 'E-1',
    });
    const noName = ((await admin().get('/v1/people?q=no.name&limit=5')).body.data as Json[])[0]!;
    expect(noName.display_name).toBe('no.name'); // built from the email

    // a second run updates by email, leaves blank cells alone, and reports "unchanged" rows as skipped
    const upd = await run(
      'person',
      csv([
        ['Email', 'Phone', 'Job title'],
        ['omar@example.com', '+47 1', ''],
        ['anna.berg@example.com', '', 'Accountant'],
      ]),
      { options: { on_match: 'update' } },
    );
    expect(upd.dry.counts.dry_run).toEqual({ create: 0, update: 1, skip: 1, error: 0 });
    await commit(ih, admin(), t.tenantId, upd.job.id, upd.dry.dry_run_digest);
    const omar = ((await admin().get('/v1/people?q=omar&limit=5')).body.data as Json[])[0]!;
    expect(omar).toMatchObject({ phone: '+47 1', kind: 'contractor' });

    // managers are people, found by email
    const mgr = await run(
      'department',
      csv([
        ['Name', 'Manager'],
        ['Finance', 'anna.berg@example.com'],
        ['Legal', 'nobody@example.com'],
      ]),
      { options: { on_match: 'update' } },
    );
    expect(mgr.dry.counts.dry_run).toEqual({ create: 0, update: 1, skip: 0, error: 1 });
    const mrows = await allRows(admin(), mgr.job.id);
    expect(mrows[1]!.errors[0]).toMatchObject({ field: 'manager', code: 'not-found' });
  });

  it('warns about references that are missing when the recommended order is not followed', async () => {
    // an asset import naming a person and a location that do not exist yet
    const body = csv([
      ['Serial', 'Category', 'Assigned To', 'Location'],
      ['ORD-1', 'Laptops', 'ghost@example.com', 'Nowhere > Atlantis'],
    ]);
    const job = await analyzed(ih, admin(), t.tenantId, 'asset', { filename: 'assets.csv', body });
    const patched = await patchImport(admin(), job.id, {
      options: { references: { location: 'must_exist' } },
    });
    expect(patched.status).toBe(200);
    const dry = await dryRun(ih, admin(), t.tenantId, job.id);
    expect(dry.counts.dry_run.error).toBe(1);
    const rows = await allRows(admin(), job.id);
    expect(rows[0]!.errors[0]).toMatchObject({ field: 'location', code: 'not-found' });
    expect(rows[0]!.errors[0].message).toMatch(/Create it first/);
    // a missing person alone is a warning: the asset is still imported, unassigned
    const ok = await patchImport(admin(), job.id, {
      options: { references: { location: 'create' } },
    });
    expect(ok.status).toBe(200);
    const dry2 = await dryRun(ih, admin(), t.tenantId, job.id);
    const rows2 = await allRows(admin(), job.id);
    expect(dry2.counts.dry_run.create).toBe(1);
    expect(rows2[0]!.warnings.map((w: Json) => w.code)).toEqual(
      expect.arrayContaining(['not-found']),
    );
    expect(mappingOf(job, { Serial: 'serial' }).columns).toHaveLength(job.headers.length);
  });
});
