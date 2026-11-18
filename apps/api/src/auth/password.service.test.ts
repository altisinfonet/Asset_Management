import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import { BREACHED_PASSWORD_LIST } from './data/breached-passwords.js';
import { PasswordService } from './password.service.js';

const config = (extra: Record<string, string> = {}) =>
  loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/d', ...extra });
const fast = { ARGON2_MEMORY_KIB: '64', ARGON2_TIME_COST: '1' };

describe('password policy', () => {
  const svc = new PasswordService(config(fast));

  it('is documented: 12-128 characters, no composition rules, breached check', () => {
    expect(svc.policy()).toEqual({
      min_length: 12,
      max_length: 128,
      composition_rules: false,
      breached_check: { enabled: true, sources: ['local_list'] },
      rejection_codes: ['too-short', 'too-long', 'breached'],
    });
  });

  it('counts Unicode code points after NFKC, not UTF-16 units', async () => {
    expect(await svc.validate('a'.repeat(11))).toBe('too-short');
    expect(await svc.validate('Zq9#kLm2!xPv')).toBeNull(); // exactly 12
    expect(await svc.validate('😀'.repeat(12))).toBeNull(); // 12 code points, 24 UTF-16 units
    expect(await svc.validate('😀'.repeat(11))).toBe('too-short');
    expect(await svc.validate('x9'.repeat(64))).toBeNull(); // exactly 128
    expect(await svc.validate('x9'.repeat(64) + 'y')).toBe('too-long');
    // NFKC: full-width characters fold to ASCII (12 wide chars = 12 chars either way, but they are compared folded).
    expect(await svc.validate('ｐａｓｓｗｏｒｄ１２３４')).toBe('breached');
  });

  it('has no composition rules: a long all-lowercase passphrase is fine', async () => {
    expect(await svc.validate('mildly unusual sentence about harbours')).toBeNull();
  });

  it('rejects entries of the bundled list, case-insensitively', async () => {
    const entries = BREACHED_PASSWORD_LIST.split('\n');
    expect(entries.length).toBe(10_000);
    expect(entries.every((e) => [...e].length >= 12)).toBe(true);
    for (const entry of [entries[0]!, entries[5000]!, entries.at(-1)!]) {
      expect(await svc.validate(entry), entry).toBe('breached');
      expect(await svc.validate(entry.toUpperCase()), entry).toBe('breached');
    }
    expect(await svc.validate('1q2w3e4r5t6y')).toBe('breached');
  });

  it('hashes with argon2id and verifies; a wrong password or a garbage hash never verifies', async () => {
    const hash = await svc.hash('correct passphrase 42');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=64,t=1,p=1\$/);
    expect(await svc.verify(hash, 'correct passphrase 42')).toBe(true);
    expect(await svc.verify(hash, 'correct passphrase 43')).toBe(false);
    expect(await svc.verify('not-a-hash', 'x')).toBe(false);
    expect(await svc.verifyDummy('anything')).toBe(false);
    // NFKC normalisation: the composed and decomposed forms are the same password.
    const h2 = await svc.hash('café café café');
    expect(await svc.verify(h2, 'café café café')).toBe(true);
  });

  it('uses the documented production parameters by default (m=19456 KiB, t=2, p=1)', async () => {
    const defaults = new PasswordService(config());
    expect(await defaults.hash('production parameters check')).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });
});

describe('online k-anonymity provider (optional)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is off by default and listed in the policy only when enabled', () => {
    expect(new PasswordService(config(fast)).policy().breached_check.sources).toEqual([
      'local_list',
    ]);
    expect(
      new PasswordService(config({ ...fast, BREACHED_PASSWORD_ONLINE: 'true' })).policy()
        .breached_check.sources,
    ).toEqual(['local_list', 'online_k_anonymity']);
  });

  it('sends only the 5-character SHA-1 prefix and matches the suffix; fails open on errors', async () => {
    const svc = new PasswordService(config({ ...fast, BREACHED_PASSWORD_ONLINE: 'true' }));
    // sha1("unlisted but pwned phrase") computed below to build the fake range response.
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha1').update('unlisted but pwned phrase').digest('hex').toUpperCase();
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(`0000000000000000000000000000000000A:2\r\n${sha.slice(5)}:41\r\n`, {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await svc.validate('unlisted but pwned phrase')).toBe('breached');
    const called = String(fetchMock.mock.calls[0]![0]);
    expect(called.endsWith(`/${sha.slice(0, 5)}`)).toBe(true);
    expect(called).not.toContain(sha.slice(5));
    expect(await svc.validate('another long clean phrase')).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await svc.validate('unlisted but pwned phrase')).toBeNull(); // fail open
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect(await svc.validate('unlisted but pwned phrase')).toBeNull();
  });
});
