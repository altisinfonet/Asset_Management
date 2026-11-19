import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageNotFoundError } from '../ports/index.js';
import { InvalidStorageKeyError, newObjectKey } from './keys.js';
import { LocalStorageAdapter, UploadConflictError, UploadSizeError } from './local-storage.js';
import { FileTokenSigner } from './tokens.js';

const bytes = async (r: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of r as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};

describe('LocalStorageAdapter (self-hosted fallback)', () => {
  let dir: string;
  let storage: LocalStorageAdapter;
  const tenant = randomUUID();
  let now = new Date();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'at-local-'));
    storage = new LocalStorageAdapter(
      dir,
      'https://files.example/',
      new FileTokenSigner(randomBytes(32)),
      () => now,
    );
    await storage.ensureReady();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write / head / read / range / delete', async () => {
    const key = newObjectKey(tenant);
    expect(await storage.head(key)).toBeNull();
    await expect(storage.read(key)).rejects.toBeInstanceOf(StorageNotFoundError);
    const { etag } = await storage.write(key, Buffer.from('hello world'), {
      contentType: 'text/csv',
    });
    const info = await storage.head(key);
    expect(info).toMatchObject({ sizeBytes: 11, etag });
    expect((await bytes(await storage.read(key))).toString()).toBe('hello world');
    expect((await bytes(await storage.read(key, { start: 0, end: 4 }))).toString()).toBe('hello');
    // overwriting changes the etag (the download path compares it)
    await new Promise((r) => setTimeout(r, 5));
    const second = await storage.write(key, Buffer.from('hello there!'), {
      contentType: 'text/csv',
    });
    expect(second.etag).not.toBe(etag);
    await storage.delete(key);
    await storage.delete(key); // idempotent
    expect(await storage.head(key)).toBeNull();
  });

  it('every operation refuses a key that is not tenants/<t>/<yyyy>/<uuid>, and no path escapes the root', async () => {
    for (const key of [
      '../x',
      '/etc/passwd',
      `tenants/${tenant}/2026/../../x`,
      '',
      'tenants/x/y/z',
    ]) {
      await expect(storage.head(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.read(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(
        storage.write(key, Buffer.from('x'), { contentType: 'text/csv' }),
      ).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await expect(storage.delete(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
      expect(() => storage.pathOf(key)).toThrow(InvalidStorageKeyError);
    }
    expect(storage.pathOf(newObjectKey(tenant)).startsWith(dir)).toBe(true);
  });

  it('presigned URLs are signed tokens on the configured base URL and expire', async () => {
    const key = newObjectKey(tenant);
    const up = await storage.presignUpload({
      key,
      contentType: 'image/png',
      sizeBytes: 3,
      ttlSeconds: 60,
    });
    expect(up.method).toBe('PUT');
    expect(up.url.startsWith('https://files.example/v1/files/')).toBe(true);
    expect(up.headers).toEqual({ 'content-type': 'image/png' });
    const token = up.url.split('/v1/files/')[1]!;
    expect(storage.verifyToken(token)).toMatchObject({ op: 'put', k: key, ct: 'image/png', sz: 3 });
    now = new Date(now.getTime() + 61_000);
    expect(() => storage.verifyToken(token)).toThrow(/expired/);
    now = new Date();

    const down = await storage.presignDownload({
      key,
      filename: 'a.png',
      contentType: 'image/png',
      disposition: 'inline',
      ttlSeconds: 30,
    });
    expect(storage.verifyToken(down.url.split('/v1/files/')[1]!)).toMatchObject({
      op: 'get',
      cd: 'inline',
      fn: 'a.png',
    });
  });

  it('receive stores exactly the promised bytes, once', async () => {
    const key = newObjectKey(tenant);
    const body = randomBytes(1000);
    const token = storage.verifyToken(
      (
        await storage.presignUpload({
          key,
          contentType: 'image/png',
          sizeBytes: 1000,
          ttlSeconds: 60,
        })
      ).url.split('/v1/files/')[1]!,
    );
    const stored = await storage.receive(
      token,
      Readable.from([body.subarray(0, 400), body.subarray(400)]),
    );
    expect(stored.sizeBytes).toBe(1000);
    expect((await readFile(storage.pathOf(key))).equals(body)).toBe(true);
    await expect(storage.receive(token, Readable.from([body]))).rejects.toBeInstanceOf(
      UploadConflictError,
    );
  });

  it('receive refuses too few and too many bytes and leaves nothing behind', async () => {
    const key = newObjectKey(tenant);
    const token = storage.verifyToken(
      (
        await storage.presignUpload({
          key,
          contentType: 'image/png',
          sizeBytes: 100,
          ttlSeconds: 60,
        })
      ).url.split('/v1/files/')[1]!,
    );
    await expect(storage.receive(token, Readable.from([randomBytes(99)]))).rejects.toBeInstanceOf(
      UploadSizeError,
    );
    await expect(storage.receive(token, Readable.from([randomBytes(101)]))).rejects.toMatchObject({
      actual: 'more',
    });
    expect(await storage.head(key)).toBeNull();
    // no temporary file survives either
    const leftovers = (
      await readdir(join(dir, 'tenants', tenant, String(new Date().getUTCFullYear())))
    ).filter((f) => f.endsWith('.part'));
    expect(leftovers).toEqual([]);
  });
});
