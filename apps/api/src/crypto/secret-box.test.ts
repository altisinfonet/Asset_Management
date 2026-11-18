import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KmsKeyProvider, LocalKeyProvider, UnknownKeyIdError } from './key-provider.js';
import { EnvelopeSecretBox, SecretBoxError } from './secret-box.js';
import { createKeyProvider, decodeMasterKey, generateMasterKey, readSecret } from './secrets.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const TENANT_A = '0190aaaa-0000-7000-8000-00000000000a';
const TENANT_B = '0190bbbb-0000-7000-8000-00000000000b';

function box(keys: Record<string, Buffer>, current: string) {
  return new EnvelopeSecretBox(new LocalKeyProvider(keys, current));
}

describe('EnvelopeSecretBox (M1-PLAT-08)', () => {
  const master = randomBytes(32);

  it('round-trips arbitrary bytes, including empty and large payloads', async () => {
    const sb = box({ mk1: master }, 'mk1');
    for (const size of [0, 1, 31, 32, 1000, 200_000]) {
      const plain = randomBytes(size);
      const ct = await sb.encrypt(plain, `${TENANT_A}:totp`);
      if (size >= 16) expect(Buffer.from(ct).includes(plain)).toBe(false); // never stored in the clear
      expect(Buffer.from(await sb.decrypt(ct, `${TENANT_A}:totp`)).equals(plain)).toBe(true);
    }
    expect(dec(await sb.decrypt(await sb.encrypt(enc('JBSWY3DPEHPK3PXP'), 'c'), 'c'))).toBe(
      'JBSWY3DPEHPK3PXP',
    );
  });

  it('uses a fresh data key and IV per encryption (same input, different ciphertext)', async () => {
    const sb = box({ mk1: master }, 'mk1');
    const a = await sb.encrypt(enc('same'), 'ctx');
    const b = await sb.encrypt(enc('same'), 'ctx');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('fails when decrypted for another tenant or purpose (context binding)', async () => {
    const sb = box({ mk1: master }, 'mk1');
    const ct = await sb.encrypt(enc('secret'), `${TENANT_A}:totp`);
    await expect(sb.decrypt(ct, `${TENANT_B}:totp`)).rejects.toThrow(SecretBoxError);
    await expect(sb.decrypt(ct, `${TENANT_A}:webhook`)).rejects.toThrow(SecretBoxError);
    await expect(sb.decrypt(ct, '')).rejects.toThrow(SecretBoxError);
  });

  it('fails on a tampered ciphertext, anywhere in the envelope', async () => {
    const sb = box({ mk1: master }, 'mk1');
    const ct = Buffer.from(await sb.encrypt(enc('top secret'), 'ctx'));
    // header (key id), wrapped key, payload IV, payload body, GCM tag: flip one bit in each region.
    for (const offset of [5, 12, 40, ct.length - 20, ct.length - 1]) {
      const bad = Buffer.from(ct);
      bad[offset] = bad[offset]! ^ 0x01;
      await expect(sb.decrypt(bad, 'ctx'), `offset ${offset}`).rejects.toThrow();
    }
    await expect(sb.decrypt(ct.subarray(0, ct.length - 3), 'ctx')).rejects.toThrow();
    await expect(sb.decrypt(enc('not an envelope at all'), 'ctx')).rejects.toThrow(/malformed/);
    await expect(sb.decrypt(new Uint8Array(), 'ctx')).rejects.toThrow(/malformed/);
  });

  it('fails with a different master key', async () => {
    const ct = await box({ mk1: master }, 'mk1').encrypt(enc('x'), 'ctx');
    await expect(box({ mk1: randomBytes(32) }, 'mk1').decrypt(ct, 'ctx')).rejects.toThrow(
      SecretBoxError,
    );
  });

  it('records the master key id in the header and reports it without decrypting', async () => {
    const sb = box({ mk7: master }, 'mk7');
    const ct = await sb.encrypt(enc('x'), 'ctx');
    expect(sb.inspect(ct)).toEqual({ formatVersion: 1, keyId: 'mk7' });
    expect(sb.needsRewrap(ct)).toBe(false);
  });

  it('rotation: re-wraps the data key under the new master key without touching the payload', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const before = box({ mk1: oldKey }, 'mk1');
    const ct = await before.encrypt(enc('rotate me'), `${TENANT_A}:totp`);

    // After rotation: mk2 is current, mk1 is kept only for unwrapping.
    const after = box({ mk2: newKey, mk1: oldKey }, 'mk2');
    expect(after.needsRewrap(ct)).toBe(true);
    expect(dec(await after.decrypt(ct, `${TENANT_A}:totp`))).toBe('rotate me'); // still readable

    const rewrapped = await after.rewrap(ct, `${TENANT_A}:totp`);
    expect(after.inspect(rewrapped).keyId).toBe('mk2');
    expect(after.needsRewrap(rewrapped)).toBe(false);
    // The last 28+ bytes (IV | ciphertext | tag) are byte-identical: no payload re-encryption.
    const tail = (b: Uint8Array) => Buffer.from(b).subarray(-('rotate me'.length + 12 + 16));
    expect(tail(rewrapped).equals(tail(ct))).toBe(true);
    expect(dec(await after.decrypt(rewrapped, `${TENANT_A}:totp`))).toBe('rotate me');

    // Once the old key is retired, the re-wrapped value still opens; an un-rewrapped one does not.
    const retired = box({ mk2: newKey }, 'mk2');
    expect(dec(await retired.decrypt(rewrapped, `${TENANT_A}:totp`))).toBe('rotate me');
    await expect(retired.decrypt(ct, `${TENANT_A}:totp`)).rejects.toThrow(SecretBoxError);
    // And rewrap itself is context-bound.
    await expect(after.rewrap(ct, `${TENANT_B}:totp`)).rejects.toThrow(SecretBoxError);
  });

  it('a master key of the wrong size is rejected', () => {
    expect(() => new LocalKeyProvider({ mk1: randomBytes(16) }, 'mk1')).toThrow(/32 bytes/);
    expect(() => new LocalKeyProvider({ mk1: randomBytes(32) }, 'nope')).toThrow(/keyring/);
  });

  it('reports an unknown key id clearly', async () => {
    const p = new LocalKeyProvider({ mk1: master }, 'mk1');
    await expect(p.unwrap('gone', randomBytes(60), 'ctx')).rejects.toThrow(UnknownKeyIdError);
  });

  it('the Cloud KMS provider is a stub that fails fast (M6)', async () => {
    await expect(new KmsKeyProvider().wrap()).rejects.toThrow(/M6/);
  });
});

describe('secrets provider and key bootstrap', () => {
  it('reads NAME or NAME_FILE (file wins, trimmed)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    const file = join(dir, 'master_key');
    writeFileSync(file, 'from-file\n');
    expect(readSecret('X', { X: 'from-env' })).toBe('from-env');
    expect(readSecret('X', { X: 'from-env', X_FILE: file })).toBe('from-file');
    expect(readSecret('X', {})).toBeUndefined();
    expect(readSecret('X', { X: '' })).toBeUndefined();
  });

  it('decodes base64 and hex master keys, rejects other sizes', () => {
    const key = randomBytes(32);
    expect(decodeMasterKey(key.toString('base64'), 'k').equals(key)).toBe(true);
    expect(decodeMasterKey(key.toString('hex'), 'k').equals(key)).toBe(true);
    expect(() => decodeMasterKey('dG9vIHNob3J0', 'k')).toThrow(/32 bytes/);
    expect(decodeMasterKey(generateMasterKey(), 'k')).toHaveLength(32);
  });

  const base = {
    NODE_ENV: 'test' as const,
    MASTER_KEY_ID: 'mk1',
    MASTER_KEY: undefined,
    MASTER_KEY_FILE: undefined,
    MASTER_KEY_PREVIOUS: undefined,
    MASTER_KEY_PREVIOUS_FILE: undefined,
    MASTER_KEY_PREVIOUS_ID: undefined,
  };

  it('production refuses to start without a master key; dev falls back to an ephemeral one', () => {
    expect(() => createKeyProvider({ ...base, NODE_ENV: 'production' })).toThrow(/MASTER_KEY/);
    expect(createKeyProvider(base).ephemeral).toBe(true);
  });

  it('loads the current and the previous master key (rotation window) from files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    const cur = join(dir, 'cur');
    const prev = join(dir, 'prev');
    writeFileSync(cur, `${generateMasterKey()}\n`);
    writeFileSync(prev, generateMasterKey());
    const { provider, ephemeral } = createKeyProvider({
      ...base,
      MASTER_KEY_FILE: cur,
      MASTER_KEY_ID: 'mk2',
      MASTER_KEY_PREVIOUS_FILE: prev,
      MASTER_KEY_PREVIOUS_ID: 'mk1',
    });
    expect(ephemeral).toBe(false);
    expect(provider.currentKeyId).toBe('mk2');
    const w = await provider.wrap(randomBytes(32), 'c');
    expect(w.keyId).toBe('mk2');
    expect(() =>
      createKeyProvider({
        ...base,
        MASTER_KEY: generateMasterKey(),
        MASTER_KEY_PREVIOUS: generateMasterKey(),
      }),
    ).toThrow(/MASTER_KEY_PREVIOUS_ID/);
  });
});
