import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { JobHandlerRegistry } from '../../src/jobs/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import type { Client } from '../auth/support.js';
import { type FilesHarness, fetchUrl } from '../files/support.js';

export { type FilesHarness, startFilesApp, fetchUrl } from '../files/support.js';

/** The public base URL the labels' QR codes are built from in these tests. */
export const WEB_BASE = 'https://assets.school.test';

const logger = pino({ level: 'silent' });

/**
 * Runs one job handler the way the worker wraps it: inside the tenant transaction (with the queue's
 * own transaction limit), with the given retry count (0 = first attempt).
 */
export async function runLabelJob(
  h: FilesHarness,
  queue: 'label.render' | 'label.sweep',
  payload: { tenantId: string } & Record<string, unknown>,
  retryCount = 0,
): Promise<void> {
  const handler = h.app.get(JobHandlerRegistry).get(queue);
  if (!handler) throw new Error(`no handler registered for ${queue}`);
  const tenancy = h.app.get(TenancyService, { strict: false });
  const jobId = randomUUID();
  await tenancy.withTenantTx(
    { tenantId: payload.tenantId, actorId: jobId },
    (tx) =>
      (handler.handle as (p: unknown, c: unknown) => Promise<void>)(payload, {
        jobId,
        queue,
        retryCount,
        logger,
        tenantId: payload.tenantId,
        tx,
      }),
    { timeoutMs: 120_000 },
  );
}

/** The queued `label.render` jobs of a batch (and removes them from the fake queue). */
export function takeRenderJobs(h: FilesHarness): Array<{ tenantId: string; batchId: string }> {
  const taken: Array<{ tenantId: string; batchId: string }> = [];
  for (let i = 0; i < h.jobs.jobs.length;) {
    const job = h.jobs.jobs[i]!;
    if (job.name === 'label.render') {
      taken.push(job.payload as { tenantId: string; batchId: string });
      h.jobs.jobs.splice(i, 1);
    } else i++;
  }
  return taken;
}

let keyN = 0;
export const idem = (): { headers: Record<string, string> } => ({
  headers: { 'idempotency-key': `labels-e2e-${Date.now()}-${keyN++}` },
});

/** `POST /v1/labels/batches`; returns the response. */
export const requestBatch = (client: Client, body: Record<string, unknown>) =>
  client.post('/v1/labels/batches', body, idem());

/** Downloads the PDF of a ready batch the way a browser does: GET the batch, follow its URL. */
export async function downloadBatchPdf(
  h: FilesHarness,
  client: Client,
  batchId: string,
): Promise<{ pdf: Buffer; batch: Record<string, unknown> }> {
  const res = await client.get(`/v1/labels/batches/${batchId}`);
  if (res.status !== 200) throw new Error(`get batch: ${res.status} ${res.raw}`);
  const batch = res.body as Record<string, unknown>;
  if (typeof batch.download_url !== 'string') {
    throw new Error(`batch ${batchId} is ${String(batch.status)}, no download_url`);
  }
  const file = await fetchUrl(h, batch.download_url);
  if (file.status !== 200) throw new Error(`download: ${file.status}`);
  return { pdf: file.body, batch };
}
