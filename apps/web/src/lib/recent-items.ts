/**
 * Recently used command-palette targets, kept in localStorage per browser (a convenience, never
 * state that matters: every read and write is wrapped, and the palette works without storage).
 *
 * Entries store ids, not translated labels or URLs: a page is a navigation id (`assets`), an
 * asset is the tag/code that was typed. The palette rebuilds label and link from the current
 * navigation, so a changed menu or language never leaves a stale entry, and a tampered value
 * cannot inject a link.
 */
export type RecentEntry = { type: 'page'; id: string } | { type: 'asset'; code: string };

export const RECENT_STORAGE_KEY = 'at-recent-items';
export const MAX_RECENT = 5;

const CODE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A typed value that looks like an asset tag or QR code (no spaces, short). */
export function isAssetCode(value: string): boolean {
  return CODE_SHAPE.test(value);
}

function sameEntry(a: RecentEntry, b: RecentEntry): boolean {
  return a.type === 'page' && b.type === 'page'
    ? a.id === b.id
    : a.type === 'asset' && b.type === 'asset' && a.code === b.code;
}

function parse(raw: string | null): RecentEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const entries: RecentEntry[] = [];
    for (const item of data) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      if (
        record.type === 'page' &&
        typeof record.id === 'string' &&
        /^[a-z-]{1,32}$/.test(record.id)
      ) {
        entries.push({ type: 'page', id: record.id });
      } else if (
        record.type === 'asset' &&
        typeof record.code === 'string' &&
        isAssetCode(record.code)
      ) {
        entries.push({ type: 'asset', code: record.code });
      }
    }
    return entries.slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function readRecent(): RecentEntry[] {
  try {
    return parse(window.localStorage.getItem(RECENT_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Put `entry` first (deduplicated, at most `MAX_RECENT`) and return the new list. */
export function pushRecent(entry: RecentEntry): RecentEntry[] {
  const next = [entry, ...readRecent().filter((existing) => !sameEntry(existing, entry))].slice(
    0,
    MAX_RECENT,
  );
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode, quota): the in-memory result is still returned
  }
  return next;
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(RECENT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
