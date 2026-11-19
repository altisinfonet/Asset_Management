import { fileTypeFromBuffer } from 'file-type';

/**
 * Upload type allow-list and content sniffing (M2-FILE-01, M2-SEC-02).
 *
 * Only these types are accepted: raster images, PDF, office formats (OOXML, ODF, legacy binary) and
 * CSV. SVG, HTML, XML, scripts and archives are NOT on the list and cannot be declared. A declared
 * content type is a CLAIM: it must match the filename extension, and the first bytes of the stored
 * object must be of the claimed format (`sniffContent`, checked when the client confirms the upload
 * and again before the object is ever served). Everything is served with a type taken from this table,
 * never from the bytes or the filename, as `attachment` unless it is a re-encodable raster image.
 */
export type TypeFamily = 'image' | 'pdf' | 'ooxml' | 'odf' | 'cfb' | 'csv';

export interface AllowedType {
  mime: string;
  /** Lower-case extensions (without the dot) a file of this type may carry. */
  extensions: readonly string[];
  family: TypeFamily;
  /** MIME types `file-type` may report for genuine content of this type. */
  sniffed: readonly string[];
}

const OOXML = (name: string, mime: string): AllowedType => ({
  mime,
  extensions: [name],
  family: 'ooxml',
  // A truncated zip header is reported as plain `zip`; the scan and the attachment disposition cover it.
  sniffed: [mime, 'application/zip'],
});
const ODF = (name: string, mime: string): AllowedType => ({
  mime,
  extensions: [name],
  family: 'odf',
  sniffed: [mime, 'application/zip'],
});

export const ALLOWED_TYPES: readonly AllowedType[] = [
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], family: 'image', sniffed: ['image/jpeg'] },
  { mime: 'image/png', extensions: ['png'], family: 'image', sniffed: ['image/png'] },
  { mime: 'image/webp', extensions: ['webp'], family: 'image', sniffed: ['image/webp'] },
  { mime: 'image/gif', extensions: ['gif'], family: 'image', sniffed: ['image/gif'] },
  { mime: 'application/pdf', extensions: ['pdf'], family: 'pdf', sniffed: ['application/pdf'] },
  OOXML('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  OOXML('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  OOXML('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  ODF('odt', 'application/vnd.oasis.opendocument.text'),
  ODF('ods', 'application/vnd.oasis.opendocument.spreadsheet'),
  ODF('odp', 'application/vnd.oasis.opendocument.presentation'),
  {
    mime: 'application/msword',
    extensions: ['doc'],
    family: 'cfb',
    sniffed: ['application/x-cfb'],
  },
  {
    mime: 'application/vnd.ms-excel',
    extensions: ['xls'],
    family: 'cfb',
    sniffed: ['application/x-cfb'],
  },
  {
    mime: 'application/vnd.ms-powerpoint',
    extensions: ['ppt'],
    family: 'cfb',
    sniffed: ['application/x-cfb'],
  },
  { mime: 'text/csv', extensions: ['csv'], family: 'csv', sniffed: [] },
];

const BY_MIME = new Map(ALLOWED_TYPES.map((t) => [t.mime, t]));

/** Types `sharp` can read, re-encode and thumbnail (never SVG). */
export const THUMBNAIL_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** Parameters (`; charset=utf-8`) and case are not part of the type. */
export function normalizeMime(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

export function findAllowedType(contentType: string): AllowedType | undefined {
  return BY_MIME.get(normalizeMime(contentType));
}

export const isImageMime = (mime: string): boolean => findAllowedType(mime)?.family === 'image';
export const isThumbnailable = (mime: string): boolean => THUMBNAIL_MIMES.has(normalizeMime(mime));

/** Raster images are shown inline; everything else is a download. */
export function dispositionFor(mime: string): 'inline' | 'attachment' {
  return isImageMime(mime) ? 'inline' : 'attachment';
}

/** The extension of a filename, lower-case, or `''`. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : '';
}

export type TypeCheck = { ok: true; type: AllowedType } | { ok: false; reason: string };

/** Declared type and filename: allow-listed, and the extension fits the type. */
export function checkDeclaredType(contentType: string, filename: string): TypeCheck {
  const type = findAllowedType(contentType);
  if (!type) {
    return {
      ok: false,
      reason: `Files of type "${normalizeMime(contentType).slice(0, 100)}" are not accepted. Allowed: images (JPEG, PNG, WebP, GIF), PDF, Office documents and CSV.`,
    };
  }
  const ext = extensionOf(filename);
  if (!type.extensions.includes(ext)) {
    return {
      ok: false,
      reason: `The file name extension "${ext || '(none)'}" does not match ${type.mime} (expected ${type.extensions.map((e) => `.${e}`).join(' or ')}).`,
    };
  }
  return { ok: true, type };
}

/** How many leading bytes `sniffContent` needs (OOXML detection looks at the first zip entries). */
export const SNIFF_BYTES = 256 * 1024;

/** UTF-8 byte order mark as a decoded character. */
const BOM = String.fromCharCode(0xfeff);
const MARKUP = /^\s*(?:<\?xml|<!doctype|<html|<svg|<script|<head|<body|<iframe|<meta|<style)/i;
const EMBEDDED_MARKUP = /<\s*(?:script|svg|html|iframe|object|embed)\b/i;

/** First `SNIFF_BYTES` of an object versus its declared type. */
export async function sniffContent(head: Buffer, type: AllowedType): Promise<TypeCheck> {
  if (head.length === 0) return { ok: false, reason: 'The file is empty.' };
  const detected = await fileTypeFromBuffer(head);

  if (type.family === 'csv') {
    if (detected) {
      return {
        ok: false,
        reason: `The content is ${detected.mime}, not CSV text.`,
      };
    }
    if (head.includes(0)) return { ok: false, reason: 'The content is binary, not CSV text.' };
    const text = decodeUtf8Prefix(head);
    if (text === null) return { ok: false, reason: 'The CSV file is not valid UTF-8.' };
    const probe = text.startsWith(BOM) ? text.slice(1) : text;
    if (MARKUP.test(probe) || EMBEDDED_MARKUP.test(probe.slice(0, 8192))) {
      return { ok: false, reason: 'The content looks like markup (HTML/SVG), not CSV text.' };
    }
    return { ok: true, type };
  }

  if (!detected) {
    return {
      ok: false,
      reason: `The content could not be identified as ${type.mime}.`,
    };
  }
  if (!type.sniffed.includes(detected.mime)) {
    return {
      ok: false,
      reason: `The content is ${detected.mime}, which does not match the declared type ${type.mime}.`,
    };
  }
  return { ok: true, type };
}

/** UTF-8 decode that tolerates a multi-byte sequence cut off at the end of the sampled prefix. */
function decodeUtf8Prefix(buf: Buffer): string | null {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let trim = 0; trim <= 3 && trim < buf.length; trim++) {
    try {
      return decoder.decode(buf.subarray(0, buf.length - trim));
    } catch {
      // try again without the last (possibly incomplete) byte
    }
  }
  return null;
}
