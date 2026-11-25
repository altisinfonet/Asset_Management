import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Client, dbEnabled, ownerSql } from '../auth/support.js';
import { env, mode } from '../support/db.js';
import { discoverRoutes } from '../support/routes.js';
import { foreignKeyProbe, foreignKeyProbeControl, visibilityProbe } from './catalogue-probes.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  createUser,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
  unique,
} from '../registry/support.js';

/**
 * M1-TEN-04 ROUTE REPLAY. Every HTTP route of the application is replayed as tenant B against
 * tenant A's resource ids, tags and codes, and must answer 404 (or 403), refuse the write with a
 * validation error, or return a list that contains none of A's data. The suite FAILS when a route
 * is neither registered here with a replay case nor exempted with a reason, so a new route cannot
 * ship without being replayed (DoD 6). It runs in whichever mode the e2e suite runs: direct
 * (app_user -> Postgres) and pooled (app_user -> PgBouncer, transaction mode).
 *
 * "Never a data leak": for every replay the response must not contain any of A's markers (ids, tag,
 * serial, label code, names), whatever its status; and after the whole replay A's rows still have
 * the versions they had before it (no cross-tenant write), while B gained nothing it should not have.
 */
describe.skipIf(!dbEnabled)(`route replay: tenant B against tenant A's ids (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  let fx: Fixtures;

  interface Fixtures {
    categoryId: string;
    manufacturerId: string;
    modelId: string;
    vendorId: string;
    statusLabelId: string;
    customFieldId: string;
    assetId: string;
    assetTag: string;
    serial: string;
    labelCode: string;
    /** M2-FILE: an attachment of A (upload never confirmed) and its file name */
    attachmentId: string;
    attachmentName: string;
    userId: string;
    invitedUserId: string;
    sessionId: string;
    apiKeyId: string;
    roleId: string;
    // M2 wave 1
    locationId: string;
    locationName: string;
    personId: string;
    personEmail: string;
    // [DEPT] a department of A (with A's person and A's asset in it) and one of B
    departmentId: string;
    departmentName: string;
    ownDepartmentId: string;
    /** an asset of tenant B (so B can try to hand it to A's person / A's location) */
    ownAssetId: string;
    // [LOAN] A's loaner pool with a device on loan to A's person; a pool, a device and a person of B
    loanerPoolId: string;
    loanerPoolName: string;
    loanerAssetId: string;
    loanId: string;
    ownPoolId: string;
    ownPersonId: string;
    ownLoanerAssetId: string;
    // [M2-W2 ACC]
    accessoryId: string;
    accessoryName: string;
    accessoryLabel: string;
    accessoryCategoryId: string;
    accessoryAssignmentId: string;
    consumableId: string;
    consumableName: string;
    consumableLabel: string;
    consumableCategoryId: string;
    /** an accessory and a consumable of tenant B */
    ownAccessoryId: string;
    ownConsumableId: string;
    // [M2-W2 LABELS] a template and a label batch of A
    labelTemplateId: string;
    labelBatchId: string;
    // M2 wave 2: repairs, notifications, saved views, exports
    repairId: string;
    repairAssetId: string;
    notificationId: string;
    sharedViewId: string;
    privateViewId: string;
    exportId: string;
    // M2 wave 3: an import and a saved mapping template of A
    importId: string;
    importTemplateId: string;
    /** strings that must never show up in a response to tenant B */
    markers: string[];
  }

  interface Replay {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    body?: unknown;
    /** statuses that are acceptable (the isolation outcome), never 2xx with A's data */
    expect: number[];
    /** extra request headers (custody operations need an Idempotency-Key) */
    headers?: Record<string, string>;
  }

  /** A path id of tenant A, replayed with the headers a real client would send. */
  const notFound = (method: Replay['method'], url: string, body?: unknown): Replay => ({
    method,
    url,
    body,
    expect: [404],
  });
  const list = (url: string): Replay => ({ method: 'GET', url, expect: [200] });
  const refused = (method: Replay['method'], url: string, body: unknown): Replay => ({
    method,
    url,
    body,
    expect: [404, 422],
  });
  /** A custody operation: needs an Idempotency-Key, answers 404 for a foreign asset. */
  let keyN = 0;
  const custody = (url: string, body: unknown, expect: number[] = [404]): Replay => ({
    method: 'POST',
    url,
    body,
    expect,
    headers: { 'idempotency-key': `replay-key-${Date.now()}-${keyN++}` },
  });

  /** Replay cases by route (`method path` with `:param` templates, as the controllers declare them). */
  const cases = (): Record<string, Replay[]> => {
    const c = fx;
    const crud = (path: string, id: string, patch: unknown): Record<string, Replay[]> => ({
      [`get /v1/${path}/:id`]: [notFound('GET', `/v1/${path}/${id}`)],
      [`patch /v1/${path}/:id`]: [notFound('PATCH', `/v1/${path}/${id}`, patch)],
      [`delete /v1/${path}/:id`]: [notFound('DELETE', `/v1/${path}/${id}`)],
    });
    return {
      // ---- registry
      ...crud('categories', c.categoryId, { description: 'b was here' }),
      ...crud('manufacturers', c.manufacturerId, { notes: 'b was here' }),
      ...crud('models', c.modelId, { notes: 'b was here' }),
      ...crud('status-labels', c.statusLabelId, { description: 'b was here' }),
      ...crud('vendors', c.vendorId, { notes: 'b was here' }),
      ...crud('custom-fields', c.customFieldId, { label: 'b was here' }),
      ...crud('assets', c.assetId, { name: 'b was here' }),
      'get /v1/categories': [
        list(`/v1/categories?q=${c.markers[0]}`),
        list('/v1/categories?limit=200'),
      ],
      'post /v1/categories': [
        // the same name as A's category is fine in B: it must create B's own category, not collide
        { method: 'POST', url: '/v1/categories', body: { name: unique('B-own') }, expect: [201] },
      ],
      'get /v1/manufacturers': [list('/v1/manufacturers?limit=200')],
      'post /v1/manufacturers': [
        {
          method: 'POST',
          url: '/v1/manufacturers',
          body: { name: unique('B-own') },
          expect: [201],
        },
      ],
      'get /v1/models': [
        list(`/v1/models?category_id=${c.categoryId}`),
        list(`/v1/models?manufacturer_id=${c.manufacturerId}`),
        list('/v1/models?limit=200'),
      ],
      'post /v1/models': [
        refused('POST', '/v1/models', { category_id: c.categoryId, name: unique('X') }),
        refused('POST', '/v1/models', {
          category_id: c.categoryId,
          manufacturer_id: c.manufacturerId,
          name: unique('X'),
        }),
      ],
      'get /v1/status-labels': [list('/v1/status-labels')],
      'post /v1/status-labels': [
        {
          method: 'POST',
          url: '/v1/status-labels',
          body: { name: unique('B-own'), state_type: 'pending' },
          expect: [201],
        },
      ],
      'get /v1/vendors': [list('/v1/vendors?limit=200')],
      'post /v1/vendors': [
        { method: 'POST', url: '/v1/vendors', body: { name: unique('B-own') }, expect: [201] },
      ],
      'get /v1/custom-fields': [
        list(`/v1/custom-fields?category_id=${c.categoryId}`),
        list('/v1/custom-fields'),
      ],
      'post /v1/custom-fields': [
        refused('POST', '/v1/custom-fields', {
          category_id: c.categoryId,
          key: 'x',
          label: 'x',
          data_type: 'text',
        }),
      ],
      'get /v1/settings/asset-tag-template': [list('/v1/settings/asset-tag-template')],
      'put /v1/settings/asset-tag-template': [
        // B changes ITS template; A's is checked untouched at the end
        {
          method: 'PUT',
          url: '/v1/settings/asset-tag-template',
          body: { prefix: 'BB-', width: 4, use_category_prefix: false },
          expect: [200],
        },
      ],
      'get /v1/assets': [
        list(`/v1/assets?tag=${c.assetTag}`),
        list(`/v1/assets?tag=${c.assetTag.toLowerCase()}`),
        list(`/v1/assets?serial=${c.serial}`),
        list(`/v1/assets?q=${c.markers[0]}`),
        list(`/v1/assets?category_id=${c.categoryId}`),
        list(`/v1/assets?model_id=${c.modelId}`),
        list(`/v1/assets?vendor_id=${c.vendorId}&include_total=true`),
        list(`/v1/assets?department_id=${c.departmentId}&expand=department`),
        list(`/v1/assets?status_id=${c.statusLabelId}`),
        list('/v1/assets?limit=200&archived=include'),
        list(`/v1/assets?location_id=${c.locationId}`),
        list(`/v1/assets?location_id=${c.locationId}&include_sublocations=false`),
        list(`/v1/assets?assigned_person_id=${c.personId}`),
        list('/v1/assets?assigned=true&overdue=false&limit=200'),
        // B has no custom field "tier": A's definitions are invisible to it
        { method: 'GET', url: '/v1/assets?cf[tier]=gold', expect: [400] },
      ],
      'post /v1/assets': [
        refused('POST', '/v1/assets', { category_id: c.categoryId, name: 'b was here' }),
        refused('POST', '/v1/assets', {
          category_id: c.categoryId,
          model_id: c.modelId,
          vendor_id: c.vendorId,
        }),
        refused('POST', '/v1/assets', { category_id: c.categoryId, status_id: c.statusLabelId }),
        refused('POST', '/v1/assets', { category_id: c.categoryId, department_id: c.departmentId }),
      ],
      'post /v1/assets/:id/restore': [notFound('POST', `/v1/assets/${c.assetId}/restore`)],
      'post /v1/assets/:id/clone': [
        notFound('POST', `/v1/assets/${c.assetId}/clone`, { count: 2 }),
      ],
      'post /v1/assets/bulk-update': [
        // per-item 404s, the request itself is well formed: 200 and nothing of A's in the answer
        {
          method: 'POST',
          url: '/v1/assets/bulk-update',
          body: { ids: [c.assetId], changes: { vendor_id: null } },
          expect: [200],
        },
      ],
      'post /v1/assets/bulk-archive': [
        {
          method: 'POST',
          url: '/v1/assets/bulk-archive',
          body: { ids: [c.assetId] },
          expect: [200],
        },
      ],
      'post /v1/assets/bulk-restore': [
        {
          method: 'POST',
          url: '/v1/assets/bulk-restore',
          body: { ids: [c.assetId] },
          expect: [200],
        },
      ],
      'get /v1/scan/resolve': [
        notFound('GET', `/v1/scan/resolve?code=${c.assetTag}`),
        notFound('GET', `/v1/scan/resolve?code=${c.assetTag.toLowerCase()}`),
        notFound('GET', `/v1/scan/resolve?code=${c.labelCode}`),
        // [M2-W2 ACC] labels of A's accessory and consumable
        notFound('GET', `/v1/scan/resolve?code=${c.accessoryLabel}`),
        notFound('GET', `/v1/scan/resolve?code=${c.consumableLabel}`),
        notFound(
          'GET',
          `/v1/scan/resolve?code=${encodeURIComponent(`https://app.example/a/${c.labelCode}`)}`,
        ),
      ],
      // ---- files (M2-FILE-01/02, M2-SEC-02): B never sees, confirms, archives or attaches to A's records
      'get /v1/attachments': [
        list(`/v1/attachments?entity_type=asset&entity_id=${c.assetId}`),
        list(`/v1/attachments?entity_type=asset&entity_id=${c.assetId}&kind=photo&limit=200`),
      ],
      'post /v1/attachments': [
        refused('POST', '/v1/attachments', {
          entity_type: 'asset',
          entity_id: c.assetId,
          filename: 'b-was-here.png',
          content_type: 'image/png',
          size_bytes: 10,
        }),
        refused('POST', '/v1/attachments', {
          entity_type: 'asset_model',
          entity_id: c.modelId,
          filename: 'b-was-here.png',
          content_type: 'image/png',
          size_bytes: 10,
        }),
      ],
      'get /v1/attachments/:id': [notFound('GET', `/v1/attachments/${c.attachmentId}`)],
      'post /v1/attachments/:id/complete': [
        notFound('POST', `/v1/attachments/${c.attachmentId}/complete`),
      ],
      'delete /v1/attachments/:id': [notFound('DELETE', `/v1/attachments/${c.attachmentId}`)],
      'get /v1/settings/files': [list('/v1/settings/files')],
      'put /v1/settings/files': [
        // B changes ITS settings; A's are checked untouched at the end
        {
          method: 'PUT',
          url: '/v1/settings/files',
          body: { strip_exif_original: true, max_upload_bytes: 4096 },
          expect: [200],
        },
      ],
      // ---- [M2-W2 LABELS] templates are per tenant; a batch belongs to its requester
      'get /v1/labels/templates': [list('/v1/labels/templates')],
      'get /v1/labels/templates/:id': [
        notFound('GET', `/v1/labels/templates/${c.labelTemplateId}`),
      ],
      'patch /v1/labels/templates/:id': [
        notFound('PATCH', `/v1/labels/templates/${c.labelTemplateId}`, { offset_x_mm: 2 }),
      ],
      'post /v1/labels/batches': [
        // A's asset, A's asset by filter, A's logo: refused; B's own asset: B's own batch
        custody(
          '/v1/labels/batches',
          { template_key: 'letter-30up-qr', asset_ids: [c.assetId] },
          [422],
        ),
        custody(
          '/v1/labels/batches',
          { template_key: 'letter-30up-qr', filter: { tag: c.assetTag } },
          [422],
        ),
        custody(
          '/v1/labels/batches',
          {
            template_key: 'letter-30up-qr',
            asset_ids: [c.ownAssetId],
            logo_attachment_id: c.attachmentId,
          },
          [422],
        ),
        custody(
          '/v1/labels/batches',
          { template_key: 'letter-30up-qr', asset_ids: [c.ownAssetId] },
          [202],
        ),
      ],
      'get /v1/labels/batches': [list('/v1/labels/batches?limit=200')],
      'get /v1/labels/batches/:id': [notFound('GET', `/v1/labels/batches/${c.labelBatchId}`)],
      'get /v1/search': [
        list(`/v1/search?q=${c.assetTag}`),
        list(`/v1/search?q=${c.serial}`),
        list(`/v1/search?q=${c.markers[0]}`),
        list(`/v1/search?q=${c.markers[0]}&types=person,location`),
      ],
      // ---- M2 wave 1: locations
      ...crud('locations', c.locationId, { notes: 'b was here' }),
      'get /v1/locations': [
        list(`/v1/locations?q=${c.locationName}`),
        list(`/v1/locations?parent_id=${c.locationId}`),
        list(`/v1/locations?descendants_of=${c.locationId}`),
        list('/v1/locations?limit=200&archived=include'),
      ],
      'post /v1/locations': [
        // under A's location, or into A's company: refused, nothing created in A
        refused('POST', '/v1/locations', { name: unique('X'), parent_id: c.locationId }),
        { method: 'POST', url: '/v1/locations', body: { name: unique('B-own') }, expect: [201] },
      ],
      // ---- [DEPT] managed departments (ED-17)
      ...crud('departments', c.departmentId, { description: 'b was here' }),
      'get /v1/departments': [
        list(`/v1/departments?q=${c.departmentName}`),
        list('/v1/departments?limit=200&archived=include'),
      ],
      'post /v1/departments': [
        // A's person as manager: refused, nothing created in A
        refused('POST', '/v1/departments', { name: unique('X'), manager_person_id: c.personId }),
        { method: 'POST', url: '/v1/departments', body: { name: unique('B-own') }, expect: [201] },
      ],
      // ---- [LOAN] loaner pools, loans and the custody settings (ED-20, ED-21)
      ...crud('loaner-pools', c.loanerPoolId, { description: 'b was here' }),
      'get /v1/loaner-pools': [
        list(`/v1/loaner-pools?q=${c.loanerPoolName}`),
        list(`/v1/loaner-pools?home_location_id=${c.locationId}`),
        list('/v1/loaner-pools?limit=200&archived=include'),
      ],
      'post /v1/loaner-pools': [
        // A's location as home, A's user as owner: refused, nothing created in A
        refused('POST', '/v1/loaner-pools', { name: unique('X'), home_location_id: c.locationId }),
        refused('POST', '/v1/loaner-pools', { name: unique('X'), owner_user_id: c.userId }),
        { method: 'POST', url: '/v1/loaner-pools', body: { name: unique('B-own') }, expect: [201] },
      ],
      'get /v1/loaner-pools/:id/members': [
        notFound('GET', `/v1/loaner-pools/${c.loanerPoolId}/members`),
        list(`/v1/assets?loaner_pool_id=${c.loanerPoolId}`),
        list('/v1/assets?in_loaner_pool=true&limit=200'),
      ],
      'post /v1/loaner-pools/:id/members': [
        notFound('POST', `/v1/loaner-pools/${c.loanerPoolId}/members`, { asset_id: c.ownAssetId }),
        refused('POST', `/v1/loaner-pools/${c.ownPoolId}/members`, { asset_id: c.loanerAssetId }),
      ],
      'post /v1/loaner-pools/:id/members/bulk-add': [
        notFound('POST', `/v1/loaner-pools/${c.loanerPoolId}/members/bulk-add`, {
          ids: [c.ownAssetId],
        }),
        // A's device in B's own pool: that item fails, the request itself is fine
        {
          method: 'POST',
          url: `/v1/loaner-pools/${c.ownPoolId}/members/bulk-add`,
          body: { ids: [c.loanerAssetId] },
          expect: [200],
        },
      ],
      'post /v1/loaner-pools/:id/members/bulk-remove': [
        notFound('POST', `/v1/loaner-pools/${c.loanerPoolId}/members/bulk-remove`, {
          ids: [c.ownAssetId],
        }),
        {
          method: 'POST',
          url: `/v1/loaner-pools/${c.ownPoolId}/members/bulk-remove`,
          body: { ids: [c.loanerAssetId] },
          expect: [200],
        },
      ],
      'delete /v1/loaner-pools/:id/members/:asset_id': [
        notFound('DELETE', `/v1/loaner-pools/${c.loanerPoolId}/members/${c.loanerAssetId}`),
        notFound('DELETE', `/v1/loaner-pools/${c.ownPoolId}/members/${c.loanerAssetId}`),
      ],
      'post /v1/loaner-pools/:id/checkout': [
        custody(`/v1/loaner-pools/${c.loanerPoolId}/checkout`, { person_id: c.ownPersonId }),
        // B's own pool to A's person: refused
        custody(`/v1/loaner-pools/${c.ownPoolId}/checkout`, { person_id: c.personId }, [422]),
        custody(
          `/v1/loaner-pools/${c.ownPoolId}/checkout`,
          { person_id: c.ownPersonId, asset_id: c.loanerAssetId },
          [422],
        ),
      ],
      'post /v1/loaner-pools/:id/quick-checkout': [
        custody(`/v1/loaner-pools/${c.loanerPoolId}/quick-checkout`, {
          person_id: c.ownPersonId,
          codes: ['no-such-code'],
        }),
        custody(
          `/v1/loaner-pools/${c.ownPoolId}/quick-checkout`,
          { person_id: c.personId, codes: ['no-such-code'] },
          [422],
        ),
        custody(
          `/v1/loaner-pools/${c.ownPoolId}/quick-checkout`,
          { borrower: c.personEmail, codes: ['no-such-code'] },
          [422],
        ),
        // B scans a code that does not exist in B: the item is a 404, the request is fine
        custody(
          `/v1/loaner-pools/${c.ownPoolId}/quick-checkout`,
          { person_id: c.ownPersonId, codes: ['no-such-code'] },
          [200],
        ),
      ],
      'get /v1/loans': [
        list(`/v1/loans?loaner_pool_id=${c.loanerPoolId}`),
        list(`/v1/loans?person_id=${c.personId}&state=on_loan,due_today,overdue,returned`),
        list(`/v1/loans?asset_id=${c.loanerAssetId}&state=returned`),
        list('/v1/loans?limit=200&include_total=true&state=on_loan,due_today,overdue,returned'),
      ],
      'get /v1/loans/overdue': [
        list('/v1/loans/overdue?limit=200'),
        list(`/v1/loans/overdue?person_id=${c.personId}`),
        list(`/v1/loans/overdue?loaner_pool_id=${c.loanerPoolId}`),
      ],
      'post /v1/loans/return': [custody('/v1/loans/return', { codes: ['no-such-code'] }, [200])],
      'get /v1/loans/:id': [notFound('GET', `/v1/loans/${c.loanId}`)],
      'post /v1/loans/:id/extend': [
        notFound('POST', `/v1/loans/${c.loanId}/extend`, { expected_return: '2099-01-01' }),
      ],
      'get /v1/loaners/dashboard': [list('/v1/loaners/dashboard')],
      'get /v1/settings/custody': [list('/v1/settings/custody')],
      'put /v1/settings/custody': [
        // B changes ITS settings; A's are checked untouched at the end
        {
          method: 'PUT',
          url: '/v1/settings/custody',
          body: { default_expected_return_days: 30, loan_reminder_days: 7 },
          expect: [200],
        },
      ],
      // ---- M2 wave 1: people
      ...crud('people', c.personId, { notes: 'b was here' }),
      'get /v1/people': [
        list(`/v1/people?q=${c.personEmail}`),
        list(`/v1/people?location_id=${c.locationId}`),
        list(`/v1/people?department_id=${c.departmentId}`),
        list('/v1/people?limit=200&archived=include'),
      ],
      'post /v1/people': [
        refused('POST', '/v1/people', { display_name: unique('X'), location_id: c.locationId }),
        refused('POST', '/v1/people', { display_name: unique('X'), department_id: c.departmentId }),
        {
          method: 'POST',
          url: '/v1/people',
          body: { display_name: unique('B-own'), email: `${unique('b-own')}@replay.example` },
          expect: [201],
        },
      ],
      // ---- M2-USR-03: link and unlink a person and a login account (ED-22)
      'post /v1/people/:id/link-user': [
        notFound('POST', `/v1/people/${c.personId}/link-user`, { user_id: c.userId }),
        // B's own person to A's login account: there is no such account in B
        refused('POST', `/v1/people/${c.ownPersonId}/link-user`, { user_id: c.userId }),
      ],
      'delete /v1/people/:id/link-user': [notFound('DELETE', `/v1/people/${c.personId}/link-user`)],
      'get /v1/people/:id/assignments': [
        notFound('GET', `/v1/people/${c.personId}/assignments?state=all`),
      ],
      'get /v1/people/:id/history': [notFound('GET', `/v1/people/${c.personId}/history`)],
      // ---- [M2-W2 ACC]: BEGIN accessories and consumables
      ...crud('accessories', c.accessoryId, { notes: 'b was here' }),
      'get /v1/accessories': [
        list(`/v1/accessories?q=${c.markers[0]}`),
        list(`/v1/accessories?category_id=${c.accessoryCategoryId}`),
        list(`/v1/accessories?location_id=${c.locationId}`),
        list('/v1/accessories?low_stock=true&limit=200&archived=include'),
      ],
      'post /v1/accessories': [
        // A's category / location: refused, nothing created in A
        refused('POST', '/v1/accessories', {
          category_id: c.accessoryCategoryId,
          name: unique('X'),
          qty_total: 1,
        }),
        refused('POST', '/v1/accessories', {
          category_id: c.accessoryCategoryId,
          location_id: c.locationId,
          name: unique('X'),
          qty_total: 1,
        }),
      ],
      'post /v1/accessories/:id/checkout': [
        custody(`/v1/accessories/${c.accessoryId}/checkout`, { person_id: c.personId }),
        // B's own accessory to A's person / into A's location / onto A's asset: refused
        custody(`/v1/accessories/${c.ownAccessoryId}/checkout`, { person_id: c.personId }, [422]),
        custody(
          `/v1/accessories/${c.ownAccessoryId}/checkout`,
          { location_id: c.locationId },
          [422],
        ),
        custody(
          `/v1/accessories/${c.ownAccessoryId}/checkout`,
          { target_asset_id: c.assetId },
          [422],
        ),
      ],
      'post /v1/accessories/:id/checkin': [
        custody(`/v1/accessories/${c.accessoryId}/checkin`, {
          assignment_id: c.accessoryAssignmentId,
        }),
        // A's assignment on B's own accessory: not a valid reference
        custody(
          `/v1/accessories/${c.ownAccessoryId}/checkin`,
          { assignment_id: c.accessoryAssignmentId },
          [422],
        ),
      ],
      'get /v1/accessories/:id/assignments': [
        notFound('GET', `/v1/accessories/${c.accessoryId}/assignments?state=all`),
      ],
      ...crud('consumables', c.consumableId, { notes: 'b was here' }),
      'get /v1/consumables': [
        list(`/v1/consumables?q=${c.markers[0]}`),
        list(`/v1/consumables?category_id=${c.consumableCategoryId}`),
        list(`/v1/consumables?location_id=${c.locationId}`),
        list('/v1/consumables?low_stock=true&limit=200&archived=include'),
      ],
      'post /v1/consumables': [
        refused('POST', '/v1/consumables', {
          category_id: c.consumableCategoryId,
          name: unique('X'),
          initial_qty: 5,
        }),
        refused('POST', '/v1/consumables', {
          category_id: c.consumableCategoryId,
          location_id: c.locationId,
          name: unique('X'),
        }),
      ],
      'get /v1/consumables/:id/movements': [
        notFound('GET', `/v1/consumables/${c.consumableId}/movements`),
        // B's own consumable filtered by A's person: nothing of A's comes back
        {
          method: 'GET',
          url: `/v1/consumables/${c.ownConsumableId}/movements?person_id=${c.personId}`,
          expect: [200],
        },
      ],
      'post /v1/consumables/:id/movements': [
        custody(`/v1/consumables/${c.consumableId}/movements`, {
          qty_delta: -1,
          reason: 'issue',
        }),
        custody(
          `/v1/consumables/${c.consumableId}/movements`,
          { qty_delta: 5, reason: 'receive' },
          [404],
        ),
        // B's own consumable issued to A's person: refused
        custody(
          `/v1/consumables/${c.ownConsumableId}/movements`,
          { qty_delta: 1, reason: 'receive', person_id: c.personId },
          [422],
        ),
      ],
      'get /v1/people/:id/stock-movements': [
        notFound('GET', `/v1/people/${c.personId}/stock-movements`),
      ],
      // ---- [M2-W2 ACC]: END
      // ---- M2 wave 1: custody, history, moves, lifecycle actions
      'post /v1/assets/:id/checkout': [
        custody(`/v1/assets/${c.assetId}/checkout`, { person_id: c.personId }),
        // B's own asset to A's person / into A's location / onto A's asset: refused
        custody(`/v1/assets/${c.ownAssetId}/checkout`, { person_id: c.personId }, [422]),
        custody(`/v1/assets/${c.ownAssetId}/checkout`, { location_id: c.locationId }, [422]),
        custody(`/v1/assets/${c.ownAssetId}/checkout`, { target_asset_id: c.assetId }, [422]),
      ],
      'post /v1/assets/:id/checkin': [custody(`/v1/assets/${c.assetId}/checkin`, {})],
      'post /v1/assets/:id/transfer': [
        custody(`/v1/assets/${c.assetId}/transfer`, { person_id: c.personId }),
        custody(`/v1/assets/${c.ownAssetId}/transfer`, { person_id: c.personId }, [422]),
      ],
      // M2-UX-02: undo of a custody action (ED-23): A's asset is a 404 for B whatever the headers
      'post /v1/assets/:id/undo-custody': [
        {
          ...custody(`/v1/assets/${c.assetId}/undo-custody`, {
            assignment_id: c.accessoryAssignmentId,
          }),
          headers: {
            'idempotency-key': `replay-undo-${Date.now()}-${keyN++}`,
            'if-match': 'W/"1"',
          },
        },
      ],
      'get /v1/assets/:id/assignments': [notFound('GET', `/v1/assets/${c.assetId}/assignments`)],
      'get /v1/assets/:id/history': [notFound('GET', `/v1/assets/${c.assetId}/history`)],
      'post /v1/assets/:id/move': [
        notFound('POST', `/v1/assets/${c.assetId}/move`, { location_id: null }),
        refused('POST', `/v1/assets/${c.ownAssetId}/move`, { location_id: c.locationId }),
      ],
      'post /v1/assets/bulk-move': [
        {
          method: 'POST',
          url: '/v1/assets/bulk-move',
          body: { ids: [c.assetId], location_id: null },
          expect: [200],
        },
      ],
      'post /v1/assets/:id/dispose': [
        notFound('POST', `/v1/assets/${c.assetId}/dispose`, { reason: 'scrapped' }),
      ],
      'post /v1/assets/:id/mark-lost': [notFound('POST', `/v1/assets/${c.assetId}/mark-lost`, {})],
      'post /v1/assets/:id/mark-found': [
        notFound('POST', `/v1/assets/${c.assetId}/mark-found`, {}),
      ],
      // ---- M2 wave 2: repairs (M2-MNT-01)
      'get /v1/repairs': [
        list('/v1/repairs?limit=200&archived=include'),
        list(`/v1/repairs?asset_id=${c.repairAssetId}`),
        list(`/v1/repairs?vendor_id=${c.vendorId}&status=open,in_progress`),
      ],
      'post /v1/repairs': [
        // A's asset, A's vendor, A's status label: none exist in B
        refused('POST', '/v1/repairs', { asset_id: c.repairAssetId, title: 'b was here' }),
        refused('POST', '/v1/repairs', {
          asset_id: c.ownAssetId,
          title: 'b was here',
          vendor_id: c.vendorId,
          performed_by_person_id: c.personId,
          set_status_id: c.statusLabelId,
        }),
      ],
      'get /v1/repairs/:id': [notFound('GET', `/v1/repairs/${c.repairId}`)],
      'patch /v1/repairs/:id': [
        notFound('PATCH', `/v1/repairs/${c.repairId}`, { description: 'b was here' }),
      ],
      'delete /v1/repairs/:id': [notFound('DELETE', `/v1/repairs/${c.repairId}`)],
      'post /v1/repairs/:id/complete': [
        notFound('POST', `/v1/repairs/${c.repairId}/complete`, {
          resolution_notes: 'b was here',
        }),
      ],
      'get /v1/assets/:id/repair-summary': [
        notFound('GET', `/v1/assets/${c.repairAssetId}/repair-summary`),
      ],
      // ---- M2 wave 2: notifications (M2-NOT-01)
      'get /v1/notifications': [
        list('/v1/notifications?limit=200'),
        list('/v1/notifications?unread=true'),
      ],
      'get /v1/notifications/unread-count': [list('/v1/notifications/unread-count')],
      'post /v1/notifications/read-all': [
        { method: 'POST', url: '/v1/notifications/read-all', body: {}, expect: [200] },
      ],
      'post /v1/notifications/:id/read': [
        notFound('POST', `/v1/notifications/${c.notificationId}/read`, {}),
      ],
      'get /v1/notification-preferences': [list('/v1/notification-preferences')],
      'put /v1/notification-preferences/:type': [
        // B changes ITS preference; A's is checked untouched at the end
        {
          method: 'PUT',
          url: '/v1/notification-preferences/export.completed',
          body: { in_app: false, email: 'off' },
          expect: [200],
        },
      ],
      'get /v1/notification-rules': [list('/v1/notification-rules')],
      'put /v1/notification-rules/:type': [
        {
          method: 'PUT',
          url: '/v1/notification-rules/consumable.low_stock',
          body: { enabled: false },
          expect: [200],
        },
      ],
      'get /v1/notification-deliveries': [
        list('/v1/notification-deliveries?limit=200'),
        list(`/v1/notification-deliveries?user_id=${c.userId}`),
      ],
      // ---- M2 wave 2: saved views (M2-REG-01)
      'get /v1/saved-views': [
        list('/v1/saved-views?limit=200'),
        list('/v1/saved-views?scope=shared'),
      ],
      'post /v1/saved-views': [
        { method: 'POST', url: '/v1/saved-views', body: { name: unique('B-own') }, expect: [201] },
      ],
      'get /v1/saved-views/:id': [
        notFound('GET', `/v1/saved-views/${c.sharedViewId}`),
        notFound('GET', `/v1/saved-views/${c.privateViewId}`),
      ],
      'patch /v1/saved-views/:id': [
        notFound('PATCH', `/v1/saved-views/${c.sharedViewId}`, { name: 'b was here' }),
      ],
      'delete /v1/saved-views/:id': [notFound('DELETE', `/v1/saved-views/${c.sharedViewId}`)],
      'put /v1/saved-views/:id/sharing': [
        notFound('PUT', `/v1/saved-views/${c.privateViewId}/sharing`, { shared: true }),
      ],
      // ---- M2 wave 2: exports (M2-REG-02)
      'get /v1/exports': [list('/v1/exports?limit=200')],
      'post /v1/exports': [
        // B exports: accepted, and the worker only ever reads B's rows
        {
          method: 'POST',
          url: '/v1/exports',
          body: { resource: 'assets', filters: { q: 'no-such-asset-in-b' } },
          expect: [202],
        },
      ],
      'get /v1/exports/:id': [notFound('GET', `/v1/exports/${c.exportId}`)],
      // ---- M2 wave 3: imports (M2-IMP-01..07)
      'get /v1/imports/presets': [list('/v1/imports/presets')],
      'get /v1/imports/presets/:key/template': [
        list('/v1/imports/presets/assets/template?format=csv'),
        list('/v1/imports/presets/google_admin_chromeos/template?format=xlsx'),
      ],
      'get /v1/imports': [list('/v1/imports?limit=200')],
      'post /v1/imports': [
        { method: 'POST', url: '/v1/imports', body: { entity_type: 'person' }, expect: [201] },
      ],
      'get /v1/imports/:id': [notFound('GET', `/v1/imports/${c.importId}`)],
      'patch /v1/imports/:id': [
        notFound('PATCH', `/v1/imports/${c.importId}`, { options: { on_match: 'update' } }),
      ],
      'post /v1/imports/:id/analyze': [
        notFound('POST', `/v1/imports/${c.importId}/analyze`, {
          file_attachment_id: c.attachmentId,
        }),
      ],
      'post /v1/imports/:id/apply-template': [
        notFound('POST', `/v1/imports/${c.importId}/apply-template`, {
          template_id: c.importTemplateId,
        }),
      ],
      'get /v1/imports/:id/values': [
        notFound('GET', `/v1/imports/${c.importId}/values?field=category`),
      ],
      'post /v1/imports/:id/dry-run': [notFound('POST', `/v1/imports/${c.importId}/dry-run`, {})],
      'get /v1/imports/:id/rows': [notFound('GET', `/v1/imports/${c.importId}/rows`)],
      'get /v1/imports/:id/errors.csv': [notFound('GET', `/v1/imports/${c.importId}/errors.csv`)],
      'post /v1/imports/:id/commit': [
        custody(`/v1/imports/${c.importId}/commit`, { dry_run_digest: 'a'.repeat(64) }),
      ],
      'post /v1/imports/:id/cancel': [notFound('POST', `/v1/imports/${c.importId}/cancel`, {})],
      'get /v1/import-templates': [list('/v1/import-templates?limit=200')],
      'post /v1/import-templates': [
        {
          method: 'POST',
          url: '/v1/import-templates',
          body: {
            name: unique('B-tpl'),
            entity_type: 'asset',
            columns: [{ header: 'Serial', target: 'serial' }],
          },
          expect: [201],
        },
        refused('POST', '/v1/import-templates', {
          name: unique('B-from'),
          from_import_id: c.importId,
        }),
      ],
      'get /v1/import-templates/:id': [
        notFound('GET', `/v1/import-templates/${c.importTemplateId}`),
      ],
      'patch /v1/import-templates/:id': [
        notFound('PATCH', `/v1/import-templates/${c.importTemplateId}`, { name: 'b was here' }),
      ],
      'delete /v1/import-templates/:id': [
        notFound('DELETE', `/v1/import-templates/${c.importTemplateId}`),
      ],
      // ---- access
      'get /v1/users': [list('/v1/users?limit=200')],
      'post /v1/users': [
        refused('POST', '/v1/users', {
          email: 'x@y.example',
          display_name: 'x',
          role_assignments: [{ role_id: c.roleId }],
        }),
      ],
      'get /v1/users/:id': [notFound('GET', `/v1/users/${c.userId}`)],
      'patch /v1/users/:id': [
        notFound('PATCH', `/v1/users/${c.userId}`, { display_name: 'b was here' }),
      ],
      'delete /v1/users/:id': [notFound('DELETE', `/v1/users/${c.userId}`)],
      'delete /v1/users/:id/invitation': [
        notFound('DELETE', `/v1/users/${c.invitedUserId}/invitation`),
      ],
      'post /v1/users/:id/invitation/resend': [
        notFound('POST', `/v1/users/${c.invitedUserId}/invitation/resend`),
      ],
      'post /v1/users/:id/role-assignments': [
        {
          ...notFound('POST', `/v1/users/${c.userId}/role-assignments`, { role_id: c.roleId }),
          headers: { 'if-match': '*' },
        },
      ],
      'delete /v1/users/:id/role-assignments/:assignment_id': [
        notFound(
          'DELETE',
          `/v1/users/${c.userId}/role-assignments/0194a000-0000-7000-8000-000000000001`,
        ),
      ],
      'delete /v1/users/:id/mfa': [notFound('DELETE', `/v1/users/${c.userId}/mfa`)],
      'get /v1/users/:id/sessions': [notFound('GET', `/v1/users/${c.userId}/sessions`)],
      'delete /v1/users/:id/sessions/:session_id': [
        notFound('DELETE', `/v1/users/${c.userId}/sessions/${c.sessionId}`),
      ],
      'get /v1/roles': [list('/v1/roles')],
      'get /v1/companies': [list('/v1/companies')],
      'get /v1/api-keys': [list('/v1/api-keys')],
      'post /v1/api-keys': [
        {
          method: 'POST',
          url: '/v1/api-keys',
          body: { name: 'b-own', scopes: ['asset:read'] },
          expect: [201],
        },
      ],
      'delete /v1/api-keys/:id': [notFound('DELETE', `/v1/api-keys/${c.apiKeyId}`)],
      'delete /v1/auth/sessions/:id': [notFound('DELETE', `/v1/auth/sessions/${c.sessionId}`)],
    };
  };

  /** Routes with no tenant-owned resource id in the request, with the reason they are exempt. */
  const EXEMPT: Record<string, string> = {
    'get /healthz': 'probe: no tenant data',
    'get /readyz': 'probe: no tenant data',
    'get /v1/health': 'probe: no tenant data',
    'get /v1/version': 'probe: no tenant data',
    'get /v1/openapi.json': 'public contract document: no tenant data',
    'post /v1/auth/login': 'pre-tenant: the credential in the body selects the tenant',
    'post /v1/auth/mfa/verify': 'pre-tenant: bound to the login challenge of the caller',
    'post /v1/auth/password/forgot':
      'pre-tenant: always answers the same, no lookup result is revealed',
    'post /v1/auth/password/reset': 'pre-tenant: the single-use token is the credential',
    'get /v1/auth/password-policy': 'public: static policy',
    'get /v1/auth/invitations/:token': 'pre-tenant: the single-use token is the credential',
    'post /v1/auth/invitations/accept': 'pre-tenant: the single-use token is the credential',
    'put /v1/files/:token':
      'capability URL: the HMAC-signed token is the credential and names one object key; covered by test/files',
    'get /v1/files/:token':
      'capability URL: the HMAC-signed token is the credential and names one object key; covered by test/files',
    'get /v1/auth/me': 'principal-scoped: describes the caller only',
    'post /v1/auth/logout': "principal-scoped: ends the caller's own session",
    'get /v1/auth/sessions': "principal-scoped: lists the caller's own sessions",
    'delete /v1/auth/sessions': "principal-scoped: revokes the caller's other sessions",
    'delete /v1/auth/mfa': "principal-scoped: the caller's own factor",
    'post /v1/auth/mfa/enrol': "principal-scoped: the caller's own factor",
    'post /v1/auth/mfa/enrol/confirm': "principal-scoped: the caller's own factor",
    'post /v1/auth/mfa/recovery-codes/regenerate': "principal-scoped: the caller's own codes",
  };

  const b = () => B.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    A = await createTenant(app, tenancy, 'replaya');
    B = await createTenant(app, tenancy, 'replayb');
    const a = A.admin;
    const marker = unique('isoA').replace(/-/g, '');
    const category = (
      await a.post('/v1/categories', { name: `${marker} category`, tag_prefix: 'ISA-' })
    ).body;
    const manufacturer = (await a.post('/v1/manufacturers', { name: `${marker} maker` })).body;
    const model = (
      await a.post('/v1/models', {
        category_id: category.id,
        manufacturer_id: manufacturer.id,
        name: `${marker} model`,
      })
    ).body;
    const vendor = (await a.post('/v1/vendors', { name: `${marker} vendor` })).body;
    const label = (
      await a.post('/v1/status-labels', { name: `${marker} label`, state_type: 'pending' })
    ).body;
    const field = (
      await a.post('/v1/custom-fields', {
        category_id: category.id,
        key: 'tier',
        label: 'Tier',
        data_type: 'text',
      })
    ).body;
    const asset = (
      await a.post('/v1/assets', {
        category_id: category.id,
        model_id: model.id,
        vendor_id: vendor.id,
        name: `${marker} asset`,
        serial: `${marker}-serial`,
        custom_data: { tier: 'gold' },
      })
    ).body;
    // M2 wave 1: a location, a person, and a checked-out asset in A; an asset in B
    const locationName = `${marker} hall`;
    const location = (await a.post('/v1/locations', { name: locationName, kind: 'site' })).body;
    const personEmail = `${marker}-person@replay.example`;
    const person = (
      await a.post('/v1/people', {
        display_name: `${marker} person`,
        email: personEmail,
        employee_ref: `E-${marker}`,
        location_id: location.id,
      })
    ).body;
    // [DEPT] BEGIN a department of A, with A's person and A's asset in it; one department of B
    const departmentName = `${marker} dept`;
    const department = (
      await a.post('/v1/departments', {
        name: departmentName,
        code: `${marker}-D`,
        manager_person_id: person.id,
      })
    ).body;
    await a.patch(
      `/v1/people/${person.id}`,
      { department_id: department.id },
      { headers: { 'if-match': String((await a.get(`/v1/people/${person.id}`)).headers.etag) } },
    );
    await a.patch(
      `/v1/assets/${asset.id}`,
      { department_id: department.id },
      { headers: { 'if-match': String((await a.get(`/v1/assets/${asset.id}`)).headers.etag) } },
    );
    const ownDepartment = (await b().post('/v1/departments', { name: unique('B-dept') })).body;
    // [DEPT] END
    const bCategory = (await b().post('/v1/categories', { name: unique('B-cat') })).body;
    const bAsset = (await b().post('/v1/assets', { category_id: bCategory.id })).body;
    // [LOAN] BEGIN A's pool with a device on loan to A's person; a pool, a person and a device of B
    const loanerPoolName = `${marker} pool`;
    const loanerPool = (
      await a.post('/v1/loaner-pools', { name: loanerPoolName, home_location_id: location.id })
    ).body;
    const loanerAsset = (
      await a.post('/v1/assets', {
        category_id: category.id,
        asset_tag: `${marker}-LOAN`,
        serial: `${marker}-loan-sn`,
      })
    ).body;
    await a.post(`/v1/loaner-pools/${loanerPool.id}/members`, { asset_id: loanerAsset.id });
    const loan = (
      await a.post(
        `/v1/loaner-pools/${loanerPool.id}/checkout`,
        { person_id: person.id, asset_id: loanerAsset.id },
        { headers: { 'idempotency-key': `seed-loan-${marker}` } },
      )
    ).body;
    const bPool = (await b().post('/v1/loaner-pools', { name: unique('B-pool') })).body;
    const bPerson = (await b().post('/v1/people', { display_name: unique('B-kid') })).body;
    const bLoanerAsset = (await b().post('/v1/assets', { category_id: bCategory.id })).body;
    await b().post(`/v1/loaner-pools/${bPool.id}/members`, { asset_id: bLoanerAsset.id });
    // [LOAN] END
    await a.post(
      `/v1/assets/${asset.id}/checkout`,
      { person_id: person.id, note: `${marker} note` },
      { headers: { 'idempotency-key': `seed-checkout-${marker}` } },
    );
    // [M2-W2 ACC]: BEGIN an accessory (with units out) and a consumable (with a movement) in A; one of each in B
    const accCategory = (
      await a.post('/v1/categories', { name: `${marker} acc category`, kind: 'accessory' })
    ).body;
    const accessory = (
      await a.post('/v1/accessories', {
        category_id: accCategory.id,
        name: `${marker} charger`,
        qty_total: 5,
        location_id: location.id,
      })
    ).body;
    const accAssignment = (
      await a.post(
        `/v1/accessories/${accessory.id}/checkout`,
        { person_id: person.id, quantity: 2 },
        { headers: { 'idempotency-key': `seed-acc-checkout-${marker}` } },
      )
    ).body;
    const conCategory = (
      await a.post('/v1/categories', { name: `${marker} con category`, kind: 'consumable' })
    ).body;
    const consumable = (
      await a.post('/v1/consumables', {
        category_id: conCategory.id,
        name: `${marker} toner`,
        initial_qty: 4,
        location_id: location.id,
      })
    ).body;
    await a.post(
      `/v1/consumables/${consumable.id}/movements`,
      { qty_delta: -1, reason: 'issue', person_id: person.id },
      { headers: { 'idempotency-key': `seed-con-issue-${marker}` } },
    );
    const bAccCategory = (
      await b().post('/v1/categories', { name: unique('B-acc'), kind: 'accessory' })
    ).body;
    const bConCategory = (
      await b().post('/v1/categories', { name: unique('B-con'), kind: 'consumable' })
    ).body;
    const bAccessory = (
      await b().post('/v1/accessories', {
        category_id: bAccCategory.id,
        name: unique('B-charger'),
        qty_total: 3,
      })
    ).body;
    const bConsumable = (
      await b().post('/v1/consumables', { category_id: bConCategory.id, name: unique('B-toner') })
    ).body;
    // [M2-W2 ACC]: END
    const attachmentName = `${marker}-secret.png`;
    const attachment = (
      await a.post('/v1/attachments', {
        entity_type: 'asset',
        entity_id: asset.id,
        filename: attachmentName,
        content_type: 'image/png',
        size_bytes: 50,
      })
    ).body.attachment;
    const viewer = await createUser(app, A, 'viewer');
    const invited = (
      await a.post('/v1/users', {
        email: `invited-${marker}@replay.example`,
        display_name: 'Invited',
        role_assignments: [{ role_id: A.roles.viewer! }],
      })
    ).body;
    const sessions = (await viewer.client.get('/v1/auth/sessions')).body.data as Array<{
      id: string;
    }>;
    const key = (await a.post('/v1/api-keys', { name: `${marker}-key`, scopes: ['asset:read'] }))
      .body;
    // [M2-W2 LABELS]
    const aTemplates = (await a.get('/v1/labels/templates')).body.data as Array<{ id: string }>;
    const aBatch = (
      await a.post(
        '/v1/labels/batches',
        { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
        { headers: { 'idempotency-key': `seed-labels-${marker}` } },
      )
    ).body;
    // M2 wave 2: a repair (with A's vendor and status), two saved views (one shared with all of A),
    // a notification of A's administrator, and an export request
    const repairAssetRes = await a.post('/v1/assets', {
      category_id: category.id,
      name: `${marker} repairable`,
    });
    expect(repairAssetRes.status, repairAssetRes.raw).toBe(201);
    const repairAsset = repairAssetRes.body;
    const repair = await a.post('/v1/repairs', {
      asset_id: repairAsset.id,
      title: `${marker} repair`,
      vendor_id: vendor.id,
      set_status_id: label.id,
      cost: { amount_minor: 4200, currency: 'EUR' },
    });
    expect(repair.status, repair.raw).toBe(201);
    const sharedView = await a.post('/v1/saved-views', {
      name: `${marker} shared view`,
      filters: { q: marker },
    });
    await a.put(
      `/v1/saved-views/${sharedView.body.id}/sharing`,
      { shared: true },
      { headers: { 'if-match': String(sharedView.headers.etag) } },
    );
    const privateView = await a.post('/v1/saved-views', {
      name: `${marker} private view`,
      filters: { q: marker },
    });
    const adminId = (await a.get('/v1/auth/me')).body.user.id as string;
    const notificationId = randomUUID();
    await ownerTenantSql(
      A.tenantId,
      `insert into app.notification (id, tenant_id, user_id, type, title, dedupe_key)
       values ($1, $2, $3, 'export.completed', $4, $5)`,
      [notificationId, A.tenantId, adminId, `${marker} notification`, `replay-${marker}`],
    );
    const exportJob = await a.post('/v1/exports', { resource: 'assets' });
    expect(exportJob.status, exportJob.raw).toBe(202);
    const importJob = await a.post('/v1/imports', { entity_type: 'asset' });
    expect(importJob.status, importJob.raw).toBe(201);
    const importTemplate = await a.post('/v1/import-templates', {
      name: `${marker} template`,
      entity_type: 'asset',
      columns: [{ header: 'Serial', target: 'serial' }],
    });
    expect(importTemplate.status, importTemplate.raw).toBe(201);
    // M2-SEC-01: a row of A in every remaining tenant table, so the catalogue probes below cover every
    // table and every foreign key (rows the worker, the mailer or the login flow write in production are
    // inserted directly, as the owner, inside A's tenant context)
    const transferAsset = (
      await a.post('/v1/assets', { category_id: category.id, name: `${marker} moved` })
    ).body;
    await a.post(
      `/v1/assets/${transferAsset.id}/checkout`,
      { person_id: person.id },
      { headers: { 'idempotency-key': `seed-move-out-${marker}` } },
    );
    const moved = await a.post(
      `/v1/assets/${transferAsset.id}/transfer`,
      { location_id: location.id },
      { headers: { 'idempotency-key': `seed-move-${marker}` } },
    );
    expect(moved.status, moved.raw).toBe(201);
    expect(
      (
        await a.put('/v1/notification-preferences/export.completed', {
          in_app: true,
          email: 'digest',
        })
      ).status,
    ).toBe(200);
    expect(
      (await a.put('/v1/notification-rules/consumable.low_stock', { enabled: true })).status,
    ).toBe(200);
    // an asset checked out to another asset (assignment.target_asset_id)
    const docked = (
      await a.post('/v1/assets', { category_id: category.id, name: `${marker} docked` })
    ).body;
    const dock = await a.post(
      `/v1/assets/${docked.id}/checkout`,
      { target_asset_id: transferAsset.id },
      { headers: { 'idempotency-key': `seed-dock-${marker}` } },
    );
    expect(dock.status, dock.raw).toBe(201);
    // the invited user's role assignments scoped to A's location and to A's company (no API for that yet)
    for (const [scope, column, value] of [
      ['location', 'scope_location_id', location.id],
      ['company', 'scope_company_id', '(select id from app.company where is_default)'],
    ] as const) {
      await ownerTenantSql(
        A.tenantId,
        `insert into app.role_assignment (id, tenant_id, user_id, role_id, scope_type, ${column})
         values ($1, $2, $3, $4, '${scope}', ${scope === 'location' ? '$5::uuid' : value})`,
        [
          randomUUID(),
          A.tenantId,
          invited.id,
          A.roles.technician,
          ...(scope === 'location' ? [value] : []),
        ],
      );
    }
    await ownerTenantSql(
      A.tenantId,
      `insert into app.import_row (tenant_id, job_id, row_no, line_no, raw) values ($1, $2, 1, 2, '["x"]'::jsonb)`,
      [A.tenantId, importJob.body.id],
    );
    await ownerTenantSql(
      A.tenantId,
      `insert into app.loan_alert (id, tenant_id, assignment_id, kind, alert_date, expected_return)
       values ($1, $2, $3, 'due_soon', current_date, current_date + 1)`,
      [randomUUID(), A.tenantId, loan.assignment.id],
    );
    await ownerTenantSql(
      A.tenantId,
      `insert into app.mail_outbox (id, tenant_id, template) values ($1, $2, 'auth.mfa-enabled')`,
      [randomUUID(), A.tenantId],
    );
    await ownerTenantSql(
      A.tenantId,
      `insert into app.notification_delivery (id, tenant_id, user_id, type, channel, status)
       values ($1, $2, $3, 'export.completed', 'in_app', 'delivered')`,
      [randomUUID(), A.tenantId, adminId],
    );
    // identity (non-tenant schema, foreign keys into app): the login and recovery flows' rows
    for (const [sql, params] of [
      [
        `insert into identity.external_identity (tenant_id, user_id, provider, subject) values ($1, $2, 'google', $3)`,
        [A.tenantId, viewer.id, `sub-${marker}`],
      ],
      [
        `insert into identity.mfa_challenge (tenant_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '5 minutes')`,
        [A.tenantId, viewer.id, Buffer.from(randomUUID())],
      ],
      [
        `insert into identity.mfa_factor (id, tenant_id, user_id, type, secret_encrypted) values ($1, $2, $3, 'totp', $4)`,
        [randomUUID(), A.tenantId, viewer.id, Buffer.from('not-a-real-secret')],
      ],
      [
        `insert into identity.mfa_recovery_code (id, tenant_id, user_id, code_hash) values ($1, $2, $3, $4)`,
        [randomUUID(), A.tenantId, viewer.id, Buffer.from(randomUUID())],
      ],
      [
        `insert into identity.password_reset_token (tenant_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
        [A.tenantId, viewer.id, Buffer.from(randomUUID())],
      ],
      [
        `insert into identity.security_event (id, tenant_id, event_type) values ($1, $2, 'other')`,
        [randomUUID(), A.tenantId],
      ],
    ] as const) {
      await ownerSql(sql, [...params]);
    }
    fx = {
      repairId: repair.body.id,
      repairAssetId: repairAsset.id,
      notificationId,
      sharedViewId: sharedView.body.id,
      privateViewId: privateView.body.id,
      exportId: exportJob.body.id,
      importId: importJob.body.id,
      importTemplateId: importTemplate.body.id,
      categoryId: category.id,
      manufacturerId: manufacturer.id,
      modelId: model.id,
      vendorId: vendor.id,
      statusLabelId: label.id,
      customFieldId: field.id,
      assetId: asset.id,
      assetTag: asset.asset_tag,
      serial: asset.serial,
      labelCode: asset.label_code,
      attachmentId: attachment.id,
      attachmentName,
      userId: viewer.id,
      invitedUserId: invited.id,
      sessionId: sessions[0]!.id,
      apiKeyId: key.id,
      roleId: A.roles.viewer!,
      locationId: location.id,
      locationName,
      personId: person.id,
      personEmail,
      departmentId: department.id,
      departmentName,
      ownDepartmentId: ownDepartment.id,
      ownAssetId: bAsset.id,
      loanerPoolId: loanerPool.id,
      loanerPoolName,
      loanerAssetId: loanerAsset.id,
      loanId: loan.assignment.id,
      ownPoolId: bPool.id,
      ownPersonId: bPerson.id,
      ownLoanerAssetId: bLoanerAsset.id,
      // [M2-W2 ACC]
      accessoryId: accessory.id,
      accessoryName: accessory.name,
      accessoryLabel: accessory.label_code,
      accessoryCategoryId: accCategory.id,
      accessoryAssignmentId: accAssignment.id,
      consumableId: consumable.id,
      consumableName: consumable.name,
      consumableLabel: consumable.label_code,
      consumableCategoryId: conCategory.id,
      ownAccessoryId: bAccessory.id,
      ownConsumableId: bConsumable.id,
      labelTemplateId: aTemplates[0]!.id,
      labelBatchId: aBatch.id,
      markers: [
        aTemplates[0]!.id,
        aBatch.id,
        marker,
        accessory.id,
        accessory.label_code,
        accAssignment.id,
        accCategory.id,
        consumable.id,
        consumable.label_code,
        conCategory.id,
        location.id,
        person.id,
        category.id,
        manufacturer.id,
        model.id,
        vendor.id,
        label.id,
        field.id,
        asset.id,
        asset.asset_tag,
        asset.serial,
        asset.label_code,
        attachment.id,
        attachmentName,
        viewer.id,
        invited.id,
        key.id,
        viewer.email,
        A.adminEmail,
        repair.body.id,
        repairAsset.id,
        notificationId,
        sharedView.body.id,
        privateView.body.id,
        department.id,
        exportJob.body.id,
        importJob.body.id,
        importTemplate.body.id,
        loanerPool.id,
        loanerPoolName,
        loanerAsset.id,
        loanerAsset.asset_tag,
        loanerAsset.label_code,
        loan.assignment.id,
      ],
    };
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  /** Snapshot of A's mutable state: id -> ETag, from A's own admin. */
  async function snapshotA(): Promise<Record<string, string>> {
    const etag = async (url: string) => String((await A.admin.get(url)).headers.etag ?? 'none');
    return {
      category: await etag(`/v1/categories/${fx.categoryId}`),
      manufacturer: await etag(`/v1/manufacturers/${fx.manufacturerId}`),
      model: await etag(`/v1/models/${fx.modelId}`),
      vendor: await etag(`/v1/vendors/${fx.vendorId}`),
      label: await etag(`/v1/status-labels/${fx.statusLabelId}`),
      field: await etag(`/v1/custom-fields/${fx.customFieldId}`),
      asset: await etag(`/v1/assets/${fx.assetId}`),
      user: await etag(`/v1/users/${fx.userId}`),
      location: await etag(`/v1/locations/${fx.locationId}`),
      person: await etag(`/v1/people/${fx.personId}`),
      department: await etag(`/v1/departments/${fx.departmentId}`),
      departments: String((await A.admin.get('/v1/departments?limit=200')).body.data.length),
      // [LOAN] A's pool, its members and its loan are untouched
      loanerPool: await etag(`/v1/loaner-pools/${fx.loanerPoolId}`),
      loanerPools: String((await A.admin.get('/v1/loaner-pools?limit=200')).body.data.length),
      loanerMembers: JSON.stringify(
        (await A.admin.get(`/v1/loaner-pools/${fx.loanerPoolId}/members`)).body.data.map(
          (m: { asset_id: string; available: boolean }) => [m.asset_id, m.available],
        ),
      ),
      loans: JSON.stringify(
        (await A.admin.get('/v1/loans?state=on_loan,due_today,overdue,returned')).body.data.map(
          (l: { id: string; expected_return: string; state: string }) => [
            l.id,
            l.expected_return,
            l.state,
          ],
        ),
      ),
      custodySettings: await etag('/v1/settings/custody'),
      // custody of A's asset is untouched: the same open assignment and the same history
      assignments: JSON.stringify(
        (await A.admin.get(`/v1/assets/${fx.assetId}/assignments`)).body.data.map(
          (s: { id: string; checked_in_at: unknown }) => [s.id, s.checked_in_at],
        ),
      ),
      history: String(
        (await A.admin.get(`/v1/assets/${fx.assetId}/history?limit=200`)).body.data.length,
      ),
      locations: String((await A.admin.get('/v1/locations?limit=200')).body.data.length),
      people: String((await A.admin.get('/v1/people?limit=200')).body.data.length),
      // [M2-W2 ACC] A's stock is exactly as it was: same versions, same units out, same ledger
      accessory: await etag(`/v1/accessories/${fx.accessoryId}`),
      accessoryAssignments: JSON.stringify(
        (
          await A.admin.get(`/v1/accessories/${fx.accessoryId}/assignments?state=all`)
        ).body.data.map((s: { id: string; quantity: number; quantity_returned: number }) => [
          s.id,
          s.quantity,
          s.quantity_returned,
        ]),
      ),
      accessories: String((await A.admin.get('/v1/accessories?limit=200')).body.data.length),
      consumable: await etag(`/v1/consumables/${fx.consumableId}`),
      consumableLedger: JSON.stringify(
        (await A.admin.get(`/v1/consumables/${fx.consumableId}/movements?limit=200`)).body.data.map(
          (m: { id: string; balance_after: number }) => [m.id, m.balance_after],
        ),
      ),
      consumables: String((await A.admin.get('/v1/consumables?limit=200')).body.data.length),
      template: await etag('/v1/settings/asset-tag-template'),
      labelTemplate: await etag(`/v1/labels/templates/${fx.labelTemplateId}`),
      labelBatch: JSON.stringify(
        (
          (await A.admin.get('/v1/labels/batches?limit=200')).body.data as Array<{
            id: string;
            status: string;
          }>
        ).map((x) => [x.id, x.status]),
      ),
      files: await etag('/v1/settings/files'),
      attachments: JSON.stringify(
        (
          await A.admin.get(`/v1/attachments?entity_type=asset&entity_id=${fx.assetId}`)
        ).body.data.map((x: { id: string; scan_status: string }) => [x.id, x.scan_status]),
      ),
      keys: JSON.stringify(
        (await A.admin.get('/v1/api-keys')).body.data.map(
          (k: { id: string; revoked_at: unknown }) => [k.id, k.revoked_at],
        ),
      ),
      assets: String(
        (await A.admin.get('/v1/assets?include_total=true&limit=1&archived=include')).body.page
          .total,
      ),
      users: String((await A.admin.get('/v1/users?limit=200')).body.data.length),
      // M2 wave 2: A's repair, views, inbox, preferences, rules and exports are untouched
      repair: await etag(`/v1/repairs/${fx.repairId}`),
      repairs: String(
        (await A.admin.get('/v1/repairs?limit=200&archived=include')).body.data.length,
      ),
      repairedAsset: await etag(`/v1/assets/${fx.repairAssetId}`),
      views: JSON.stringify(
        (await A.admin.get('/v1/saved-views?limit=200')).body.data.map(
          (v: { id: string; name: string; is_shared: boolean }) => [v.id, v.name, v.is_shared],
        ),
      ),
      unread: JSON.stringify((await A.admin.get('/v1/notifications/unread-count')).body),
      preferences: JSON.stringify(
        (await A.admin.get('/v1/notification-preferences')).body.data.map(
          (p: { type: string; in_app: boolean; email: string }) => [p.type, p.in_app, p.email],
        ),
      ),
      rules: JSON.stringify(
        (await A.admin.get('/v1/notification-rules')).body.data.map(
          (r: { type: string; enabled: boolean }) => [r.type, r.enabled],
        ),
      ),
      // M2 wave 3: A's import and template are untouched
      import: await etag(`/v1/imports/${fx.importId}`),
      imports: String((await A.admin.get('/v1/imports?limit=200')).body.data.length),
      importTemplate: await etag(`/v1/import-templates/${fx.importTemplateId}`),
      importTemplates: String(
        (await A.admin.get('/v1/import-templates?limit=200')).body.data.length,
      ),
      exports: JSON.stringify(
        (await A.admin.get('/v1/exports?limit=200')).body.data.map(
          (e: { id: string; status: string }) => [e.id, e.status],
        ),
      ),
    };
  }

  it('every route of the application is registered with the replay (or exempt, with a reason)', () => {
    const routes = discoverRoutes(app.get(ModulesContainer, { strict: false }));
    const known = { ...cases() };
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    const missing = keys.filter((k) => !(k in known) && !(k in EXEMPT));
    expect(missing, 'routes without a replay case: add one in route-replay.e2e.test.ts').toEqual(
      [],
    );
    // no stale registrations either
    const stale = [...Object.keys(known), ...Object.keys(EXEMPT)].filter((k) => !keys.includes(k));
    expect(stale, 'replay cases for routes that no longer exist').toEqual([]);
    // the registry is what this harness exists for: it must be covered, not exempted
    for (const r of routes.filter((r) =>
      /^\/v1\/(assets|attachments|categories|manufacturers|models|status-labels|vendors|custom-fields|scan|search|settings|users|locations|people|labels)/.test(
        r.path,
      ),
    )) {
      expect(`${r.method} ${r.path}` in EXEMPT, `${r.method} ${r.path} must not be exempt`).toBe(
        false,
      );
    }
  });

  it("replays every route as tenant B: 404 / refused / empty, never A's data, never a cross-tenant write", async () => {
    const before = await snapshotA();
    const results: string[] = [];
    for (const [route, replays] of Object.entries(cases())) {
      for (const r of replays) {
        const headers: Record<string, string> = { ...(r.headers ?? {}) };
        if (
          r.method === 'PATCH' ||
          r.method === 'DELETE' ||
          (r.method === 'POST' && /\/(restore|complete)$/.test(r.url)) ||
          r.method === 'PUT'
        ) {
          headers['if-match'] = '*';
        }
        const res = await b().request(r.method, r.url, { body: r.body, headers });
        const where = `${route} <- ${r.method} ${r.url}`;
        expect(r.expect, `${where}: got ${res.status} ${res.raw.slice(0, 200)}`).toContain(
          res.status,
        );
        // the problem document echoes the request path as `instance` (B sent it); nothing else may carry A's data
        const answer =
          res.body && typeof res.body === 'object'
            ? { ...res.body, instance: undefined }
            : res.body;
        const text = JSON.stringify(answer ?? res.raw);
        for (const m of fx.markers) {
          expect(text.includes(m), `${where}: the response leaks ${m}`).toBe(false);
        }
        results.push(`${res.status} ${r.method} ${r.url.split('?')[0]}`);
      }
    }
    expect(results.length).toBeGreaterThanOrEqual(60);

    // A is exactly as it was: no version moved, nothing archived, nothing created, nothing revoked
    expect(await snapshotA()).toEqual({ ...before });
    // hundreds of sequential requests: more than vitest's 30 s default on a heavily loaded machine
  }, 120_000);

  it("the answers for B's own data are B's: B sees only its own asset after creating one with A's tag", async () => {
    const own = await b().post('/v1/categories', { name: unique('B-cat'), tag_prefix: 'ISA-' });
    const created = await b().post('/v1/assets', {
      category_id: own.body.id,
      asset_tag: fx.assetTag,
      serial: fx.serial,
    });
    expect(created.status, created.raw).toBe(201);
    // same tag and serial as A's asset, different tenant: each tenant resolves its own
    const mine = await b().get(`/v1/assets?tag=${fx.assetTag}`);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].id).toBe(created.body.id);
    expect(mine.body.data[0].id).not.toBe(fx.assetId);
    const theirs = await A.admin.get(`/v1/assets?tag=${fx.assetTag}`);
    expect(theirs.body.data.map((x: { id: string }) => x.id)).toEqual([fx.assetId]);
    const scanB = await b().get(`/v1/scan/resolve?code=${fx.assetTag}`);
    expect(scanB.body.asset.id).toBe(created.body.id);
    expect((await b().get(`/v1/scan/resolve?code=${fx.labelCode}`)).status).toBe(404);
  });

  // ---- M2-SEC-01: probes driven by the database catalogue (every table, every foreign key)

  /**
   * Tenant tables in which these fixtures give A no row, with the reason. The probe FAILS for a table
   * that has no row of A and is not listed here (a new table must get a fixture row, so it is probed),
   * and for a listed table that does have rows (a stale entry).
   */
  const NO_ROWS_OF_A: Record<string, string> = {};

  // the probe reads each table's truth as the owner (ADMIN_DATABASE_URL); without it the test is skipped
  it.skipIf(!env.adminUrl)(
    'every tenant table: B sees none of A’s rows, A sees all of them (auto-discovered, both modes)',
    async () => {
      const r = await visibilityProbe(A.tenantId, B.tenantId);
      expect(r.leaks, 'tables in which tenant B reads rows of tenant A').toEqual([]);
      expect(r.ownMismatch, 'tables in which tenant A does not see its own rows').toEqual([]);
      expect(
        r.empty.filter((t) => !(t in NO_ROWS_OF_A)),
        'tenant tables without a fixture row of A: give them one in this file',
      ).toEqual([]);
      expect(
        Object.keys(NO_ROWS_OF_A).filter((t) => !r.empty.includes(t)),
        'stale NO_ROWS_OF_A entries',
      ).toEqual([]);
      expect(r.checked.length).toBeGreaterThanOrEqual(40);
    },
  );

  it.skipIf(!env.adminUrl)(
    'every foreign key between tenant tables refuses a reference into another tenant (auto-discovered)',
    async () => {
      const r = await foreignKeyProbe([A.tenantId, B.tenantId]);
      expect(r.failures, 'foreign keys that do not keep the reference inside the tenant').toEqual(
        [],
      );
      expect(r.unprobed, 'foreign keys without a referencing fixture row of A or B').toEqual([]);
      expect(r.probed.length).toBeGreaterThanOrEqual(80);
      // the control: a composite key that is not enforced is reported (the probe can see a leak)
      const control = await foreignKeyProbeControl(A.tenantId);
      expect(control.failures).toEqual([expect.stringMatching(/^zz_probe_fk .*ACCEPTED/)]);
    },
    120_000,
  );

  it('a request without a credential never reaches tenant data', async () => {
    const anon = b().clone();
    anon.cookie = undefined;
    for (const url of [
      `/v1/assets/${fx.assetId}`,
      '/v1/assets',
      `/v1/scan/resolve?code=${fx.assetTag}`,
      '/v1/search?q=x',
      `/v1/categories/${fx.categoryId}`,
    ]) {
      const res = await (anon as Client).get(url, { cookie: false });
      expect(res.status, url).toBe(401);
    }
  });
});
