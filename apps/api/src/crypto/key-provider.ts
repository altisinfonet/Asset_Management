import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Key management for envelope encryption (M1-PLAT-08). A KeyProvider wraps and unwraps the small
 * per-secret DATA KEYS; it never sees plaintext payloads. Implementations:
 *
 *   - {@link LocalKeyProvider}: a master key from a file or env var (Docker secret). The
 *     self-hosted default and the dev/test provider.
 *   - {@link KmsKeyProvider}: the Cloud KMS provider (AWS KMS, M6). Stubbed behind the same
 *     interface so nothing above this file changes when it lands.
 *
 * `context` is the encryption context (tenant id + purpose). Providers MUST bind it into the wrap
 * (AAD for the local provider, `EncryptionContext` for KMS): a wrapped data key copied to another
 * tenant or purpose then fails to unwrap even before the payload is touched.
 */
export interface WrappedKey {
  /** Identifies the master key that wrapped it; stored in the ciphertext header for rotation. */
  keyId: string;
  wrapped: Uint8Array;
}

export interface KeyProvider {
  /** Master key id used for NEW wraps. */
  readonly currentKeyId: string;
  wrap(dataKey: Uint8Array, context: string): Promise<WrappedKey>;
  unwrap(keyId: string, wrapped: Uint8Array, context: string): Promise<Uint8Array>;
}

export class UnknownKeyIdError extends Error {
  constructor(readonly keyId: string) {
    super(`no master key with id "${keyId}" is configured (was the key rotated out too early?)`);
    this.name = 'UnknownKeyIdError';
  }
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const WRAP_AAD = 'assettracker.keywrap.v1';

/** AES-256-GCM key wrap with a keyring of master keys held in memory. */
export class LocalKeyProvider implements KeyProvider {
  private readonly keyring: Map<string, Buffer>;

  /**
   * @param keys     master keys by id (each exactly 32 bytes)
   * @param currentKeyId the key used for new wraps; must be in `keys`
   */
  constructor(
    keys: Record<string, Uint8Array>,
    readonly currentKeyId: string,
  ) {
    this.keyring = new Map();
    for (const [id, key] of Object.entries(keys)) {
      if (key.byteLength !== KEY_BYTES) {
        throw new Error(`master key "${id}" must be ${KEY_BYTES} bytes (got ${key.byteLength})`);
      }
      this.keyring.set(id, Buffer.from(key));
    }
    if (!this.keyring.has(currentKeyId)) {
      throw new Error(`current master key id "${currentKeyId}" is not in the keyring`);
    }
  }

  async wrap(dataKey: Uint8Array, context: string): Promise<WrappedKey> {
    const keyId = this.currentKeyId;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.keyring.get(keyId)!, iv);
    cipher.setAAD(wrapAad(keyId, context));
    const body = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return { keyId, wrapped: Buffer.concat([iv, body, cipher.getAuthTag()]) };
  }

  async unwrap(keyId: string, wrapped: Uint8Array, context: string): Promise<Uint8Array> {
    const master = this.keyring.get(keyId);
    if (!master) throw new UnknownKeyIdError(keyId);
    if (wrapped.byteLength < IV_BYTES + TAG_BYTES + 1) throw new Error('wrapped key is truncated');
    const buf = Buffer.from(wrapped);
    const decipher = createDecipheriv('aes-256-gcm', master, buf.subarray(0, IV_BYTES));
    decipher.setAAD(wrapAad(keyId, context));
    decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(buf.subarray(IV_BYTES, buf.length - TAG_BYTES)),
      decipher.final(),
    ]);
  }
}

const wrapAad = (keyId: string, context: string): Buffer =>
  Buffer.from(`${WRAP_AAD}|${keyId}|${context}`, 'utf8');

/**
 * Cloud KMS provider placeholder (M6-INF-05). It exists so the wiring and configuration surface is
 * final in M1: selecting it fails fast with a clear message instead of silently using a local key.
 */
export class KmsKeyProvider implements KeyProvider {
  readonly currentKeyId = 'kms';
  async wrap(): Promise<WrappedKey> {
    throw new Error('KmsKeyProvider is not implemented yet (M6-INF-05); use the local provider');
  }
  async unwrap(): Promise<Uint8Array> {
    throw new Error('KmsKeyProvider is not implemented yet (M6-INF-05); use the local provider');
  }
}
