/**
 * Prisma types `bytea` columns as `Uint8Array<ArrayBuffer>`, while `Buffer` (and `crypto` digests)
 * are `Uint8Array<ArrayBufferLike>`. This copies into a plain ArrayBuffer-backed view so token
 * hashes can be passed to `where`/`data` without casts.
 */
export function asBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value);
}
