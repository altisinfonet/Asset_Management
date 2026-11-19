import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newObjectKey } from './keys.js';
import { type FileToken, FileTokenError, FileTokenSigner } from './tokens.js';

const key = newObjectKey(randomUUID());
const base = (over: Partial<FileToken> = {}): FileToken => ({
  v: 1,
  op: 'put',
  k: key,
  ct: 'image/png',
  sz: 10,
  exp: Math.floor(Date.now() / 1000) + 60,
  ...over,
});

describe('file tokens (local storage presigned URLs)', () => {
  const signer = new FileTokenSigner(randomBytes(32));

  it('round-trips a valid token', () => {
    const token = signer.sign(base());
    expect(signer.verify(token)).toEqual(base({ exp: signer.verify(token).exp }));
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects a tampered payload, a swapped signature, another key and garbage', () => {
    const token = signer.sign(base());
    const [body, sig] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(
      JSON.stringify({ ...base(), k: newObjectKey(randomUUID()) }),
    ).toString('base64url');
    const reason = (t: string) => {
      try {
        signer.verify(t);
        return 'accepted';
      } catch (err) {
        return err instanceof FileTokenError ? err.reason : 'other';
      }
    };
    expect(reason(`${forgedBody}.${sig}`)).toBe('signature');
    expect(reason(`${body}.${sig.slice(0, -2)}AA`)).toBe('signature');
    expect(reason(`${body}.`)).toBe('signature');
    expect(reason('')).toBe('malformed');
    expect(reason('no-dot')).toBe('malformed');
    expect(reason('a.b.c')).toBe('malformed');
    expect(reason('x'.repeat(5000))).toBe('malformed');
    expect(reason(new FileTokenSigner(randomBytes(32)).sign(base()))).toBe('signature');
  });

  it('a token for an invalid key cannot be signed or verified', () => {
    expect(() => signer.sign(base({ k: '../../etc/passwd' }))).toThrow();
  });

  it('expires', () => {
    const token = signer.sign(base({ exp: Math.floor(Date.now() / 1000) + 5 }));
    expect(() => signer.verify(token, new Date(Date.now() + 10_000))).toThrow(FileTokenError);
    expect(() => signer.verify(token, new Date(Date.now() + 10_000))).toThrow(/expired/);
  });

  it('the same master key gives the same signer in every process', () => {
    const master = randomBytes(32);
    const a = new FileTokenSigner(master);
    const b = new FileTokenSigner(master);
    expect(b.verify(a.sign(base())).k).toBe(key);
  });

  it('fuzz: random token strings never verify', () => {
    for (let i = 0; i < 2000; i++) {
      const t = `${randomBytes(20).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
      expect(() => signer.verify(t)).toThrow(FileTokenError);
    }
  });
});
