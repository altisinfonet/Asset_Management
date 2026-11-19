// Public facade of the storage module (M2-FILE-01): StorageAdapter implementations behind the
// STORAGE_ADAPTER port. Adapters are chosen once at boot; domain code never imports an SDK.
import type { AppConfig } from '../config/env.js';
import { decodeMasterKey, readSecret } from '../crypto/index.js';
import type { StorageAdapter } from '../ports/index.js';
import { LocalStorageAdapter } from './local-storage.js';
import { S3StorageAdapter } from './s3-storage.js';
import { FileTokenSigner } from './tokens.js';

export {
  FILE_RESPONSE_HEADERS,
  contentDisposition,
  sanitizeFilename,
  truncateFilename,
} from './headers.js';
export {
  InvalidStorageKeyError,
  assertObjectKey,
  isObjectKey,
  keyBelongsToTenant,
  newObjectKey,
  parseObjectKey,
  variantKey,
  type ParsedObjectKey,
} from './keys.js';
export { LocalStorageAdapter, UploadConflictError, UploadSizeError } from './local-storage.js';
export { S3StorageAdapter, type S3StorageOptions } from './s3-storage.js';
export { FileTokenError, FileTokenSigner, type FileToken } from './tokens.js';

export type StorageDriverName = 's3' | 'local';

export function resolveStorageDriver(
  config: Pick<AppConfig, 'STORAGE_DRIVER' | 'S3_ENDPOINT'>,
): StorageDriverName {
  return config.STORAGE_DRIVER ?? (config.S3_ENDPOINT ? 's3' : 'local');
}

/** Builds the configured adapter (does not connect; call `ensureReady()` at startup). */
export function createStorageAdapter(
  config: Pick<
    AppConfig,
    | 'STORAGE_DRIVER'
    | 'S3_ENDPOINT'
    | 'S3_PUBLIC_ENDPOINT'
    | 'S3_REGION'
    | 'S3_BUCKET'
    | 'S3_ACCESS_KEY_ID'
    | 'S3_SECRET_ACCESS_KEY'
    | 'S3_SECRET_ACCESS_KEY_FILE'
    | 'S3_FORCE_PATH_STYLE'
    | 'S3_CREATE_BUCKET'
    | 'FILES_LOCAL_DIR'
    | 'FILES_BASE_URL'
    | 'PORT'
    | 'MASTER_KEY'
    | 'MASTER_KEY_FILE'
  >,
): StorageAdapter {
  if (resolveStorageDriver(config) === 's3') {
    const secret = readSecret('S3_SECRET_ACCESS_KEY', {
      S3_SECRET_ACCESS_KEY: config.S3_SECRET_ACCESS_KEY,
      S3_SECRET_ACCESS_KEY_FILE: config.S3_SECRET_ACCESS_KEY_FILE,
    });
    return new S3StorageAdapter({
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      ...(config.S3_PUBLIC_ENDPOINT ? { publicEndpoint: config.S3_PUBLIC_ENDPOINT } : {}),
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      ...(config.S3_ACCESS_KEY_ID ? { accessKeyId: config.S3_ACCESS_KEY_ID } : {}),
      ...(secret ? { secretAccessKey: secret } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      createBucket: config.S3_CREATE_BUCKET,
    });
  }
  const master = readSecret('MASTER_KEY', {
    MASTER_KEY: config.MASTER_KEY,
    MASTER_KEY_FILE: config.MASTER_KEY_FILE,
  });
  const signer = new FileTokenSigner(master ? decodeMasterKey(master, 'MASTER_KEY') : undefined);
  return new LocalStorageAdapter(
    config.FILES_LOCAL_DIR,
    config.FILES_BASE_URL ?? `http://localhost:${config.PORT}`,
    signer,
  );
}
