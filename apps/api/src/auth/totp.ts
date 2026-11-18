import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s step): what every authenticator app implements. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous, current and next step: tolerates ~30 s of clock drift either way. */
export const TOTP_WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** 160-bit shared secret (the size RFC 4226 recommends). */
export function generateTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

export function hotp(secret: Uint8Array, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(bin % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** The time step whose code matches `code` within the window, or null. Constant-time per candidate. */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number = Date.now(),
): number | null {
  const normalised = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalised)) return null;
  const given = Buffer.from(normalised);
  const current = totpStep(nowMs);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(opts: { secret: Uint8Array; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const params = new URLSearchParams({
    secret: base32Encode(opts.secret),
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
