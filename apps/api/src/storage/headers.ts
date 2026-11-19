/**
 * Response headers for anything that serves stored bytes (M2-FILE-03, M2-SEC-02).
 *
 * Uploaded content is attacker-controlled, so a served file must never be able to run in the
 * application origin or be re-interpreted by the browser:
 *
 *   Content-Type            fixed from the allow-list (never from the uploaded bytes or the filename)
 *   Content-Disposition     `attachment` for everything but the re-encodable raster images
 *   X-Content-Type-Options  nosniff
 *   Content-Security-Policy default-src 'none'; sandbox   (even a mislabelled HTML page cannot script)
 *   Cross-Origin-Resource-Policy cross-origin  (the web app, on another origin in dev, embeds thumbnails)
 *   Cache-Control           private, no-store (the URL is a short-lived capability)
 *   Referrer-Policy         no-referrer (the URL itself is the capability)
 *   X-Frame-Options         DENY
 *   Set-Cookie              never (serve from a cookie-less host when the deployment has one)
 *
 * The local driver (and any API-served file route) sets ALL of them. A presigned S3 URL is answered by
 * the object store, which lets a presigner override only `response-content-type`,
 * `response-content-disposition` and `response-cache-control`; the S3 adapter sets exactly those, and
 * the remaining protection is the different origin of the store (no application cookies, no access to
 * the app's DOM) plus the allow-list (no HTML or SVG ever reaches the store: see `files/content.ts`).
 */
export const FILE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'cross-origin',
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

/**
 * RFC 6266 / 5987 Content-Disposition with a safe ASCII fallback. The filename is untrusted:
 * control characters, path separators, quotes and bidi overrides (U+202A-202E, U+2066-2069) are
 * removed, so it can neither break out of the header nor visually spoof an extension.
 */
export function contentDisposition(filename: string, disposition: 'inline' | 'attachment'): string {
  const clean = sanitizeFilename(filename);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_');
  const encoded = encodeURIComponent(clean).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\/:*?"<>|]/g;

/** At most `max` characters, keeping the extension (used where the name travels inside a URL token). */
export function truncateFilename(filename: string, max: number): string {
  const name = sanitizeFilename(filename);
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1)}~${ext}`;
}

/** A filename that is safe to store, display and put in a header (never empty, max 255 chars). */
export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .normalize('NFC')
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : 'file';
}
