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

/** The ids of every asset that is in a loaner pool. */
export async function pooledAssetIds(page: Page): Promise<Set<string>> {
  const pools = await api<{ data: PoolRef[] }>(page, 'GET', '/v1/loaner-pools');
  const ids = new Set<string>();
  for (const pool of pools.json.data) {
    const members = await api<{ data: Array<{ asset_id: string }> }>(
      page,
      'GET',
      `/v1/loaner-pools/${pool.id}/members?limit=200`,
    );
    for (const member of members.json.data) ids.add(member.asset_id);
  }
  return ids;
}

/** A deployable device that is in no pool. */
export async function looseDevice(page: Page): Promise<AssetLite> {
  const free = await api<{ data: AssetLite[] }>(
    page,
    'GET',
    '/v1/assets?state_type=deployable&assigned=false&limit=200&sort=asset_tag',
  );
  const taken = await pooledAssetIds(page);
  return free.json.data.find((asset) => !taken.has(asset.id))!;
}

/** The seeded pool of staff laptops: two devices per borrower, two of its three laptops free. */
export async function staffPool(page: Page): Promise<PoolRef> {
  const { json } = await api<{ data: PoolRef[] }>(page, 'GET', '/v1/loaner-pools');
  return json.data.find((pool) => pool.name.startsWith('Staff'))!;
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
  const free = await api<{ data: AssetLite[] }>(
    page,
    'GET',
    '/v1/assets?state_type=deployable&assigned=false&limit=200&sort=asset_tag',
  );
  const taken = await pooledAssetIds(page);
  const devices = free.json.data.filter((asset) => !taken.has(asset.id)).slice(0, count);
  for (const device of devices) {
    const added = await api(page, 'POST', `/v1/loaner-pools/${created.json.id}/members`, {
      asset_id: device.id,
    });
    expect(added.status).toBe(201);
  }
  return { pool: created.json, devices };
}

/** Six devices: four can be created, one repeats a serial number of the file, one has no category. */
export const CSV_ASSETS = [
  'Serial Number,Asset ID,Category,Location',
  '5CG0001,IMP-0001,Chromebook,Room 101',
  '5CG0002,IMP-0002,Chromebook,Room 999',
  ',IMP-0003,Chromebook,Room 101',
  '5CG0001,IMP-0004,Chromebook,Room 101',
  '5CG0005,IMP-0005,Hovercraft,Room 101',
  '5CG0006,IMP-0006,,Room 101',
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

/**
 * Where an import is brought to: a draft; `uploaded` (the file is uploaded, scanned and read, so it is
 * `analyzed`, or `failed` when it cannot be read); `mapped`; a dry run in flight; a reviewed dry run; a
 * commit in flight; a finished import.
 */
export type ImportStage =
  'draft' | 'uploaded' | 'mapped' | 'dry-run-running' | 'reviewed' | 'committing' | 'committed';

/** Column header -> target field of the standard asset file. */
export const ASSET_MAPPING = {
  'Serial Number': 'serial',
  'Asset ID': 'asset_tag',
  Category: 'category',
  Location: 'location',
};

/** The state of an import. */
export async function importState(page: Page, id: string): Promise<string> {
  return (await api<{ state: string }>(page, 'GET', `/v1/imports/${id}`)).json.state;
}

/**
 * An import brought to `stage` through the API, as the wizard does it: a draft from the preset, the file
 * uploaded against it (the mock's virus scan takes about a second and a half) and analysed, the mapping
 * (`mapping` is header -> target; the match key is the serial number unless `importOptions` say else), the
 * dry run, the commit.
 */
export async function importAt(
  page: Page,
  stage: ImportStage,
  options: {
    csv?: string;
    filename?: string;
    contentType?: string;
    mapping?: Record<string, string>;
    importOptions?: Record<string, unknown>;
    entity?: string;
    /** The preset the import is created from (`assets`, `people`, `google_admin_chromeos` ...). */
    preset?: string;
  } = {},
): Promise<{ id: string }> {
  const csv = options.csv ?? CSV_ASSETS;
  const entity = options.entity ?? 'asset';
  const job = await api<{ id: string }>(page, 'POST', '/v1/imports', {
    entity_type: entity,
    preset_key: options.preset ?? (entity === 'asset' ? 'assets' : undefined),
  });
  expect(job.status).toBe(201);
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
      content_type: options.contentType ?? 'text/csv',
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
      { timeout: 15_000 },
    )
    .toBe('clean');
  const queued = await api(page, 'POST', `/v1/imports/${id}/analyze`, {
    file_attachment_id: attachmentId,
  });
  expect(queued.status).toBe(202);
  await expect.poll(async () => importState(page, id), { timeout: 15_000 }).not.toBe('analyzing');
  if (stage === 'uploaded') return { id };

  const read = await api<{ headers: string[] }>(page, 'GET', `/v1/imports/${id}`);
  const targets: Record<string, string> = options.mapping ?? ASSET_MAPPING;
  const mapped = await api(
    page,
    'PATCH',
    `/v1/imports/${id}`,
    {
      mapping: {
        columns: read.json.headers.map((header, index) => ({
          index,
          target: targets[header] ?? null,
        })),
      },
      options: options.importOptions ?? { match_on: 'serial' },
    },
    { 'if-match': read.etag ?? '' },
  );
  expect(mapped.status).toBe(200);
  if (stage === 'mapped') return { id };

  expect((await api(page, 'POST', `/v1/imports/${id}/dry-run`)).status).toBe(202);
  if (stage === 'dry-run-running') return { id };
  await expect.poll(async () => importState(page, id), { timeout: 30_000 }).toBe('dry_run_done');
  if (stage === 'reviewed') return { id };

  const digest = (await api<{ dry_run_digest: string }>(page, 'GET', `/v1/imports/${id}`)).json
    .dry_run_digest;
  expect(
    (await api(page, 'POST', `/v1/imports/${id}/commit`, { dry_run_digest: digest })).status,
  ).toBe(202);
  if (stage === 'committing') return { id };
  await expect.poll(async () => importState(page, id), { timeout: 40_000 }).toBe('completed');
  return { id };
}

/** Puts an asset into the first status of the `undeployable` type (In repair, Out for fix, ...). */
export async function makeUndeployable(page: Page, assetId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const labels = (await (await fetch('/v1/status-labels?limit=200')).json()) as {
      data: Array<{ id: string; name: string; state_type: string }>;
    };
    const label = labels.data.find((s) => s.state_type === 'undeployable')!;
    const read = await fetch(`/v1/assets/${id}`);
    await fetch(`/v1/assets/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-e2e',
        'if-match': read.headers.get('etag') ?? '',
      },
      body: JSON.stringify({ status_id: label.id }),
    });
    return label.name;
  }, assetId);
}
