import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretBox } from '../ports/index.js';
import type { KeyProvider } from './key-provider.js';

/**
 * Envelope encryption (M1-PLAT-08): every `encrypt` mints a fresh 256-bit DATA KEY, encrypts the
 * payload with AES-256-GCM under it, and stores the data key WRAPPED by the {@link KeyProvider}
 * next to the ciphertext. Master keys therefore only ever touch 32-byte data keys, rotation
 * re-wraps those without re-encrypting payloads ({@link EnvelopeSecretBox.rewrap}), and a KMS
 * provider can replace the local one without a data migration.
 *
 * Ciphertext layout (all integers big-endian):
 *
 *   'S' 'B'            magic
 *   u8                 format version (1)
 *   u8                 key id length n (1..255)
 *   n bytes            key id of the master key that wrapped the data key (ASCII)
 *   u16                wrapped data key length m
 *   m bytes            wrapped data key (provider specific)
 *   12 bytes           payload IV
 *   ... bytes          payload ciphertext
 *   16 bytes           payload GCM tag
 *
 * CONTEXT BINDING: `context` (tenant id + purpose, e.g. `<tenant>:totp`) is authenticated as the
 * payload's AAD AND bound into the key wrap. Decrypting with another context fails with an
 * authentication error, so a ciphertext copied to another tenant or purpose is useless. The header
 * is not part of the payload AAD (that is what makes re-wrapping possible) but is covered anyway:
 * a modified key id or wrapped key fails to unwrap, a modified payload fails the tag.
 */
export const SECRETBOX_FORMAT_VERSION = 1;

const MAGIC = Buffer.from('SB', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const PAYLOAD_AAD = 'assettracker.secretbox.v1';

export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SecretBoxError';
  }
}

interface Parsed {
  keyId: string;
  wrapped: Buffer;
  /** iv | ciphertext | tag */
  payload: Buffer;
}

export class EnvelopeSecretBox implements SecretBox {
  constructor(private readonly keys: KeyProvider) {}

  async encrypt(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    assertContext(context);
    const dataKey = randomBytes(DATA_KEY_BYTES);
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
      cipher.setAAD(payloadAad(context));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const { keyId, wrapped } = await this.keys.wrap(dataKey, context);
      return serialise(keyId, Buffer.from(wrapped), Buffer.concat([iv, body, cipher.getAuthTag()]));
    } finally {
      dataKey.fill(0);
    }
  }

  async decrypt(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    assertContext(context);
    const parsed = parse(ciphertext);
    let dataKey: Uint8Array;
    try {
      dataKey = await this.keys.unwrap(parsed.keyId, parsed.wrapped, context);
    } catch (cause) {
      throw new SecretBoxError('cannot unwrap the data key (wrong context, key or tampered data)', {
        cause,
      });
    }
    try {
      const { payload } = parsed;
      const decipher = createDecipheriv('aes-256-gcm', dataKey, payload.subarray(0, IV_BYTES));
      decipher.setAAD(payloadAad(context));
      decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
      return new Uint8Array(
        Buffer.concat([
          decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)),
          decipher.final(),
        ]),
      );
    } catch (cause) {
      throw new SecretBoxError('authentication failed (wrong context or tampered data)', { cause });
    } finally {
      Buffer.from(dataKey.buffer, dataKey.byteOffset, dataKey.byteLength).fill(0);
    }
  }

  /**
   * Key rotation: unwraps the data key with whichever master key wrapped it and wraps it again with
   * the CURRENT one. The payload bytes are untouched (no plaintext is ever produced), so this is
   * cheap and safe to run over a column in batches.
   */
  async rewrap(ciphertext: Uint8Array, context: string): Promise<Uint8Array> {
    assertContext(context);
    const parsed = parse(ciphertext);
    const dataKey = await this.keys.unwrap(parsed.keyId, parsed.wrapped, context).catch((cause) => {
      throw new SecretBoxError('cannot unwrap the data key (wrong context, key or tampered data)', {
        cause,
      });
    });
    try {
      const { keyId, wrapped } = await this.keys.wrap(dataKey, context);
      return serialise(keyId, Buffer.from(wrapped), parsed.payload);
    } finally {
      Buffer.from(dataKey.buffer, dataKey.byteOffset, dataKey.byteLength).fill(0);
    }
  }

  /** Header fields without decrypting: which master key wrapped this value, format version. */
  inspect(ciphertext: Uint8Array): { formatVersion: number; keyId: string } {
    return { formatVersion: SECRETBOX_FORMAT_VERSION, keyId: parse(ciphertext).keyId };
  }

  /** True when the value is wrapped by a master key other than the current one (rotation due). */
  needsRewrap(ciphertext: Uint8Array): boolean {
    return parse(ciphertext).keyId !== this.keys.currentKeyId;
  }
}

function assertContext(context: string): void {
  if (typeof context !== 'string' || context.length === 0 || context.length > 512) {
    throw new SecretBoxError('encryption context must be a non-empty string (tenant id + purpose)');
  }
}

const payloadAad = (context: string): Buffer => Buffer.from(`${PAYLOAD_AAD}|${context}`, 'utf8');

function serialise(keyId: string, wrapped: Buffer, payload: Buffer): Uint8Array {
  const id = Buffer.from(keyId, 'ascii');
  if (id.length === 0 || id.length > 255) throw new SecretBoxError('invalid key id length');
  if (wrapped.length > 0xffff) throw new SecretBoxError('wrapped key too large');
  const wrappedLen = Buffer.alloc(2);
  wrappedLen.writeUInt16BE(wrapped.length);
  return new Uint8Array(
    Buffer.concat([
      MAGIC,
      Buffer.from([SECRETBOX_FORMAT_VERSION, id.length]),
      id,
      wrappedLen,
      wrapped,
      payload,
    ]),
  );
}

function parse(input: Uint8Array): Parsed {
  const buf = Buffer.from(input);
  const fail = (why: string): never => {
    throw new SecretBoxError(`malformed ciphertext: ${why}`);
  };
  if (buf.length < 4 || !buf.subarray(0, 2).equals(MAGIC)) return fail('bad magic');
  if (buf[2] !== SECRETBOX_FORMAT_VERSION) return fail(`unsupported format version ${buf[2]}`);
  const idLen = buf[3]!;
  let offset = 4;
  if (idLen === 0 || buf.length < offset + idLen + 2) return fail('truncated header');
  const keyId = buf.subarray(offset, offset + idLen).toString('ascii');
  offset += idLen;
  const wrappedLen = buf.readUInt16BE(offset);
  offset += 2;
  if (buf.length < offset + wrappedLen + IV_BYTES + TAG_BYTES) return fail('truncated body');
  const wrapped = buf.subarray(offset, offset + wrappedLen);
  offset += wrappedLen;
  return { keyId, wrapped, payload: buf.subarray(offset) };
}
