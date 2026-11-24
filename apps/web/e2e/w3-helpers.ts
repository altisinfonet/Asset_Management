import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Helpers of the M2 wave 3 specs (loaners, imports). The mock API lives in the page (a service
 * worker), so state is arranged with `fetch` inside the page, like the app itself does.
 */
export interface ApiResult<T = unknown> {
  status: number;
  json: T;
  etag: string | null;
}

/** Call the mock API from the page. The app must be loaded first (the mock starts with it). */
export async function api<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const response = await fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'csrf-e2e',
          'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}-key`,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: response.status, json, etag: response.headers.get('etag') } as ApiResult<T>;
    },
    { method, path, body, headers },
  );
}

export async function loadApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('main#main')).toBeVisible();
}

export interface PoolRef {
  id: string;
  name: string;
}

export interface AssetLite {
  id: string;
  asset_tag: string;
}

/** The seeded pool of students' Chromebooks (the first loaner request seeds the pools). */
export async function studentPool(page: Page): Promise<PoolRef> {
  const { json } = await api<{ data: PoolRef[] }>(page, 'GET', '/v1/loaner-pools');
  return json.data.find((pool) => pool.name.startsWith('Student'))!;
}

/** A new pool with `count` free devices added, for scripts that need more than the seeded ones. */
export async function poolWithDevices(
  page: Page,
  name: string,
  count: number,
): Promise<{ pool: PoolRef; devices: AssetLite[] }> {
  const created = await api<PoolRef>(page, 'POST', '/v1/loaner-pools', {
    name,
    default_loan_days: 5,
    max_loan_days: 14,
  });
  const free = await api<{ data: Array<AssetLite & { loaner_pool_id: string | null }> }>(
    page,
    'GET',
    '/v1/assets?state_type=deployable&assigned=false&limit=200&sort=asset_tag',
  );
  const devices = free.json.data.filter((asset) => !asset.loaner_pool_id).slice(0, count);
  for (const device of devices) {
    const added = await api(page, 'POST', `/v1/loaner-pools/${created.json.id}/members`, {
      asset_id: device.id,
    });
    expect(added.status).toBe(201);
  }
  return { pool: created.json, devices };
}

export const CSV_ASSETS = [
  'Serial Number,Asset ID,Category,Location',
  '5CG0001,IMP-0001,Chromebook,Room 101',
  '5CG0002,IMP-0002,Chromebook,Room 999',
  ',IMP-0003,Chromebook,Room 101',
  '5CG0001,IMP-0004,Chromebook,Room 101',
  '5CG0005,IMP-0005,Hovercraft,Room 101',
].join('\n');

export const CSV_MATCHING = [
  'Serial Number,Asset ID,Category',
  '5CG0010,IMP-0010,Chromebook',
  '5CG0011,IMP-0011,Chromebook',
].join('\n');

/** A CSV of `rows` matching devices (a long import, to catch a progress bar in flight). */
export function bigCsv(rows: number): string {
  const lines = ['Serial Number,Asset ID,Category'];
  for (let n = 1; n <= rows; n += 1) {
    const id = String(n).padStart(4, '0');
    lines.push(`SN-${id},BIG-${id},Chromebook`);
  }
  return lines.join('\n');
}

export type ImportStage =
  'draft' | 'uploaded' | 'mapped' | 'dry-run-running' | 'reviewed' | 'committing' | 'committed';

export const ASSET_MAPPING = {
  'Serial Number': 'serial',
  'Asset ID': 'asset_tag',
  Category: 'category',
  Location: 'location',
};

/**
 * An import brought to `stage` through the API: draft job, file uploaded against it (the mock's virus
 * scan takes about a second and a half), mapping, dry run, commit.
 */
export async function importAt(
  page: Page,
  stage: ImportStage,
  options: {
    csv?: string;
    filename?: string;
    mapping?: Record<string, string>;
    importOptions?: Record<string, unknown>;
    entity?: string;
    source?: string;
  } = {},
): Promise<{ id: string }> {
  const csv = options.csv ?? CSV_ASSETS;
  const job = await api<{ id: string }>(page, 'POST', '/v1/imports', {
    source: options.source ?? 'csv',
    entity_type: options.entity ?? 'asset',
  });
  const id = job.json.id;
  if (stage === 'draft') return { id };

  const created = await api<{ attachment: { id: string }; upload: { url: string } }>(
    page,
    'POST',
    '/v1/attachments',
    {
      entity_type: 'import_job',
      entity_id: id,
      kind: 'import_file',
      filename: options.filename ?? 'devices.csv',
      content_type: 'text/csv',
      size_bytes: new TextEncoder().encode(csv).byteLength,
    },
  );
  const attachmentId = created.json.attachment.id;
  await page.evaluate(
    async ({ url, text }) => {
      await fetch(url, { method: 'PUT', body: text, headers: { 'content-type': 'text/csv' } });
    },
    { url: created.json.upload.url, text: csv },
  );
  await api(page, 'POST', `/v1/attachments/${attachmentId}/complete`);
  await expect
    .poll(
      async () =>
        (await api<{ scan_status: string }>(page, 'GET', `/v1/attachments/${attachmentId}`)).json
          .scan_status,
      {
        timeout: 15_000,
      },
    )
    .toBe('clean');
  const etagOf = async () => (await api(page, 'GET', `/v1/imports/${id}`)).etag ?? '';
  const attached = await api(
    page,
    'PATCH',
    `/v1/imports/${id}`,
    { file_attachment_id: attachmentId },
    { 'if-match': await etagOf() },
  );
  expect(attached.status).toBe(200);
  if (stage === 'uploaded') return { id };

  const mapped = await api(
    page,
    'PATCH',
    `/v1/imports/${id}`,
    {
      mapping: options.mapping ?? ASSET_MAPPING,
      options: options.importOptions ?? { match_on: 'serial', create_missing_references: false },
    },
    { 'if-match': await etagOf() },
  );
  expect(mapped.status).toBe(200);
  if (stage === 'mapped') return { id };

  expect((await api(page, 'POST', `/v1/imports/${id}/dry-run`)).status).toBe(202);
  if (stage === 'dry-run-running') return { id };
  await expect
    .poll(async () => (await api<{ state: string }>(page, 'GET', `/v1/imports/${id}`)).json.state, {
      timeout: 15_000,
    })
    .toBe('dry_run_complete');
  if (stage === 'reviewed') return { id };

  const digest = (await api<{ dry_run_digest: string }>(page, 'GET', `/v1/imports/${id}`)).json
    .dry_run_digest;
  expect(
    (await api(page, 'POST', `/v1/imports/${id}/commit`, { dry_run_digest: digest })).status,
  ).toBe(202);
  if (stage === 'committing') return { id };
  await expect
    .poll(async () => (await api<{ state: string }>(page, 'GET', `/v1/imports/${id}`)).json.state, {
      timeout: 30_000,
    })
    .toBe('committed');
  return { id };
}
