import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AppConfig } from '../config/env.js';
import { type KeyProvider, LocalKeyProvider } from './key-provider.js';

/**
 * `SecretsProvider.get` (M1-PLAT-08): a secret is `NAME` in the environment, or `NAME_FILE` pointing
 * at a file (Docker/Compose secrets are files under `/run/secrets`). The file form wins and is the
 * documented one for self-hosted installs: the value never appears in `docker inspect`, process
 * listings or the compose file. Trailing whitespace of the file is trimmed.
 *
 * Values are returned to the caller and never logged; the logger's redaction list covers the usual
 * field names, and nothing here logs a value (only the NAME of a missing secret).
 */
export function readSecret(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) return readFileSync(file, 'utf8').trim();
  const value = env[name];
  return value === undefined || value === '' ? undefined : value.trim();
}

/** Decodes a 32-byte key given as base64/base64url or 64 hex characters. */
export function decodeMasterKey(text: string, label: string): Buffer {
  const trimmed = text.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new Error(`${label} must be 32 bytes (base64 or 64 hex characters), got ${key.length}`);
  }
  return key;
}

/** `openssl rand -base64 32`, for docs and for tests. */
export const generateMasterKey = (): string => randomBytes(32).toString('base64');

export interface KeyProviderBootstrap {
  provider: KeyProvider;
  /** True when no master key was configured and a throwaway one was generated (never in production). */
  ephemeral: boolean;
}

/**
 * Builds the self-hosted/dev KeyProvider from the configuration:
 *   MASTER_KEY | MASTER_KEY_FILE            the current master key (id MASTER_KEY_ID, default `mk1`)
 *   MASTER_KEY_PREVIOUS | ..._FILE          the key it replaced, kept so old data keys still unwrap
 *   MASTER_KEY_PREVIOUS_ID                  that key's id
 * Production refuses to start without a master key. Elsewhere a missing key yields an EPHEMERAL one
 * (random per process): fine for tests and `pnpm dev`, but values encrypted by one process cannot be
 * read by another, which is why the compose files always provide the secret file.
 */
export function createKeyProvider(
  config: Pick<
    AppConfig,
    | 'NODE_ENV'
    | 'MASTER_KEY'
    | 'MASTER_KEY_FILE'
    | 'MASTER_KEY_ID'
    | 'MASTER_KEY_PREVIOUS'
    | 'MASTER_KEY_PREVIOUS_FILE'
    | 'MASTER_KEY_PREVIOUS_ID'
  >,
): KeyProviderBootstrap {
  const env = {
    MASTER_KEY: config.MASTER_KEY,
    MASTER_KEY_FILE: config.MASTER_KEY_FILE,
    MASTER_KEY_PREVIOUS: config.MASTER_KEY_PREVIOUS,
    MASTER_KEY_PREVIOUS_FILE: config.MASTER_KEY_PREVIOUS_FILE,
  };
  const current = readSecret('MASTER_KEY', env);
  const previous = readSecret('MASTER_KEY_PREVIOUS', env);

  if (!current) {
    if (config.NODE_ENV === 'production') {
      throw new Error(
        'MASTER_KEY or MASTER_KEY_FILE is required in production (32 random bytes, base64; mount it as a Docker secret)',
      );
    }
    const id = config.MASTER_KEY_ID;
    return { provider: new LocalKeyProvider({ [id]: randomBytes(32) }, id), ephemeral: true };
  }

  const keys: Record<string, Uint8Array> = {
    [config.MASTER_KEY_ID]: decodeMasterKey(current, 'MASTER_KEY'),
  };
  if (previous) {
    const previousId = config.MASTER_KEY_PREVIOUS_ID;
    if (!previousId || previousId === config.MASTER_KEY_ID) {
      throw new Error(
        'MASTER_KEY_PREVIOUS needs MASTER_KEY_PREVIOUS_ID, different from MASTER_KEY_ID',
      );
    }
    keys[previousId] = decodeMasterKey(previous, 'MASTER_KEY_PREVIOUS');
  }
  return { provider: new LocalKeyProvider(keys, config.MASTER_KEY_ID), ephemeral: false };
}
