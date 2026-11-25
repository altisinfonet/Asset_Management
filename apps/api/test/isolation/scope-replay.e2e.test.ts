import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { discoverRoutes } from '../support/routes.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from '../registry/support.js';
import { createScopedUser } from '../scoping/support.js';

/** A JSON body as the test client returns it (untyped on purpose). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/**
 * M2-LOC-03 SCOPED ROUTE REPLAY (ED-26). The companion of `route-replay.e2e.test.ts`: the same
 * organisation holds two sites, "In" and "Out". Every HTTP route of the application is replayed by a
 * LOCATION ADMINISTRATOR (the built-in Administrator role, `*`, assigned with `scope_type=location`
 * to "In") against records at "Out" and records with no location at all. Each replay must answer
 * 404 (path id outside the scope), refuse the write (422: the target does not exist for them), 403
 * (an org-only permission, which a scoped assignment never grants), or return a list that contains
 * none of the out-of-scope data. The suite FAILS when a route has neither a replay case nor a reasoned
 * exemption, so a new route cannot ship unscoped. It runs in direct and in pooled mode.
 *
 * "Never a data leak": no response, whatever its status, may contain a marker of the out-of-scope
 * records (ids, tags, serials, label codes, names, emails), and after the replay those records still
 * have the versions they had (no write outside the scope). Tenant-wide catalogue records (categories,
 * models, status labels, departments, templates) are visible to everybody by design and carry no marker.
 */
describe.skipIf(!dbEnabled)(
  `scoped route replay: a location administrator against another site (${mode})`,
  () => {
    const tenancy = newTenancy();
    let app: App;
    let t: TenantFixture;
    let scoped: Client;
    let fx: Fx;

    interface Fx {
      categoryId: string;
      accCategoryId: string;
      conCategoryId: string;
      modelId: string;
      statusLabelId: string;
      departmentId: string;
      siteIn: string;
      siteOut: string;
      siteOutName: string;
      // outside the scope (at "Out", or nowhere)
      assetOut: string;
      assetOutTag: string;
      assetOutSerial: string;
      assetOutLabel: string;
      assetNone: string;
      assetNoneTag: string;
      personOut: string;
      personOutEmail: string;
      personNone: string;
      accOut: string;
      accOutLabel: string;
      accAssignmentOut: string;
      conOut: string;
      conOutLabel: string;
      poolOut: string;
      loanerOut: string;
      loanOut: string;
      repairOut: string;
      repairAssetOut: string;
      attachmentOut: string;
      // the administrator's own (personal) records
      adminBatch: string;
      adminExport: string;
      adminImport: string;
      adminNotification: string;
      adminPrivateView: string;
      sharedView: string;
      importTemplate: string;
      adminSession: string;
      adminUserId: string;
      adminKey: string;
      roleId: string;
      // inside the scope, for "own record pointing outside" cases
      assetIn: string;
      personIn: string;
      accIn: string;
      conIn: string;
      poolIn: string;
      markers: string[];
    }

    interface Replay {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      url: string;
      body?: unknown;
      expect: number[];
      headers?: Record<string, string>;
    }

    const notFound = (method: Replay['method'], url: string, body?: unknown): Replay => ({
      method,
      url,
      body,
      expect: [404],
    });
    const list = (url: string): Replay => ({ method: 'GET', url, expect: [200] });
    const ok = (method: Replay['method'], url: string, body?: unknown, status = 200): Replay => ({
      method,
      url,
      body,
      expect: [status],
    });
    const refused = (method: Replay['method'], url: string, body: unknown): Replay => ({
      method,
      url,
      body,
      expect: [404, 422],
    });
    /** An org-only permission (users, roles, keys, catalogue and department management, rules). */
    const orgOnly = (method: Replay['method'], url: string, body?: unknown): Replay => ({
      method,
      url,
      body,
      expect: [403],
    });
    let keyN = 0;
    const keyed = (url: string, body: unknown, expect: number[] = [404]): Replay => ({
      method: 'POST',
      url,
      body,
      expect,
      headers: { 'idempotency-key': `scope-replay-${Date.now()}-${keyN++}` },
    });

    const cases = (): Record<string, Replay[]> => {
      const c = fx;
      const catalogue = (path: string, id: string, patch: unknown): Record<string, Replay[]> => ({
        [`get /v1/${path}/:id`]: [ok('GET', `/v1/${path}/${id}`)],
        [`patch /v1/${path}/:id`]: [orgOnly('PATCH', `/v1/${path}/${id}`, patch)],
        [`delete /v1/${path}/:id`]: [orgOnly('DELETE', `/v1/${path}/${id}`)],
      });
      const scopedCrud = (
        path: string,
        ids: string[],
        patch: unknown,
      ): Record<string, Replay[]> => ({
        [`get /v1/${path}/:id`]: ids.map((id) => notFound('GET', `/v1/${path}/${id}`)),
        [`patch /v1/${path}/:id`]: ids.map((id) => notFound('PATCH', `/v1/${path}/${id}`, patch)),
        [`delete /v1/${path}/:id`]: ids.map((id) => notFound('DELETE', `/v1/${path}/${id}`)),
      });
      return {
        // ---- the tenant-wide catalogue: readable, never changed by a scoped assignment
        ...catalogue('categories', c.categoryId, { description: 'scoped was here' }),
        ...catalogue('manufacturers', randomUUID(), { notes: 'x' }),
        ...catalogue('models', c.modelId, { notes: 'scoped was here' }),
        ...catalogue('status-labels', c.statusLabelId, { description: 'scoped was here' }),
        ...catalogue('vendors', randomUUID(), { notes: 'x' }),
        ...catalogue('custom-fields', randomUUID(), { label: 'x' }),
        ...catalogue('departments', c.departmentId, { description: 'scoped was here' }),
        'get /v1/manufacturers/:id': [notFound('GET', `/v1/manufacturers/${randomUUID()}`)],
        'get /v1/vendors/:id': [notFound('GET', `/v1/vendors/${randomUUID()}`)],
        'get /v1/custom-fields/:id': [notFound('GET', `/v1/custom-fields/${randomUUID()}`)],
        'get /v1/categories': [list('/v1/categories?limit=200')],
        'post /v1/categories': [orgOnly('POST', '/v1/categories', { name: unique('S') })],
        'get /v1/manufacturers': [list('/v1/manufacturers?limit=200')],
        'post /v1/manufacturers': [orgOnly('POST', '/v1/manufacturers', { name: unique('S') })],
        'get /v1/models': [list('/v1/models?limit=200')],
        'post /v1/models': [
          orgOnly('POST', '/v1/models', { category_id: c.categoryId, name: unique('S') }),
        ],
        'get /v1/status-labels': [list('/v1/status-labels')],
        'post /v1/status-labels': [
          orgOnly('POST', '/v1/status-labels', { name: unique('S'), state_type: 'pending' }),
        ],
        'get /v1/vendors': [list('/v1/vendors?limit=200')],
        'post /v1/vendors': [orgOnly('POST', '/v1/vendors', { name: unique('S') })],
        'get /v1/custom-fields': [list('/v1/custom-fields')],
        'post /v1/custom-fields': [
          orgOnly('POST', '/v1/custom-fields', {
            category_id: c.categoryId,
            key: 'x',
            label: 'x',
            data_type: 'text',
          }),
        ],
        'get /v1/departments': [list('/v1/departments?limit=200&archived=include')],
        'post /v1/departments': [orgOnly('POST', '/v1/departments', { name: unique('S') })],
        'get /v1/settings/asset-tag-template': [list('/v1/settings/asset-tag-template')],
        'put /v1/settings/asset-tag-template': [
          orgOnly('PUT', '/v1/settings/asset-tag-template', {
            prefix: 'SS-',
            width: 4,
            use_category_prefix: false,
          }),
        ],
        'get /v1/settings/files': [list('/v1/settings/files')],
        'put /v1/settings/files': [
          orgOnly('PUT', '/v1/settings/files', { strip_exif_original: true }),
        ],
        'get /v1/settings/custody': [list('/v1/settings/custody')],
        'put /v1/settings/custody': [
          orgOnly('PUT', '/v1/settings/custody', { default_expected_return_days: 3 }),
        ],
        'get /v1/companies': [list('/v1/companies')],

        // ---- assets
        ...scopedCrud('assets', [c.assetOut, c.assetNone], { name: 'scoped was here' }),
        'get /v1/assets': [
          list(`/v1/assets?tag=${c.assetOutTag}`),
          list(`/v1/assets?serial=${c.assetOutSerial}`),
          list(`/v1/assets?tag=${c.assetNoneTag}`),
          list(`/v1/assets?category_id=${c.categoryId}&limit=200`),
          list(`/v1/assets?location_id=${c.siteOut}`),
          list(`/v1/assets?location_id=${c.siteOut}&include_sublocations=false`),
          list(`/v1/assets?assigned_person_id=${c.personOut}`),
          list(`/v1/assets?department_id=${c.departmentId}&expand=location,department`),
          list(`/v1/assets?loaner_pool_id=${c.poolOut}`),
          list('/v1/assets?limit=200&archived=include&include_total=true'),
          list('/v1/assets?assigned=true&limit=200&sort=location'),
          list('/v1/assets?in_loaner_pool=true&limit=200&sort=assignee'),
        ],
        'post /v1/assets': [
          refused('POST', '/v1/assets', { category_id: c.categoryId, location_id: c.siteOut }),
          refused('POST', '/v1/assets', { category_id: c.categoryId }),
          refused('POST', '/v1/assets', {
            category_id: c.categoryId,
            location_id: c.siteIn,
            parent_asset_id: c.assetOut,
          }),
        ],
        'post /v1/assets/:id/restore': [notFound('POST', `/v1/assets/${c.assetOut}/restore`)],
        'post /v1/assets/:id/clone': [
          notFound('POST', `/v1/assets/${c.assetOut}/clone`, { count: 1 }),
        ],
        'post /v1/assets/bulk-update': [
          ok('POST', '/v1/assets/bulk-update', {
            ids: [c.assetOut, c.assetNone],
            changes: { department_id: null },
          }),
        ],
        'post /v1/assets/bulk-archive': [
          ok('POST', '/v1/assets/bulk-archive', { ids: [c.assetOut, c.assetNone] }),
        ],
        'post /v1/assets/bulk-restore': [
          ok('POST', '/v1/assets/bulk-restore', { ids: [c.assetOut] }),
        ],
        'post /v1/assets/bulk-move': [
          ok('POST', '/v1/assets/bulk-move', {
            ids: [c.assetOut, c.assetNone],
            location_id: c.siteIn,
          }),
        ],
        'post /v1/assets/:id/move': [
          notFound('POST', `/v1/assets/${c.assetOut}/move`, { location_id: c.siteIn }),
          notFound('POST', `/v1/assets/${c.assetNone}/move`, { location_id: c.siteIn }),
          refused('POST', `/v1/assets/${c.assetIn}/move`, { location_id: c.siteOut }),
          refused('POST', `/v1/assets/${c.assetIn}/move`, { location_id: null }),
        ],
        'post /v1/assets/:id/dispose': [
          notFound('POST', `/v1/assets/${c.assetOut}/dispose`, { reason: 'scrapped' }),
        ],
        'post /v1/assets/:id/mark-lost': [
          notFound('POST', `/v1/assets/${c.assetOut}/mark-lost`, {}),
        ],
        'post /v1/assets/:id/mark-found': [
          notFound('POST', `/v1/assets/${c.assetOut}/mark-found`, {}),
          // (the state check answers first: their asset is not lost; nothing outside is revealed)
          {
            method: 'POST',
            url: `/v1/assets/${c.assetIn}/mark-found`,
            body: { location_id: c.siteOut },
            expect: [409, 422],
          },
        ],
        'get /v1/assets/:id/assignments': [notFound('GET', `/v1/assets/${c.assetOut}/assignments`)],
        'get /v1/assets/:id/history': [notFound('GET', `/v1/assets/${c.assetOut}/history`)],
        'get /v1/assets/:id/repair-summary': [
          notFound('GET', `/v1/assets/${c.repairAssetOut}/repair-summary`),
        ],
        'get /v1/scan/resolve': [
          notFound('GET', `/v1/scan/resolve?code=${c.assetOutTag}`),
          notFound('GET', `/v1/scan/resolve?code=${c.assetOutLabel}`),
          notFound('GET', `/v1/scan/resolve?code=${c.assetOutSerial}`),
          notFound('GET', `/v1/scan/resolve?code=${c.assetNoneTag}`),
          notFound('GET', `/v1/scan/resolve?code=${c.accOutLabel}`),
          notFound('GET', `/v1/scan/resolve?code=${c.conOutLabel}`),
          notFound(
            'GET',
            `/v1/scan/resolve?code=${encodeURIComponent(`https://app.example/a/${c.assetOutLabel}`)}`,
          ),
        ],
        'get /v1/search': [
          list(`/v1/search?q=${c.assetOutTag}`),
          list(`/v1/search?q=${c.assetOutSerial}`),
          list(`/v1/search?q=${c.personOutEmail}`),
          list(`/v1/search?q=${encodeURIComponent(c.siteOutName)}&types=location,person,asset`),
        ],

        // ---- custody
        'post /v1/assets/:id/checkout': [
          keyed(`/v1/assets/${c.assetOut}/checkout`, { person_id: c.personIn }),
          keyed(`/v1/assets/${c.assetNone}/checkout`, { person_id: c.personIn }),
        ],
        'post /v1/assets/:id/checkin': [keyed(`/v1/assets/${c.assetOut}/checkin`, {})],
        'post /v1/assets/:id/transfer': [
          keyed(`/v1/assets/${c.assetOut}/transfer`, { person_id: c.personIn }),
          // their own asset (checked out inside the scope) to people and places outside it
          keyed(`/v1/assets/${c.assetIn}/transfer`, { person_id: c.personOut }, [422]),
          keyed(`/v1/assets/${c.assetIn}/transfer`, { person_id: c.personNone }, [422]),
          keyed(`/v1/assets/${c.assetIn}/transfer`, { location_id: c.siteOut }, [422]),
          keyed(`/v1/assets/${c.assetIn}/transfer`, { target_asset_id: c.assetOut }, [422]),
          keyed(
            `/v1/assets/${c.assetIn}/transfer`,
            { person_id: c.personIn, to_location_id: c.siteOut },
            [422],
          ),
        ],
        'post /v1/assets/:id/undo-custody': [
          {
            ...keyed(`/v1/assets/${c.assetOut}/undo-custody`, { assignment_id: randomUUID() }),
            headers: {
              'idempotency-key': `scope-undo-${Date.now()}-${keyN++}`,
              'if-match': 'W/"1"',
            },
          },
        ],

        // ---- files
        'get /v1/attachments': [
          list(`/v1/attachments?entity_type=asset&entity_id=${c.assetOut}`),
          list(`/v1/attachments?entity_type=person&entity_id=${c.personOut}`),
          list(`/v1/attachments?entity_type=location&entity_id=${c.siteOut}`),
          list(`/v1/attachments?entity_type=maintenance_record&entity_id=${c.repairOut}`),
          list(`/v1/attachments?entity_type=import_job&entity_id=${c.adminImport}`),
        ],
        'post /v1/attachments': [
          refused('POST', '/v1/attachments', {
            entity_type: 'asset',
            entity_id: c.assetOut,
            filename: 'x.png',
            content_type: 'image/png',
            size_bytes: 10,
          }),
          refused('POST', '/v1/attachments', {
            entity_type: 'accessory',
            entity_id: c.accOut,
            filename: 'x.png',
            content_type: 'image/png',
            size_bytes: 10,
          }),
          refused('POST', '/v1/attachments', {
            entity_type: 'import_job',
            entity_id: c.adminImport,
            filename: 'x.csv',
            content_type: 'text/csv',
            size_bytes: 10,
            kind: 'import_file',
          }),
        ],
        'get /v1/attachments/:id': [notFound('GET', `/v1/attachments/${c.attachmentOut}`)],
        'post /v1/attachments/:id/complete': [
          notFound('POST', `/v1/attachments/${c.attachmentOut}/complete`),
        ],
        'delete /v1/attachments/:id': [notFound('DELETE', `/v1/attachments/${c.attachmentOut}`)],

        // ---- labels
        'get /v1/labels/templates': [list('/v1/labels/templates')],
        'get /v1/labels/templates/:id': [list(`/v1/labels/templates/${randomUUID()}`)].map((r) => ({
          ...r,
          expect: [404],
        })),
        'patch /v1/labels/templates/:id': [
          orgOnly('PATCH', `/v1/labels/templates/${randomUUID()}`, { offset_x_mm: 2 }),
        ],
        'post /v1/labels/batches': [
          keyed(
            '/v1/labels/batches',
            { template_key: 'letter-30up-qr', asset_ids: [c.assetOut] },
            [422],
          ),
          keyed(
            '/v1/labels/batches',
            { template_key: 'letter-30up-qr', filter: { tag: c.assetOutTag } },
            [422],
          ),
          keyed(
            '/v1/labels/batches',
            { template_key: 'letter-30up-qr', asset_ids: [c.assetIn] },
            [202],
          ),
        ],
        'get /v1/labels/batches': [list('/v1/labels/batches?limit=200')],
        'get /v1/labels/batches/:id': [notFound('GET', `/v1/labels/batches/${c.adminBatch}`)],

        // ---- locations
        ...scopedCrud('locations', [c.siteOut], { notes: 'scoped was here' }),
        'get /v1/locations': [
          list('/v1/locations?limit=200&archived=include'),
          list(`/v1/locations?parent_id=${c.siteOut}`),
          list(`/v1/locations?descendants_of=${c.siteOut}`),
          list('/v1/locations?root=true'),
          list(`/v1/locations?q=${encodeURIComponent(c.siteOutName)}`),
        ],
        'post /v1/locations': [
          refused('POST', '/v1/locations', { name: unique('S'), parent_id: c.siteOut }),
          refused('POST', '/v1/locations', { name: unique('S') }),
          ok('POST', '/v1/locations', { name: unique('S-own'), parent_id: c.siteIn }, 201),
        ],

        // ---- people
        ...scopedCrud('people', [c.personOut, c.personNone], { notes: 'scoped was here' }),
        'get /v1/people': [
          list('/v1/people?limit=200&archived=include'),
          list(`/v1/people?q=${c.personOutEmail}`),
          list(`/v1/people?location_id=${c.siteOut}`),
          list(`/v1/people?department_id=${c.departmentId}`),
        ],
        'post /v1/people': [
          refused('POST', '/v1/people', { display_name: unique('S'), location_id: c.siteOut }),
          refused('POST', '/v1/people', { display_name: unique('S') }),
          ok('POST', '/v1/people', { display_name: unique('S-own'), location_id: c.siteIn }, 201),
        ],
        'post /v1/people/:id/link-user': [
          orgOnly('POST', `/v1/people/${c.personOut}/link-user`, { user_id: c.adminUserId }),
        ],
        'delete /v1/people/:id/link-user': [
          orgOnly('DELETE', `/v1/people/${c.personOut}/link-user`),
        ],
        'get /v1/people/:id/assignments': [
          notFound('GET', `/v1/people/${c.personOut}/assignments?state=all`),
          // a person inside the scope lists none of the items outside it
          list(`/v1/people/${c.personIn}/assignments?state=all`),
        ],
        'get /v1/people/:id/history': [
          notFound('GET', `/v1/people/${c.personOut}/history`),
          list(`/v1/people/${c.personIn}/history`),
        ],
        'get /v1/people/:id/stock-movements': [
          notFound('GET', `/v1/people/${c.personOut}/stock-movements`),
          list(`/v1/people/${c.personIn}/stock-movements`),
        ],

        // ---- stock
        ...scopedCrud('accessories', [c.accOut], { notes: 'scoped was here' }),
        'get /v1/accessories': [
          list('/v1/accessories?limit=200&archived=include'),
          list(`/v1/accessories?location_id=${c.siteOut}`),
          list(`/v1/accessories?category_id=${c.accCategoryId}&low_stock=false`),
        ],
        'post /v1/accessories': [
          refused('POST', '/v1/accessories', {
            category_id: c.accCategoryId,
            name: unique('S'),
            qty_total: 1,
            location_id: c.siteOut,
          }),
          refused('POST', '/v1/accessories', {
            category_id: c.accCategoryId,
            name: unique('S'),
            qty_total: 1,
          }),
        ],
        'post /v1/accessories/:id/checkout': [
          keyed(`/v1/accessories/${c.accOut}/checkout`, { person_id: c.personIn }),
          keyed(`/v1/accessories/${c.accIn}/checkout`, { person_id: c.personOut }, [422]),
          keyed(`/v1/accessories/${c.accIn}/checkout`, { location_id: c.siteOut }, [422]),
          keyed(`/v1/accessories/${c.accIn}/checkout`, { target_asset_id: c.assetOut }, [422]),
        ],
        'post /v1/accessories/:id/checkin': [
          keyed(`/v1/accessories/${c.accOut}/checkin`, { assignment_id: c.accAssignmentOut }),
          keyed(`/v1/accessories/${c.accIn}/checkin`, { assignment_id: c.accAssignmentOut }, [422]),
        ],
        'get /v1/accessories/:id/assignments': [
          notFound('GET', `/v1/accessories/${c.accOut}/assignments?state=all`),
        ],
        ...scopedCrud('consumables', [c.conOut], { notes: 'scoped was here' }),
        'get /v1/consumables': [
          list('/v1/consumables?limit=200&archived=include'),
          list(`/v1/consumables?location_id=${c.siteOut}`),
          list('/v1/consumables?low_stock=true'),
        ],
        'post /v1/consumables': [
          refused('POST', '/v1/consumables', {
            category_id: c.conCategoryId,
            name: unique('S'),
            location_id: c.siteOut,
          }),
          refused('POST', '/v1/consumables', { category_id: c.conCategoryId, name: unique('S') }),
        ],
        'get /v1/consumables/:id/movements': [
          notFound('GET', `/v1/consumables/${c.conOut}/movements`),
          list(`/v1/consumables/${c.conIn}/movements?person_id=${c.personOut}`),
        ],
        'post /v1/consumables/:id/movements': [
          keyed(`/v1/consumables/${c.conOut}/movements`, { qty_delta: -1, reason: 'issue' }),
          keyed(
            `/v1/consumables/${c.conIn}/movements`,
            { qty_delta: -1, reason: 'issue', person_id: c.personOut },
            [422],
          ),
        ],

        // ---- loaners
        ...scopedCrud('loaner-pools', [c.poolOut], { description: 'scoped was here' }),
        'get /v1/loaner-pools': [
          list('/v1/loaner-pools?limit=200&archived=include'),
          list(`/v1/loaner-pools?home_location_id=${c.siteOut}`),
        ],
        'post /v1/loaner-pools': [
          refused('POST', '/v1/loaner-pools', { name: unique('S'), home_location_id: c.siteOut }),
          refused('POST', '/v1/loaner-pools', { name: unique('S') }),
        ],
        'get /v1/loaner-pools/:id/members': [
          notFound('GET', `/v1/loaner-pools/${c.poolOut}/members`),
        ],
        'post /v1/loaner-pools/:id/members': [
          notFound('POST', `/v1/loaner-pools/${c.poolOut}/members`, { asset_id: c.assetIn }),
          refused('POST', `/v1/loaner-pools/${c.poolIn}/members`, { asset_id: c.assetOut }),
        ],
        'post /v1/loaner-pools/:id/members/bulk-add': [
          notFound('POST', `/v1/loaner-pools/${c.poolOut}/members/bulk-add`, { ids: [c.assetIn] }),
          ok('POST', `/v1/loaner-pools/${c.poolIn}/members/bulk-add`, { ids: [c.assetOut] }),
        ],
        'post /v1/loaner-pools/:id/members/bulk-remove': [
          notFound('POST', `/v1/loaner-pools/${c.poolOut}/members/bulk-remove`, {
            ids: [c.loanerOut],
          }),
          ok('POST', `/v1/loaner-pools/${c.poolIn}/members/bulk-remove`, { ids: [c.loanerOut] }),
        ],
        'delete /v1/loaner-pools/:id/members/:asset_id': [
          notFound('DELETE', `/v1/loaner-pools/${c.poolOut}/members/${c.loanerOut}`),
          notFound('DELETE', `/v1/loaner-pools/${c.poolIn}/members/${c.loanerOut}`),
        ],
        'post /v1/loaner-pools/:id/checkout': [
          keyed(`/v1/loaner-pools/${c.poolOut}/checkout`, { person_id: c.personIn }),
          keyed(`/v1/loaner-pools/${c.poolIn}/checkout`, { person_id: c.personOut }, [422]),
          keyed(
            `/v1/loaner-pools/${c.poolIn}/checkout`,
            { person_id: c.personIn, asset_id: c.loanerOut },
            [422],
          ),
        ],
        'post /v1/loaner-pools/:id/quick-checkout': [
          keyed(`/v1/loaner-pools/${c.poolOut}/quick-checkout`, {
            person_id: c.personIn,
            codes: ['no-such-code'],
          }),
          keyed(
            `/v1/loaner-pools/${c.poolIn}/quick-checkout`,
            { person_id: c.personOut, codes: ['no-such-code'] },
            [422],
          ),
          keyed(
            `/v1/loaner-pools/${c.poolIn}/quick-checkout`,
            { borrower: c.personOutEmail, codes: ['no-such-code'] },
            [422],
          ),
          // the scanned code of a device outside the scope: that item is a 404, the request is fine
          keyed(
            `/v1/loaner-pools/${c.poolIn}/quick-checkout`,
            { person_id: c.personIn, codes: [c.assetOutTag] },
            [200],
          ),
        ],
        'get /v1/loans': [
          list(`/v1/loans?loaner_pool_id=${c.poolOut}`),
          list(`/v1/loans?person_id=${c.personOut}&state=on_loan,due_today,overdue,returned`),
          list('/v1/loans?limit=200&include_total=true&state=on_loan,due_today,overdue,returned'),
        ],
        'get /v1/loans/overdue': [list('/v1/loans/overdue?limit=200')],
        'post /v1/loans/return': [keyed('/v1/loans/return', { codes: [c.assetOutTag] }, [200])],
        'get /v1/loans/:id': [notFound('GET', `/v1/loans/${c.loanOut}`)],
        'post /v1/loans/:id/extend': [
          notFound('POST', `/v1/loans/${c.loanOut}/extend`, { expected_return: '2099-01-01' }),
        ],
        'get /v1/loaners/dashboard': [list('/v1/loaners/dashboard')],

        // ---- repairs
        'get /v1/repairs': [
          list('/v1/repairs?limit=200&archived=include'),
          list(`/v1/repairs?asset_id=${c.repairAssetOut}`),
        ],
        'post /v1/repairs': [
          refused('POST', '/v1/repairs', { asset_id: c.repairAssetOut, title: 'x' }),
          refused('POST', '/v1/repairs', {
            asset_id: c.assetIn,
            title: 'x',
            performed_by_person_id: c.personOut,
          }),
        ],
        'get /v1/repairs/:id': [notFound('GET', `/v1/repairs/${c.repairOut}`)],
        'patch /v1/repairs/:id': [
          notFound('PATCH', `/v1/repairs/${c.repairOut}`, { description: 'x' }),
        ],
        'delete /v1/repairs/:id': [notFound('DELETE', `/v1/repairs/${c.repairOut}`)],
        'post /v1/repairs/:id/complete': [
          notFound('POST', `/v1/repairs/${c.repairOut}/complete`, { resolution_notes: 'x' }),
        ],

        // ---- notifications (personal) and the tenant rules (org-only)
        'get /v1/notifications': [list('/v1/notifications?limit=200')],
        'get /v1/notifications/unread-count': [list('/v1/notifications/unread-count')],
        'post /v1/notifications/read-all': [ok('POST', '/v1/notifications/read-all', {})],
        'post /v1/notifications/:id/read': [
          notFound('POST', `/v1/notifications/${c.adminNotification}/read`, {}),
        ],
        'get /v1/notification-preferences': [list('/v1/notification-preferences')],
        'put /v1/notification-preferences/:type': [
          ok('PUT', '/v1/notification-preferences/export.completed', {
            in_app: false,
            email: 'off',
          }),
        ],
        'get /v1/notification-rules': [orgOnly('GET', '/v1/notification-rules')],
        'put /v1/notification-rules/:type': [
          orgOnly('PUT', '/v1/notification-rules/consumable.low_stock', { enabled: false }),
        ],
        'get /v1/notification-deliveries': [orgOnly('GET', '/v1/notification-deliveries')],

        // ---- saved views: filters only; a private view is its owner's
        'get /v1/saved-views': [list('/v1/saved-views?limit=200')],
        'post /v1/saved-views': [ok('POST', '/v1/saved-views', { name: unique('S-own') }, 201)],
        'get /v1/saved-views/:id': [notFound('GET', `/v1/saved-views/${c.adminPrivateView}`)],
        'patch /v1/saved-views/:id': [
          notFound('PATCH', `/v1/saved-views/${c.adminPrivateView}`, { name: 'x' }),
          {
            method: 'PATCH',
            url: `/v1/saved-views/${c.sharedView}`,
            body: { name: 'x' },
            expect: [403, 404],
          },
        ],
        'delete /v1/saved-views/:id': [
          notFound('DELETE', `/v1/saved-views/${c.adminPrivateView}`),
          { method: 'DELETE', url: `/v1/saved-views/${c.sharedView}`, expect: [403, 404] },
        ],
        'put /v1/saved-views/:id/sharing': [
          notFound('PUT', `/v1/saved-views/${c.adminPrivateView}/sharing`, { shared: true }),
        ],

        // ---- exports and imports: personal; the worker applies the requester's scope
        'get /v1/exports': [list('/v1/exports?limit=200')],
        'post /v1/exports': [ok('POST', '/v1/exports', { resource: 'assets' }, 202)],
        'get /v1/exports/:id': [notFound('GET', `/v1/exports/${c.adminExport}`)],
        'get /v1/imports/presets': [list('/v1/imports/presets')],
        'get /v1/imports/presets/:key/template': [
          list('/v1/imports/presets/assets/template?format=csv'),
        ],
        'get /v1/imports': [list('/v1/imports?limit=200')],
        'post /v1/imports': [
          ok('POST', '/v1/imports', { entity_type: 'person' }, 201),
          orgOnly('POST', '/v1/imports', { entity_type: 'department' }),
        ],
        'get /v1/imports/:id': [notFound('GET', `/v1/imports/${c.adminImport}`)],
        'patch /v1/imports/:id': [
          notFound('PATCH', `/v1/imports/${c.adminImport}`, { options: { on_match: 'update' } }),
        ],
        'post /v1/imports/:id/analyze': [
          notFound('POST', `/v1/imports/${c.adminImport}/analyze`, {
            file_attachment_id: c.attachmentOut,
          }),
        ],
        'post /v1/imports/:id/apply-template': [
          notFound('POST', `/v1/imports/${c.adminImport}/apply-template`, {
            template_id: c.importTemplate,
          }),
        ],
        'get /v1/imports/:id/values': [
          notFound('GET', `/v1/imports/${c.adminImport}/values?field=category`),
        ],
        'post /v1/imports/:id/dry-run': [
          notFound('POST', `/v1/imports/${c.adminImport}/dry-run`, {}),
        ],
        'get /v1/imports/:id/rows': [notFound('GET', `/v1/imports/${c.adminImport}/rows`)],
        'get /v1/imports/:id/errors.csv': [
          notFound('GET', `/v1/imports/${c.adminImport}/errors.csv`),
        ],
        'post /v1/imports/:id/commit': [
          keyed(`/v1/imports/${c.adminImport}/commit`, { dry_run_digest: 'a'.repeat(64) }),
        ],
        'post /v1/imports/:id/cancel': [
          notFound('POST', `/v1/imports/${c.adminImport}/cancel`, {}),
        ],
        // mapping templates are tenant-wide (like the catalogue); only their source import is personal
        'get /v1/import-templates': [list('/v1/import-templates?limit=200')],
        'post /v1/import-templates': [
          refused('POST', '/v1/import-templates', {
            name: unique('S'),
            from_import_id: c.adminImport,
          }),
        ],
        'get /v1/import-templates/:id': [ok('GET', `/v1/import-templates/${c.importTemplate}`)],
        'patch /v1/import-templates/:id': [
          {
            method: 'PATCH',
            url: `/v1/import-templates/${c.importTemplate}`,
            body: { name: 'x' },
            expect: [412],
            headers: { 'if-match': 'W/"999"' },
          },
        ],
        'delete /v1/import-templates/:id': [
          {
            method: 'DELETE',
            url: `/v1/import-templates/${c.importTemplate}`,
            expect: [412],
            headers: { 'if-match': 'W/"999"' },
          },
        ],

        // ---- access administration: org-only
        'get /v1/users': [orgOnly('GET', '/v1/users?limit=200')],
        'post /v1/users': [
          orgOnly('POST', '/v1/users', {
            email: `${unique('s')}@scope.example`,
            display_name: 'x',
            role_assignments: [{ role_id: c.roleId }],
          }),
        ],
        'get /v1/users/:id': [orgOnly('GET', `/v1/users/${c.adminUserId}`)],
        'patch /v1/users/:id': [
          orgOnly('PATCH', `/v1/users/${c.adminUserId}`, { display_name: 'x' }),
        ],
        'delete /v1/users/:id': [orgOnly('DELETE', `/v1/users/${c.adminUserId}`)],
        'delete /v1/users/:id/invitation': [
          orgOnly('DELETE', `/v1/users/${c.adminUserId}/invitation`),
        ],
        'post /v1/users/:id/invitation/resend': [
          orgOnly('POST', `/v1/users/${c.adminUserId}/invitation/resend`),
        ],
        'delete /v1/users/:id/mfa': [orgOnly('DELETE', `/v1/users/${c.adminUserId}/mfa`)],
        'get /v1/users/:id/sessions': [orgOnly('GET', `/v1/users/${c.adminUserId}/sessions`)],
        'delete /v1/users/:id/sessions/:session_id': [
          orgOnly('DELETE', `/v1/users/${c.adminUserId}/sessions/${c.adminSession}`),
        ],
        'get /v1/roles': [orgOnly('GET', '/v1/roles')],
        'get /v1/api-keys': [orgOnly('GET', '/v1/api-keys')],
        'post /v1/api-keys': [
          orgOnly('POST', '/v1/api-keys', { name: 's', scopes: ['asset:read'] }),
        ],
        'delete /v1/api-keys/:id': [orgOnly('DELETE', `/v1/api-keys/${c.adminKey}`)],
        'delete /v1/auth/sessions/:id': [notFound('DELETE', `/v1/auth/sessions/${c.adminSession}`)],
      };
    };

    /** Routes that carry no location-bound record, with the reason (the tenant replay exempts the same). */
    const EXEMPT: Record<string, string> = {
      'get /healthz': 'probe: no tenant data',
      'get /readyz': 'probe: no tenant data',
      'get /v1/health': 'probe: no tenant data',
      'get /v1/version': 'probe: no tenant data',
      'get /v1/openapi.json': 'public contract document',
      'post /v1/auth/login': 'pre-tenant: the credential selects the tenant',
      'post /v1/auth/mfa/verify': 'pre-tenant: bound to the login challenge',
      'post /v1/auth/password/forgot': 'pre-tenant: always the same answer',
      'post /v1/auth/password/reset': 'pre-tenant: the single-use token is the credential',
      'get /v1/auth/password-policy': 'public: static policy',
      'get /v1/auth/invitations/:token': 'pre-tenant: the single-use token is the credential',
      'post /v1/auth/invitations/accept': 'pre-tenant: the single-use token is the credential',
      'put /v1/files/:token': 'capability URL issued after the scope check of its attachment',
      'get /v1/files/:token': 'capability URL issued after the scope check of its attachment',
      'get /v1/auth/me':
        'principal-scoped: describes the caller (its location_scope is tested in test/scoping)',
      'post /v1/auth/logout': "principal-scoped: the caller's own session",
      'get /v1/auth/sessions': "principal-scoped: the caller's own sessions",
      'delete /v1/auth/sessions': "principal-scoped: the caller's own sessions",
      'delete /v1/auth/mfa': "principal-scoped: the caller's own factor",
      'post /v1/auth/mfa/enrol': "principal-scoped: the caller's own factor",
      'post /v1/auth/mfa/enrol/confirm': "principal-scoped: the caller's own factor",
      'post /v1/auth/mfa/recovery-codes/regenerate': "principal-scoped: the caller's own codes",
    };

    beforeAll(async () => {
      ({ app } = await startRegistryApp());
      t = await createTenant(app, tenancy, 'scopereplay');
      const a = t.admin;
      const m = unique('scr').replace(/-/g, '');
      const must = async (
        res: Promise<{ status: number; body: Json; raw: string }>,
        status = 201,
      ) => {
        const r = await res;
        if (r.status !== status) throw new Error(`fixture: ${r.status} ${r.raw}`);
        return r.body;
      };
      const category = await must(a.post('/v1/categories', { name: `cat ${m}` }));
      const accCategory = await must(
        a.post('/v1/categories', { name: `acc ${m}`, kind: 'accessory' }),
      );
      const conCategory = await must(
        a.post('/v1/categories', { name: `con ${m}`, kind: 'consumable' }),
      );
      const model = await must(
        a.post('/v1/models', { category_id: category.id, name: `model ${m}` }),
      );
      const label = await must(
        a.post('/v1/status-labels', { name: `label ${m}`, state_type: 'pending' }),
      );
      const department = await must(a.post('/v1/departments', { name: `dept ${m}` }));
      const siteIn = await must(a.post('/v1/locations', { name: `in ${m}`, kind: 'site' }));
      const siteOutName = `${m}-OUTSITE`;
      const siteOut = await must(a.post('/v1/locations', { name: siteOutName, kind: 'site' }));

      const asset = (extra: Record<string, unknown>) =>
        must(a.post('/v1/assets', { category_id: category.id, ...extra }));
      const assetOut = await asset({
        name: `${m}-OUTASSET`,
        asset_tag: `${m}-TAGOUT`,
        serial: `${m}-OUTSERIAL`,
        location_id: siteOut.id,
        department_id: department.id,
      });
      const assetNone = await asset({ name: `${m}-NOWHERE`, asset_tag: `${m}-TAGNONE` });
      const assetIn = await asset({ name: `in asset ${m}`, location_id: siteIn.id });
      const repairAssetOut = await asset({
        name: `${m}-OUTREPAIRABLE`,
        asset_tag: `${m}-TAGREP`,
        location_id: siteOut.id,
      });
      const loanerOut = await asset({
        name: `${m}-OUTLOANER`,
        asset_tag: `${m}-TAGLOAN`,
        location_id: siteOut.id,
      });
      const personOutEmail = `${m}-outperson@scope.example`;
      const personOut = await must(
        a.post('/v1/people', {
          display_name: `${m}-OUTPERSON`,
          email: personOutEmail,
          location_id: siteOut.id,
          department_id: department.id,
        }),
      );
      const personNone = await must(a.post('/v1/people', { display_name: `${m}-NOWHEREPERSON` }));
      const personIn = await must(
        a.post('/v1/people', { display_name: `in person ${m}`, location_id: siteIn.id }),
      );
      await must(
        a.post(
          `/v1/assets/${assetOut.id}/checkout`,
          { person_id: personOut.id },
          {
            headers: { 'idempotency-key': `scr-co-${m}` },
          },
        ),
      );
      await must(
        a.post(
          `/v1/assets/${assetIn.id}/checkout`,
          { person_id: personIn.id },
          {
            headers: { 'idempotency-key': `scr-co-in-${m}` },
          },
        ),
      );
      const accOut = await must(
        a.post('/v1/accessories', {
          category_id: accCategory.id,
          name: `${m}-OUTACC`,
          qty_total: 5,
          location_id: siteOut.id,
        }),
      );
      const accAssignmentOut = await must(
        a.post(
          `/v1/accessories/${accOut.id}/checkout`,
          { person_id: personOut.id, quantity: 1 },
          {
            headers: { 'idempotency-key': `scr-acc-${m}` },
          },
        ),
      );
      const accIn = await must(
        a.post('/v1/accessories', {
          category_id: accCategory.id,
          name: `in acc ${m}`,
          qty_total: 5,
          location_id: siteIn.id,
        }),
      );
      const conOut = await must(
        a.post('/v1/consumables', {
          category_id: conCategory.id,
          name: `${m}-OUTCON`,
          initial_qty: 5,
          location_id: siteOut.id,
        }),
      );
      await must(
        a.post(
          `/v1/consumables/${conOut.id}/movements`,
          { qty_delta: -1, reason: 'issue', person_id: personOut.id },
          {
            headers: { 'idempotency-key': `scr-con-${m}` },
          },
        ),
      );
      const conIn = await must(
        a.post('/v1/consumables', {
          category_id: conCategory.id,
          name: `in con ${m}`,
          initial_qty: 5,
          location_id: siteIn.id,
        }),
      );
      const poolOut = await must(
        a.post('/v1/loaner-pools', { name: `${m}-OUTPOOL`, home_location_id: siteOut.id }),
      );
      const poolIn = await must(
        a.post('/v1/loaner-pools', { name: `in pool ${m}`, home_location_id: siteIn.id }),
      );
      await must(a.post(`/v1/loaner-pools/${poolOut.id}/members`, { asset_id: loanerOut.id }));
      const loan = await must(
        a.post(
          `/v1/loaner-pools/${poolOut.id}/checkout`,
          { person_id: personOut.id, asset_id: loanerOut.id },
          {
            headers: { 'idempotency-key': `scr-loan-${m}` },
          },
        ),
      );
      const repair = await must(
        a.post('/v1/repairs', { asset_id: repairAssetOut.id, title: `${m}-OUTREPAIR` }),
      );
      const attachmentName = `${m}-OUTFILE.png`;
      const attachment = (
        await must(
          a.post('/v1/attachments', {
            entity_type: 'asset',
            entity_id: assetOut.id,
            filename: attachmentName,
            content_type: 'image/png',
            size_bytes: 50,
          }),
        )
      ).attachment;
      const batch = await must(
        a.post(
          '/v1/labels/batches',
          { template_key: 'letter-30up-qr', asset_ids: [assetOut.id] },
          {
            headers: { 'idempotency-key': `scr-batch-${m}` },
          },
        ),
        202,
      );
      const adminExport = await must(a.post('/v1/exports', { resource: 'assets' }), 202);
      const adminImport = await must(a.post('/v1/imports', { entity_type: 'asset' }));
      const importTemplate = await must(
        a.post('/v1/import-templates', {
          name: `tpl ${m}`,
          entity_type: 'asset',
          columns: [{ header: 'Serial', target: 'serial' }],
        }),
      );
      const privateView = await must(
        a.post('/v1/saved-views', { name: `${m}-OUTVIEW`, filters: { location_id: siteOut.id } }),
      );
      const sharedViewRes = await a.post('/v1/saved-views', {
        name: `shared ${m}`,
        filters: { q: 'shared' },
      });
      await a.put(
        `/v1/saved-views/${sharedViewRes.body.id}/sharing`,
        { shared: true },
        {
          headers: { 'if-match': String(sharedViewRes.headers.etag) },
        },
      );
      const me = (await a.get('/v1/auth/me')).body;
      const notificationId = randomUUID();
      await ownerTenantSql(
        t.tenantId,
        `insert into app.notification (id, tenant_id, user_id, type, title, dedupe_key)
       values ($1, $2, $3, 'export.completed', $4, $5)`,
        [notificationId, t.tenantId, me.user.id, `${m}-OUTNOTICE`, `scr-${m}`],
      );
      const sessions = (await a.get('/v1/auth/sessions')).body.data as Array<{ id: string }>;
      const apiKey = await must(
        a.post('/v1/api-keys', { name: `key ${m}`, scopes: ['asset:read'] }),
      );

      scoped = (await createScopedUser(app, t, 'tenant_admin', [siteIn.id], 'scr')).client;

      fx = {
        categoryId: category.id,
        accCategoryId: accCategory.id,
        conCategoryId: conCategory.id,
        modelId: model.id,
        statusLabelId: label.id,
        departmentId: department.id,
        siteIn: siteIn.id,
        siteOut: siteOut.id,
        siteOutName,
        assetOut: assetOut.id,
        assetOutTag: assetOut.asset_tag,
        assetOutSerial: assetOut.serial,
        assetOutLabel: assetOut.label_code,
        assetNone: assetNone.id,
        assetNoneTag: assetNone.asset_tag,
        personOut: personOut.id,
        personOutEmail,
        personNone: personNone.id,
        accOut: accOut.id,
        accOutLabel: accOut.label_code,
        accAssignmentOut: accAssignmentOut.id,
        conOut: conOut.id,
        conOutLabel: conOut.label_code,
        poolOut: poolOut.id,
        loanerOut: loanerOut.id,
        loanOut: loan.assignment.id,
        repairOut: repair.id,
        repairAssetOut: repairAssetOut.id,
        attachmentOut: attachment.id,
        adminBatch: batch.id,
        adminExport: adminExport.id,
        adminImport: adminImport.id,
        adminNotification: notificationId,
        adminPrivateView: privateView.id,
        sharedView: sharedViewRes.body.id,
        importTemplate: importTemplate.id,
        adminSession: sessions[0]!.id,
        adminUserId: me.user.id,
        adminKey: apiKey.id,
        roleId: t.roles.viewer!,
        assetIn: assetIn.id,
        personIn: personIn.id,
        accIn: accIn.id,
        conIn: conIn.id,
        poolIn: poolIn.id,
        markers: [
          siteOut.id,
          siteOutName,
          assetOut.id,
          assetOut.asset_tag,
          assetOut.serial,
          assetOut.label_code,
          `${m}-OUTASSET`,
          assetNone.id,
          assetNone.asset_tag,
          assetNone.label_code,
          `${m}-NOWHERE`,
          repairAssetOut.id,
          repairAssetOut.asset_tag,
          loanerOut.id,
          loanerOut.asset_tag,
          loanerOut.label_code,
          personOut.id,
          personOutEmail,
          `${m}-OUTPERSON`,
          personNone.id,
          accOut.id,
          accOut.label_code,
          `${m}-OUTACC`,
          accAssignmentOut.id,
          conOut.id,
          conOut.label_code,
          `${m}-OUTCON`,
          poolOut.id,
          `${m}-OUTPOOL`,
          loan.assignment.id,
          repair.id,
          `${m}-OUTREPAIR`,
          attachment.id,
          attachmentName,
          batch.id,
          adminExport.id,
          adminImport.id,
          notificationId,
          `${m}-OUTNOTICE`,
          privateView.id,
          `${m}-OUTVIEW`,
          apiKey.id,
          sessions[0]!.id,
          t.adminEmail,
        ],
      };
    });
    afterAll(async () => {
      await app.close();
      await tenancy.onModuleDestroy();
    });

    /** The out-of-scope records as the org administrator sees them (versions, custody, ledgers). */
    async function snapshot(): Promise<Record<string, string>> {
      const a = t.admin;
      const etag = async (url: string) => String((await a.get(url)).headers.etag ?? 'none');
      const json = async (url: string, pick: (r: Json) => unknown) =>
        JSON.stringify(((await a.get(url)).body.data as Array<Json>).map(pick));
      return {
        assetOut: await etag(`/v1/assets/${fx.assetOut}`),
        assetNone: await etag(`/v1/assets/${fx.assetNone}`),
        repairAssetOut: await etag(`/v1/assets/${fx.repairAssetOut}`),
        loanerOut: await etag(`/v1/assets/${fx.loanerOut}`),
        siteOut: await etag(`/v1/locations/${fx.siteOut}`),
        personOut: await etag(`/v1/people/${fx.personOut}`),
        personNone: await etag(`/v1/people/${fx.personNone}`),
        accOut: await etag(`/v1/accessories/${fx.accOut}`),
        conOut: await etag(`/v1/consumables/${fx.conOut}`),
        poolOut: await etag(`/v1/loaner-pools/${fx.poolOut}`),
        repairOut: await etag(`/v1/repairs/${fx.repairOut}`),
        import: await etag(`/v1/imports/${fx.adminImport}`),
        template: await etag(`/v1/import-templates/${fx.importTemplate}`),
        category: await etag(`/v1/categories/${fx.categoryId}`),
        department: await etag(`/v1/departments/${fx.departmentId}`),
        custody: await json(`/v1/assets/${fx.assetOut}/assignments`, (s) => [
          s.id,
          s.checked_in_at,
        ]),
        accCustody: await json(`/v1/accessories/${fx.accOut}/assignments?state=all`, (s) => [
          s.id,
          s.quantity_returned,
        ]),
        ledger: await json(`/v1/consumables/${fx.conOut}/movements`, (x) => [
          x.id,
          x.balance_after,
        ]),
        members: await json(`/v1/loaner-pools/${fx.poolOut}/members`, (x) => x.asset_id),
        loan: JSON.stringify((await a.get(`/v1/loans/${fx.loanOut}`)).body.expected_return),
        attachments: await json(
          `/v1/attachments?entity_type=asset&entity_id=${fx.assetOut}`,
          (x) => x.id,
        ),
        privateView: await etag(`/v1/saved-views/${fx.adminPrivateView}`),
        sharedView: await etag(`/v1/saved-views/${fx.sharedView}`),
        unread: JSON.stringify((await a.get('/v1/notifications/unread-count')).body),
        roots: JSON.stringify(
          ((await a.get('/v1/locations?root=true&limit=200')).body.data as Array<{ id: string }>)
            .map((l) => l.id)
            .sort(),
        ),
        categories: String((await a.get('/v1/categories?limit=200')).body.data.length),
        users: String((await a.get('/v1/users?limit=200')).body.data.length),
        keys: await json('/v1/api-keys', (k) => [k.id, k.revoked_at]),
        rules: await json('/v1/notification-rules', (r) => [r.type, r.enabled]),
        tagTemplate: await etag('/v1/settings/asset-tag-template'),
        custodySettings: await etag('/v1/settings/custody'),
      };
    }

    it('every route of the application is registered with the scoped replay (or exempt, with a reason)', () => {
      const routes = discoverRoutes(app.get(ModulesContainer, { strict: false }));
      const known = cases();
      const keys = routes.map((r) => `${r.method} ${r.path}`);
      const missing = keys.filter((k) => !(k in known) && !(k in EXEMPT));
      expect(
        missing,
        'routes without a scoped replay case: add one in scope-replay.e2e.test.ts',
      ).toEqual([]);
      const stale = [...Object.keys(known), ...Object.keys(EXEMPT)].filter(
        (k) => !keys.includes(k),
      );
      expect(stale, 'scoped replay cases for routes that no longer exist').toEqual([]);
      // every route that reads or writes location-bound data is replayed, never exempt
      for (const r of routes.filter((r) =>
        /^\/v1\/(assets|attachments|scan|search|locations|people|accessories|consumables|repairs|loaner|loans|labels|exports|imports|saved-views|notifications)/.test(
          r.path,
        ),
      )) {
        expect(`${r.method} ${r.path}` in EXEMPT, `${r.method} ${r.path} must not be exempt`).toBe(
          false,
        );
      }
    });

    it('replays every route as a scoped principal: 404 / refused / 403 / in-scope only, never out-of-scope data, never a write outside', async () => {
      const before = await snapshot();
      const results: string[] = [];
      for (const [route, replays] of Object.entries(cases())) {
        for (const r of replays) {
          const headers: Record<string, string> = { ...(r.headers ?? {}) };
          if (
            !headers['if-match'] &&
            (r.method === 'PATCH' ||
              r.method === 'DELETE' ||
              r.method === 'PUT' ||
              (r.method === 'POST' && /\/(restore|complete)$/.test(r.url)))
          ) {
            headers['if-match'] = '*';
          }
          const res = await scoped.request(r.method, r.url, { body: r.body, headers });
          const where = `${route} <- ${r.method} ${r.url}`;
          expect(r.expect, `${where}: got ${res.status} ${res.raw.slice(0, 300)}`).toContain(
            res.status,
          );
          const answer =
            res.body && typeof res.body === 'object'
              ? { ...res.body, instance: undefined }
              : res.body;
          const text = JSON.stringify(answer ?? res.raw);
          // what the caller sent may come back (a scanned code in a per-item result); nothing else
          const sent = JSON.stringify(r.body ?? null);
          for (const marker of fx.markers.filter((x) => !sent.includes(x))) {
            expect(text.includes(marker), `${where}: the response leaks ${marker}`).toBe(false);
          }
          results.push(`${res.status} ${r.method} ${r.url.split('?')[0]}`);
        }
      }
      expect(results.length).toBeGreaterThanOrEqual(200);
      expect(await snapshot()).toEqual(before);
    });

    it('the positive control: the same principal sees and works on the records of its own site', async () => {
      const assets = (await scoped.get('/v1/assets?limit=200')).body.data.map(
        (x: { id: string }) => x.id,
      );
      expect(assets).toContain(fx.assetIn);
      expect((await scoped.get(`/v1/people/${fx.personIn}`)).status).toBe(200);
      expect((await scoped.get(`/v1/loaner-pools/${fx.poolIn}`)).status).toBe(200);
      expect((await scoped.get(`/v1/accessories/${fx.accIn}`)).status).toBe(200);
      expect((await scoped.get(`/v1/consumables/${fx.conIn}`)).status).toBe(200);
      // and the org administrator still sees everything
      expect((await t.admin.get(`/v1/assets/${fx.assetOut}`)).status).toBe(200);
    });
  },
);
