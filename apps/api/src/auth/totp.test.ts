import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUri, totpStep } from './totp.js';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890" (8-digit vectors; the 6-digit code is their last 6 digits).
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, code] of vectors) {
      expect(hotp(RFC_SECRET, totpStep(seconds * 1000)), `T=${seconds}`).toBe(code);
    }
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676'];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });

  it('accepts the previous, current and next step and nothing else; returns the step', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) {
      expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + offset), now)).toBe(step + offset);
    }
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now)).toBeNull();
  });

  it('ignores spaces and rejects malformed codes', () => {
    const now = 1_700_000_000_000;
    const code = hotp(RFC_SECRET, totpStep(now));
    expect(matchTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
      expect(matchTotp(RFC_SECRET, bad, now), bad).toBeNull();
    }
  });

  it('round-trips base32 and builds an otpauth URI', () => {
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect([...base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')]).toEqual([...RFC_SECRET]);
    expect([...base32Decode('gezd gnbv-GY3TQOJQ GEZDGNBVGY3TQOJQ===')]).toEqual([...RFC_SECRET]);
    expect(() => base32Decode('not base32!')).toThrow();
    const uri = otpauthUri({
      secret: RFC_SECRET,
      account: 'a+b@x.example',
      issuer: 'Asset Tracker',
    });
    expect(uri).toBe(
      'otpauth://totp/Asset%20Tracker:a%2Bb%40x.example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Asset+Tracker&algorithm=SHA1&digits=6&period=30',
    );
  });
});
