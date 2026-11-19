import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Global, Module, type Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pino from 'pino';
import { PgAuditWriter } from '../../src/audit/index.js';
import { JobHandlerRegistry } from '../../src/jobs/index.js';
import { PgOutboxPublisher } from '../../src/outbox/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  MAIL_SENDER,
  OUTBOX_PUBLISHER,
  SECRET_BOX,
  STORAGE_ADAPTER,
  VIRUS_SCANNER,
  type StorageAdapter,
  type VirusScanner,
} from '../../src/ports/index.js';
import { FakeJobQueue, FakeVirusScanner } from '../../src/ports/fakes.js';
import { ClamdScanner, DisabledScanner } from '../../src/scanner/index.js';
import {
  FileTokenSigner,
  LocalStorageAdapter,
  S3StorageAdapter,
  newObjectKey,
} from '../../src/storage/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import { ownerTenantSql, testPorts, startApp, type Client } from '../auth/support.js';

export type Driver = 'local' | 's3';

/** `S3_ENDPOINT` (MinIO) enables the S3 variants; `CLAMD_HOST` the real ClamAV ones. */
export const s3Env = process.env.S3_ENDPOINT
  ? {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_TEST_BUCKET ?? 'e2e-files',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin-dev',
    }
  : null;
export const clamdEnv = process.env.CLAMD_HOST
  ? { host: process.env.CLAMD_HOST, port: Number(process.env.CLAMD_PORT ?? 3310) }
  : null;

export type ScannerKind = 'clamd' | 'fake' | 'off';

export interface FilesHarness {
  app: NestFastifyApplication;
  driver: Driver;
  storage: StorageAdapter;
  scanner: VirusScanner;
  jobs: FakeJobQueue;
  config: { SCAN_REQUIRED: boolean };
  close(): Promise<void>;
}

function portsModule(storage: StorageAdapter, scanner: VirusScanner, jobs: FakeJobQueue): Type {
  @Global()
  @Module({
    providers: [
      { provide: AUDIT_WRITER, useFactory: () => new PgAuditWriter() },
      { provide: OUTBOX_PUBLISHER, useFactory: () => new PgOutboxPublisher() },
      { provide: MAIL_SENDER, useValue: testPorts.mail },
      { provide: SECRET_BOX, useValue: testPorts.secretBox },
      { provide: JOB_QUEUE, useValue: jobs },
      { provide: STORAGE_ADAPTER, useValue: storage },
      { provide: VIRUS_SCANNER, useValue: scanner },
    ],
    exports: [
      AUDIT_WRITER,
      OUTBOX_PUBLISHER,
      MAIL_SENDER,
      SECRET_BOX,
      JOB_QUEUE,
      STORAGE_ADAPTER,
      VIRUS_SCANNER,
    ],
  })
  class FilesTestPortsModule {}
  return FilesTestPortsModule;
}

/** The whole API with a real database, the chosen storage driver and the chosen scanner. */
export async function startFilesApp(
  opts: {
    driver?: Driver;
    scanner?: ScannerKind;
    scanRequired?: boolean;
    extra?: Record<string, string>;
  } = {},
): Promise<FilesHarness> {
  const driver = opts.driver ?? 'local';
  const kind = opts.scanner ?? 'fake';
  const scanRequired = opts.scanRequired ?? true;
  const tmp = await mkdtemp(join(tmpdir(), 'at-files-'));

  let storage: StorageAdapter;
  if (driver === 's3') {
    if (!s3Env) throw new Error('S3_ENDPOINT is not set');
    storage = new S3StorageAdapter({
      endpoint: s3Env.endpoint,
      region: 'us-east-1',
      bucket: s3Env.bucket,
      accessKeyId: s3Env.accessKeyId,
      secretAccessKey: s3Env.secretAccessKey,
      forcePathStyle: true,
      createBucket: true,
    });
  } else {
    storage = new LocalStorageAdapter(
      join(tmp, 'objects'),
      'http://files.test',
      new FileTokenSigner(randomBytes(32)),
    );
  }
  await storage.ensureReady();

  let scanner: VirusScanner;
  if (kind === 'clamd') {
    if (!clamdEnv) throw new Error('CLAMD_HOST is not set');
    scanner = new ClamdScanner({ ...clamdEnv, timeoutMs: 60_000 });
  } else if (kind === 'off') scanner = new DisabledScanner();
  else scanner = new FakeVirusScanner();

  const jobs = new FakeJobQueue();
  const { app } = await startApp(
    {
      FILES_LOCAL_DIR: join(tmp, 'unused'),
      SCAN_REQUIRED: String(scanRequired),
      ...(opts.extra ?? {}),
    },
    { ports: portsModule(storage, scanner, jobs) },
  );
  return {
    app,
    driver,
    storage,
    scanner,
    jobs,
    config: { SCAN_REQUIRED: scanRequired },
    async close() {
      await app.close();
      if (storage instanceof S3StorageAdapter) storage.close();
      await rm(tmp, { recursive: true, force: true });
    },
  };
}

export interface Upload {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
}

export interface FileResponse {
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: Buffer;
}

/** What the browser does: PUT the bytes to the presigned URL. */
export async function putBytes(
  h: FilesHarness,
  upload: Upload,
  body: Buffer,
  headers: Record<string, string> = upload.headers,
): Promise<FileResponse> {
  if (h.driver === 'local') {
    const res = await h.app.inject({
      method: 'PUT',
      url: new URL(upload.url).pathname,
      headers,
      payload: body,
    });
    return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
  }
  const res = await fetch(upload.url, { method: 'PUT', headers, body: new Uint8Array(body) });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: Buffer.from(await res.arrayBuffer()),
  };
}

/** What the browser does with `download_url` / `thumbnail_url`. */
export async function fetchUrl(h: FilesHarness, url: string): Promise<FileResponse> {
  if (h.driver === 'local') {
    const res = await h.app.inject({ method: 'GET', url: new URL(url).pathname });
    return { status: res.statusCode, headers: res.headers, body: res.rawPayload };
  }
  const res = await fetch(url);
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: Buffer.from(await res.arrayBuffer()),
  };
}

export interface Created {
  attachment: { id: string; [member: string]: unknown };
  upload: Upload & { expires_at: string };
}

/** `POST /v1/attachments` as `client`; returns the parsed body (and the response). */
export async function createAttachment(
  client: Client,
  body: Record<string, unknown>,
  expectStatus = 201,
): Promise<Created> {
  const res = await client.post('/v1/attachments', body);
  if (res.status !== expectStatus) {
    throw new Error(`create attachment: ${res.status} ${res.raw.slice(0, 300)}`);
  }
  return res.body as Created;
}

/** The raw row of an attachment, read as the owner (storage keys are never part of the API). */
export interface RawAttachment {
  storage_key: string;
  thumb_key: string | null;
  scan_status: string;
  scan_detail: string | null;
  archived_at: Date | null;
  uploaded_at: Date | null;
  exif_stripped: boolean;
  version: number;
  [column: string]: unknown;
}

export async function rowOf(tenantId: string, id: string) {
  const res = await ownerTenantSql(tenantId, 'select * from app.attachment where id = $1', [id]);
  return res.rows[0] as RawAttachment | undefined;
}

/** Create, PUT and complete: returns the confirmed attachment (still `pending` until the scan job runs). */
export async function uploadFile(
  h: FilesHarness,
  client: Client,
  tenantId: string,
  owner: { entity_type: string; entity_id: string },
  file: { filename: string; content_type: string; body: Buffer; kind?: string; sha256?: string },
): Promise<{ id: string; created: Created; key: string }> {
  const created = await createAttachment(client, {
    ...owner,
    kind: file.kind ?? 'document',
    filename: file.filename,
    content_type: file.content_type,
    size_bytes: file.body.length,
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
  });
  const put = await putBytes(h, created.upload, file.body);
  if (put.status !== 200) {
    throw new Error(`PUT failed: ${put.status} ${put.body.toString().slice(0, 300)}`);
  }
  const done = await client.post(`/v1/attachments/${created.attachment.id}/complete`);
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${done.raw}`);
  const row = await rowOf(tenantId, created.attachment.id);
  return { id: created.attachment.id, created, key: row!.storage_key as string };
}

const logger = pino({ level: 'silent' });

/** Runs one job handler the way the worker wraps it: inside the tenant transaction. */
export async function runJob(
  h: FilesHarness,
  queue: string,
  payload: { tenantId: string } & Record<string, unknown>,
): Promise<void> {
  const handler = h.app.get(JobHandlerRegistry).get(queue);
  if (!handler) throw new Error(`no handler registered for ${queue}`);
  const tenancy = h.app.get(TenancyService, { strict: false });
  const jobId = randomUUID();
  await tenancy.withTenantTx({ tenantId: payload.tenantId, actorId: jobId }, (tx) =>
    (handler.handle as (p: unknown, c: unknown) => Promise<void>)(payload, {
      jobId,
      queue,
      retryCount: 0,
      logger,
      tenantId: payload.tenantId,
      tx,
    }),
  );
}

/** Runs every queued file job (and the jobs those enqueue) until none is left. */
export async function drainJobs(h: FilesHarness, only?: readonly string[]): Promise<string[]> {
  const ran: string[] = [];
  for (let guard = 0; guard < 20 && h.jobs.jobs.length > 0; guard++) {
    const batch = h.jobs.jobs.splice(0, h.jobs.jobs.length);
    for (const job of batch) {
      if (!job.name.startsWith('attachment.') || (only && !only.includes(job.name))) continue;
      await runJob(h, job.name, job.payload as { tenantId: string });
      ran.push(job.name);
    }
  }
  return ran;
}

export { newObjectKey };
