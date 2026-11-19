import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type PresignedDownload,
  type PresignedUpload,
  type StorageAdapter,
  type StorageObjectInfo,
  StorageNotFoundError,
} from '../ports/index.js';
import { truncateFilename } from './headers.js';
import { assertObjectKey } from './keys.js';
import { type FileToken, FileTokenSigner } from './tokens.js';

/** The upload does not have the size the token promised (the S3 equivalent is a signature mismatch). */
export class UploadSizeError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number | 'more',
  ) {
    super(`upload size mismatch: expected ${expected} bytes, got ${actual}`);
    this.name = 'UploadSizeError';
  }
}

/** The object already exists: an upload URL writes its object exactly once. */
export class UploadConflictError extends Error {
  constructor(readonly key: string) {
    super(`object already uploaded: ${key}`);
    this.name = 'UploadConflictError';
  }
}

/**
 * Local-filesystem StorageAdapter (M2-FILE-01): the self-hosted fallback. Objects are plain files
 * under `root`; "presigned" URLs are HMAC-signed tokens served by the API itself
 * (`PUT|GET <baseUrl>/v1/files/<token>`, `files/local-files.controller.ts`). A key is validated
 * before it is turned into a path, and the resolved path must stay inside `root`.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(
    root: string,
    private readonly baseUrl: string,
    private readonly signer: FileTokenSigner,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.root = resolve(root);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  /** The absolute path of a key. Public for tests; never exposed over HTTP. */
  pathOf(key: string): string {
    assertObjectKey(key);
    const path = resolve(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) throw new Error('storage key escapes the root');
    return path;
  }

  private url(token: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/v1/files/${token}`;
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    ttlSeconds: number;
  }): Promise<PresignedUpload> {
    const expiresAt = new Date(this.now().getTime() + input.ttlSeconds * 1000);
    const token = this.signer.sign({
      v: 1,
      op: 'put',
      k: input.key,
      ct: input.contentType,
      sz: input.sizeBytes,
      exp: Math.floor(expiresAt.getTime() / 1000),
    });
    return {
      method: 'PUT',
      url: this.url(token),
      headers: { 'content-type': input.contentType },
      expiresAt,
    };
  }

  async presignDownload(input: {
    key: string;
    filename: string;
    contentType: string;
    disposition: 'inline' | 'attachment';
    ttlSeconds: number;
  }): Promise<PresignedDownload> {
    const expiresAt = new Date(this.now().getTime() + input.ttlSeconds * 1000);
    const token = this.signer.sign({
      v: 1,
      op: 'get',
      k: input.key,
      ct: input.contentType,
      cd: input.disposition,
      fn: truncateFilename(input.filename, 120),
      exp: Math.floor(expiresAt.getTime() / 1000),
    });
    return { url: this.url(token), expiresAt };
  }

  /** Verifies a token from a request URL (the controller's entry point). */
  verifyToken(token: string): FileToken {
    return this.signer.verify(token, this.now());
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    const path = this.pathOf(key);
    try {
      const s = await stat(path);
      if (!s.isFile()) return null;
      return { sizeBytes: s.size, contentType: null, etag: etagOf(s.size, s.mtimeMs) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async read(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const path = this.pathOf(key);
    try {
      await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageNotFoundError(key);
      throw err;
    }
    return createReadStream(path, range ? { start: range.start, end: range.end } : {});
  }

  async write(
    key: string,
    body: Buffer,
    _opts: { contentType: string },
  ): Promise<{ etag: string | null }> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomUUID()}.part`;
    await writeFile(tmp, body);
    await rename(tmp, path);
    const s = await stat(path);
    return { etag: etagOf(s.size, s.mtimeMs) };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  /**
   * Receives the bytes of an upload token: EXACTLY `token.sz` bytes, written once. The body streams to
   * a temporary file (never buffered), is counted, and is linked into place only when complete.
   */
  async receive(
    token: FileToken,
    body: Readable,
  ): Promise<{ etag: string | null; sha256: string; sizeBytes: number }> {
    if (token.op !== 'put' || token.sz === undefined) throw new Error('not an upload token');
    const expected = token.sz;
    const path = this.pathOf(token.k);
    await mkdir(dirname(path), { recursive: true });
    const tmp = join(dirname(path), `${randomUUID()}.part`);
    const hash = createHash('sha256');
    let seen = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        if (seen > expected) return cb(new UploadSizeError(expected, 'more'));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(tmp, { flags: 'wx' }));
      if (seen !== expected) throw new UploadSizeError(expected, seen);
      try {
        await link(tmp, path); // fails with EEXIST: an object is written once
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST')
          throw new UploadConflictError(token.k);
        throw err;
      }
      const s = await stat(path);
      return { etag: etagOf(s.size, s.mtimeMs), sha256: hash.digest('hex'), sizeBytes: seen };
    } finally {
      await rm(tmp, { force: true });
    }
  }
}

const etagOf = (size: number, mtimeMs: number): string =>
  `"${size.toString(16)}-${Math.round(mtimeMs * 1000).toString(16)}"`;
