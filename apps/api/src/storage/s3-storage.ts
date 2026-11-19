import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import {
  type PresignedDownload,
  type PresignedUpload,
  type StorageAdapter,
  type StorageObjectInfo,
  StorageNotFoundError,
} from '../ports/index.js';
import { contentDisposition } from './headers.js';
import { assertObjectKey } from './keys.js';

export interface S3StorageOptions {
  /** Internal endpoint (the api and worker talk to the store here). Omit for AWS S3. */
  endpoint?: string;
  /** The host browsers use; presigned URLs are built for it. Defaults to `endpoint`. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  /** Static credentials; omit to use the default AWS provider chain (task role in Cloud). */
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  /** Create the bucket on `ensureReady` when it is missing (dev / bundled MinIO only). */
  createBucket: boolean;
}

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

/**
 * S3-compatible StorageAdapter (M2-FILE-01): MinIO in dev and self-hosted, AWS S3 in Cloud, any other
 * S3 API. Two clients: one for the internal endpoint (reads, writes, deletes) and one built for the
 * PUBLIC endpoint that only SIGNS (signing is a local computation, it never connects), because the
 * host is part of a SigV4 signature and the browser reaches the store under a different name than
 * the containers do.
 *
 * Upload URLs sign `content-type` and `content-length`: a PUT with another type or size is rejected
 * by the store itself. This is defence in depth only; the size is verified again (HEAD) when the
 * client confirms the upload and while the object is scanned.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    const credentials =
      options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined;
    const common = {
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      ...(credentials ? { credentials } : {}),
      // Flexible checksums are on by default in recent SDKs and would add x-amz-checksum-* headers the
      // browser knows nothing about; only compute them where the API requires them.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.client = new S3Client({
      ...common,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    });
    const publicEndpoint = options.publicEndpoint ?? options.endpoint;
    this.signer =
      publicEndpoint && publicEndpoint !== options.endpoint
        ? new S3Client({ ...common, endpoint: publicEndpoint })
        : this.client;
  }

  async ensureReady(): Promise<void> {
    const Bucket = this.options.bucket;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket }));
    } catch (err) {
      if (!isNotFound(err)) throw err;
      if (!this.options.createBucket) {
        throw new Error(
          `storage bucket "${Bucket}" does not exist (create it, or set S3_CREATE_BUCKET=true in development)`,
        );
      }
      await this.client.send(new CreateBucketCommand({ Bucket }));
    }
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds: number;
  }): Promise<PresignedUpload> {
    assertObjectKey(input.key);
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      {
        expiresIn: input.ttlSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      method: 'PUT',
      url,
      headers: { 'content-type': input.contentType },
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }

  async presignDownload(input: {
    key: string;
    filename: string;
    contentType: string;
    disposition: 'inline' | 'attachment';
    ttlSeconds: number;
  }): Promise<PresignedDownload> {
    assertObjectKey(input.key);
    const url = await getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ResponseContentType: input.contentType,
        ResponseContentDisposition: contentDisposition(input.filename, input.disposition),
        ResponseCacheControl: 'private, no-store',
      }),
      { expiresIn: input.ttlSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + input.ttlSeconds * 1000) };
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    assertObjectKey(key);
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      return {
        sizeBytes: Number(res.ContentLength ?? 0),
        contentType: res.ContentType ?? null,
        etag: res.ETag ?? null,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    assertObjectKey(key);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }),
      );
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async write(
    key: string,
    body: Buffer,
    opts: { contentType: string },
  ): Promise<{ etag: string | null }> {
    assertObjectKey(key);
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: body.length,
      }),
    );
    return { etag: res.ETag ?? null };
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  /** Releases the sockets (tests, shutdown). */
  close(): void {
    this.client.destroy();
    if (this.signer !== this.client) this.signer.destroy();
  }
}
