import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled, type Client, type Resp } from '../auth/support.js';
import { mode } from '../support/db.js';
import { ExportRunner } from '../../src/exports/index.js';
import { NOTIFIER, type Notifier } from '../../src/ports/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import {
  UNIVERSAL_STATUSES,
  WAVE2_NOT_TAGS,
  loadContract,
  loadProblemCodes,
} from '../support/contract.js';
import { check } from '../support/schema-check.js';
import {
  type App,
  type Basics,
  type TenantFixture,
  basics,
  contractViolations,
  createTenant,
  createUser,
  newAsset,
  newTenancy,
  startRegistryApp,
  unique,
} from '../lifecycle/support.js';

/**
 * M1-PLAT-03 contract test, live half, for the M2 wave-2 tags (Repairs, Notifications, Views, Exports)
 * and for `GET /v1/auth/me` (`mfa_policy`): every operation is called with valid input and its answer
 * must match the contract (status, response schema, problem code), and the walk must cover every
 * operation of the tags.
 */
describe.skipIf(!dbEnabled)(`wave-2 contract (live, ${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let b: Basics;
  const { operations } = loadContract();
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const walked = new Set<string>();
  const problemCodes = loadProblemCodes();

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'w2contract');
    b = await basics(t);
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  function verify(operationId: string, status: number, body: unknown, raw: string, ctype: string) {
    const op = byId.get(operationId);
    expect(op, `operation ${operationId} is not in the contract`).toBeDefined();
    expect(
      op!.statuses.includes(status) || UNIVERSAL_STATUSES.includes(status),
      `${operationId} answered ${status}, the contract documents ${op!.statuses.join(', ')}`,
    ).toBe(true);
    if (status < 400) {
      walked.add(operationId);
      const schema = op!.responseSchemas[status];
      if (schema) {
        expect(
          check({ $ref: `#/components/schemas/${schema}` }, body),
          `${operationId} body`,
        ).toEqual([]);
      } else if (status !== 204) {
        expect(raw, `${operationId}: the contract documents no body for ${status}`).toBe('');
      }
    } else {
      expect(ctype).toMatch(/^application\/problem\+json/);
      expect(check({ $ref: '#/components/schemas/Problem' }, body)).toEqual([]);
      const code = (body as { code: string }).code;
      expect(problemCodes[code], `unknown problem code ${code}`).toContain(status);
    }
  }

  async function hit(
    operationId: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    expected: number,
    options: { body?: unknown; ifMatch?: string; client?: Client } = {},
  ): Promise<Resp> {
    const res = await (options.client ?? t.admin).request(method, url, {
      body: options.body,
      headers: options.ifMatch ? { 'if-match': options.ifMatch } : {},
    });
    expect(res.status, `${operationId}: ${method} ${url} -> ${res.raw.slice(0, 300)}`).toBe(
      expected,
    );
    verify(operationId, res.status, res.body, res.raw, String(res.headers['content-type']));
    return res;
  }

  it('walks every operation of the wave-2 tags: statuses, bodies and problem codes match the contract', async () => {
    const manager = await createUser(app, t, 'asset_manager');
    const viewer = await createUser(app, t, 'viewer');
    const asset = await newAsset(t.admin, b.categoryId);

    // ---------------------------------------------------------------- Auth: the MFA policy
    await hit('getMe', 'GET', '/v1/auth/me', 200);

    // ---------------------------------------------------------------- Repairs
    const created = await hit('createRepair', 'POST', '/v1/repairs', 201, {
      body: {
        asset_id: asset.id,
        title: unique('Fix'),
        cost: { amount_minor: 500, currency: 'USD' },
        set_status_id: b.status['In repair'],
      },
    });
    const repairId = created.body.id as string;
    await hit('createRepair', 'POST', '/v1/repairs', 422, {
      body: { asset_id: randomUUID(), title: 'x' },
    });
    await hit('createRepair', 'POST', '/v1/repairs', 409, {
      body: { asset_id: asset.id, title: 'second', set_status_id: b.status['Broken'] },
    });
    await hit('createRepair', 'POST', '/v1/repairs', 403, {
      body: { asset_id: asset.id, title: 'x' },
      client: viewer.client,
    });
    await hit('listRepairs', 'GET', `/v1/repairs?asset_id=${asset.id}&include_total=true`, 200);
    await hit('listRepairs', 'GET', '/v1/repairs?status=bogus', 400);
    await hit('getRepair', 'GET', `/v1/repairs/${repairId}`, 200);
    await hit('getRepair', 'GET', `/v1/repairs/${randomUUID()}`, 404);
    const updated = await hit('updateRepair', 'PATCH', `/v1/repairs/${repairId}`, 200, {
      body: { description: 'details' },
      ifMatch: String(created.headers.etag),
    });
    await hit('updateRepair', 'PATCH', `/v1/repairs/${repairId}`, 412, {
      body: { description: 'x' },
      ifMatch: 'W/"99"',
    });
    await hit('updateRepair', 'PATCH', `/v1/repairs/${repairId}`, 428, {
      body: { description: 'x' },
    });
    await hit('getAssetRepairSummary', 'GET', `/v1/assets/${asset.id}/repair-summary`, 200);
    await hit('getAssetRepairSummary', 'GET', `/v1/assets/${randomUUID()}/repair-summary`, 404);
    await hit('archiveRepair', 'DELETE', `/v1/repairs/${repairId}`, 409, {
      ifMatch: String(updated.headers.etag),
    });
    const done = await hit('completeRepair', 'POST', `/v1/repairs/${repairId}/complete`, 200, {
      body: { resolution_notes: 'done' },
      ifMatch: String(updated.headers.etag),
    });
    await hit('completeRepair', 'POST', `/v1/repairs/${repairId}/complete`, 409, { ifMatch: '*' });
    await hit('archiveRepair', 'DELETE', `/v1/repairs/${repairId}`, 204, {
      ifMatch: String(done.headers.etag),
    });

    // ---------------------------------------------------------------- Notifications
    const notifier = app.get<Notifier>(NOTIFIER, { strict: false });
    const runtime = app.get(TenancyService, { strict: false });
    await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      notifier.notify(tx, {
        type: 'export.completed',
        recipients: [viewer.id],
        vars: { filename: 'a.csv', rows: 1 },
        dedupeKey: unique('contract'),
      }),
    );
    const list = await hit(
      'listNotifications',
      'GET',
      '/v1/notifications?limit=5&unread=true',
      200,
      { client: viewer.client },
    );
    await hit('listNotifications', 'GET', '/v1/notifications?limit=0', 400, {
      client: viewer.client,
    });
    await hit('getNotificationUnreadCount', 'GET', '/v1/notifications/unread-count', 200, {
      client: viewer.client,
    });
    await hit(
      'markNotificationRead',
      'POST',
      `/v1/notifications/${list.body.data[0].id}/read`,
      200,
      { client: viewer.client, body: {} },
    );
    await hit('markNotificationRead', 'POST', `/v1/notifications/${randomUUID()}/read`, 404, {
      client: viewer.client,
      body: {},
    });
    await hit('markAllNotificationsRead', 'POST', '/v1/notifications/read-all', 200, {
      client: viewer.client,
      body: {},
    });
    await hit('listNotificationPreferences', 'GET', '/v1/notification-preferences', 200, {
      client: viewer.client,
    });
    await hit(
      'updateNotificationPreference',
      'PUT',
      '/v1/notification-preferences/export.completed',
      200,
      {
        client: viewer.client,
        body: { email: 'digest', in_app: true },
      },
    );
    await hit(
      'updateNotificationPreference',
      'PUT',
      '/v1/notification-preferences/export.completed',
      422,
      {
        client: viewer.client,
        body: {},
      },
    );
    await hit(
      'updateNotificationPreference',
      'PUT',
      '/v1/notification-preferences/no.such_type',
      404,
      {
        client: viewer.client,
        body: { email: 'off' },
      },
    );
    await hit('listNotificationRules', 'GET', '/v1/notification-rules', 200);
    await hit('listNotificationRules', 'GET', '/v1/notification-rules', 403, {
      client: viewer.client,
    });
    await hit('updateNotificationRule', 'PUT', '/v1/notification-rules/consumable.low_stock', 200, {
      body: { enabled: true, recipient_roles: ['asset_manager'] },
    });
    await hit('updateNotificationRule', 'PUT', '/v1/notification-rules/attachment.infected', 422, {
      body: { recipient_roles: ['viewer'] },
    });
    await hit(
      'listNotificationDeliveries',
      'GET',
      '/v1/notification-deliveries?limit=5&channel=in_app',
      200,
    );
    await hit(
      'listNotificationDeliveries',
      'GET',
      '/v1/notification-deliveries?channel=pigeon',
      400,
    );

    // ---------------------------------------------------------------- Views
    const view = await hit('createSavedView', 'POST', '/v1/saved-views', 201, {
      client: manager.client,
      body: { name: unique('V'), filters: { q: 'x' }, columns: ['tag'], sort: '-created_at' },
    });
    await hit('createSavedView', 'POST', '/v1/saved-views', 409, {
      client: manager.client,
      body: { name: view.body.name },
    });
    await hit('createSavedView', 'POST', '/v1/saved-views', 422, {
      client: manager.client,
      body: { name: '' },
    });
    await hit('listSavedViews', 'GET', '/v1/saved-views?scope=mine', 200, {
      client: manager.client,
    });
    await hit('listSavedViews', 'GET', '/v1/saved-views?resource=people', 400, {
      client: manager.client,
    });
    await hit('getSavedView', 'GET', `/v1/saved-views/${view.body.id}`, 200, {
      client: manager.client,
    });
    await hit('getSavedView', 'GET', `/v1/saved-views/${view.body.id}`, 404, {
      client: viewer.client,
    });
    const renamed = await hit('updateSavedView', 'PATCH', `/v1/saved-views/${view.body.id}`, 200, {
      client: manager.client,
      body: { name: unique('Renamed') },
      ifMatch: String(view.headers.etag),
    });
    const shared = await hit(
      'shareSavedView',
      'PUT',
      `/v1/saved-views/${view.body.id}/sharing`,
      200,
      {
        client: manager.client,
        body: { shared: true },
        ifMatch: String(renamed.headers.etag),
      },
    );
    await hit('shareSavedView', 'PUT', `/v1/saved-views/${view.body.id}/sharing`, 403, {
      client: viewer.client,
      body: { shared: false },
      ifMatch: String(shared.headers.etag),
    });
    await hit('deleteSavedView', 'DELETE', `/v1/saved-views/${view.body.id}`, 404, {
      client: viewer.client,
      ifMatch: '*',
    });
    await hit('deleteSavedView', 'DELETE', `/v1/saved-views/${view.body.id}`, 204, {
      client: manager.client,
      ifMatch: String(shared.headers.etag),
    });

    // ---------------------------------------------------------------- Exports
    const exp = await hit('createExport', 'POST', '/v1/exports', 202, {
      client: manager.client,
      body: { resource: 'assets', filters: { q: asset.body.asset_tag } },
    });
    await hit('createExport', 'POST', '/v1/exports', 422, {
      client: manager.client,
      body: { resource: 'nope' },
    });
    await hit('createExport', 'POST', '/v1/exports', 403, {
      client: viewer.client,
      body: { resource: 'assets' },
    });
    await hit('listExports', 'GET', '/v1/exports?status=queued', 200, { client: manager.client });
    await hit('listExports', 'GET', '/v1/exports?status=bogus', 400, { client: manager.client });
    await hit('getExport', 'GET', `/v1/exports/${exp.body.id}`, 200, { client: manager.client });
    await hit('getExport', 'GET', `/v1/exports/${randomUUID()}`, 404, { client: manager.client });
    // after the worker ran, the link is there and the Export still matches its schema
    const runner = app.get(ExportRunner, { strict: false });
    await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
      runner.run(
        { tenantId: t.tenantId, exportId: exp.body.id },
        {
          tenantId: t.tenantId,
          tx,
          jobId: 'j',
          queue: 'export.run',
          retryCount: 0,
          logger: pino({ level: 'silent' }),
        },
      ),
    );
    const finished = await hit('getExport', 'GET', `/v1/exports/${exp.body.id}`, 200, {
      client: manager.client,
    });
    expect(finished.body.download_url).toMatch(/^https:\/\//);

    // ---------------------------------------------------------------- coverage
    const required = operations.filter((o) => WAVE2_NOT_TAGS.has(o.tag)).map((o) => o.operationId);
    expect(required.filter((id) => !walked.has(id))).toEqual([]);
  });
});
