/**
 * What was scanned or typed, as the code the API resolves: a bare tag or label code stays as is; a
 * label URL (`https://host/s/<code>`, what a QR label encodes) yields its last path segment.
 */
export function extractScanCode(raw: string): string {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const segments = new URL(value).pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) return decodeURIComponent(last);
    } catch {
      // not a URL after all: treat the text as the code
    }
  }
  return value;
}

/** A value worth sending to `scan/resolve`: 1-200 characters, no line breaks. */
export function isScannable(code: string): boolean {
  return code.length >= 1 && code.length <= 200 && !/[\r\n]/.test(code);
}
