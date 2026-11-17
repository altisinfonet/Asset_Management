import { createHash, randomBytes } from 'node:crypto';

/** A random URL-safe secret (session cookie, invitation link). 256 bits. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of a token. Only the hash is ever stored (identity.session / invitation_token). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
