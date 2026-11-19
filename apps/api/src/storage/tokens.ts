import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { assertObjectKey } from './keys.js';

/**
 * Signed, expiring tokens for the LOCAL storage driver's "presigned" URLs
 * (`PUT|GET /v1/files/<token>`), the equivalent of an S3 presigned URL for a store that has none.
 *
 *   token = base64url(JSON payload) "." base64url(HMAC-SHA256(key, base64url(JSON payload)))
 *
 * The payload carries the operation, the object key, and what the response must look like (content
 * type, disposition, filename) or what the upload must be (content type, exact size). The HMAC key
 * is derived (HKDF) from the master key, so every api replica and the worker validate each other's
 * tokens; without a master key (dev/test only) a per-process random key is used.
 */
export interface FileToken {
  v: 1;
  /** `put` = upload, `get` = download. */
  op: 'put' | 'get';
  /** Object key (validated on creation and again on verification). */
  k: string;
  /** Content type: required on the PUT, forced on the GET response. */
  ct: string;
  /** put: the exact size in bytes. */
  sz?: number;
  /** get: `inline` or `attachment`. */
  cd?: 'inline' | 'attachment';
  /** get: the filename for Content-Disposition. */
  fn?: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

export type TokenFailure = 'malformed' | 'signature' | 'expired';

export class FileTokenError extends Error {
  constructor(readonly reason: TokenFailure) {
    super(`file token rejected: ${reason}`);
    this.name = 'FileTokenError';
  }
}

export class FileTokenSigner {
  private readonly key: Buffer;

  /** @param secret 32-byte master key, or `undefined` for a throwaway random key. */
  constructor(secret?: Uint8Array) {
    this.key = secret
      ? Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'assettracker.files.token.v1', 32))
      : randomBytes(32);
  }

  sign(payload: FileToken): string {
    assertObjectKey(payload.k);
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  /** Verifies signature, shape and expiry. Throws {@link FileTokenError}; never returns a forged token. */
  verify(token: string, now: Date = new Date()): FileToken {
    if (typeof token !== 'string' || token.length > 4096) throw new FileTokenError('malformed');
    const dot = token.indexOf('.');
    if (dot < 1 || dot !== token.lastIndexOf('.')) throw new FileTokenError('malformed');
    const body = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1), 'base64url');
    const expected = Buffer.from(this.mac(body), 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new FileTokenError('signature');
    }
    let payload: FileToken;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FileToken;
    } catch {
      throw new FileTokenError('malformed');
    }
    if (
      payload?.v !== 1 ||
      (payload.op !== 'put' && payload.op !== 'get') ||
      typeof payload.k !== 'string' ||
      typeof payload.ct !== 'string' ||
      !Number.isFinite(payload.exp)
    ) {
      throw new FileTokenError('malformed');
    }
    assertObjectKey(payload.k);
    if (payload.exp * 1000 <= now.getTime()) throw new FileTokenError('expired');
    return payload;
  }

  private mac(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
