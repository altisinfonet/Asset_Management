import { problem } from '../platform/index.js';
import { Prisma, type Tx } from '../tenancy/index.js';
import { type AssetRow, loadAssetRows } from './asset-queries.js';

/**
 * Scanned codes (M2-TAG-01): the candidates a raw scan can stand for, and the asset they identify.
 * `GET /v1/scan/resolve` and the quick loan flows (ED-20) share this lookup.
 */

export type AssetMatchType = 'label_code' | 'asset_tag' | 'serial';

/** The whole code first (a tag may contain "/"); a label URL then yields its last path segment. */
export function scanCandidates(rawCode: string): string[] {
  const whole = rawCode.trim();
  const candidates = [whole];
  if (/^(https?:\/\/|\/)/i.test(whole)) {
    const last = whole.split(/[?#]/)[0]!.split('/').filter(Boolean).pop();
    if (last && last !== whole) candidates.push(last);
  }
  return candidates;
}

/**
 * The asset a code identifies: the opaque `label_code`, then the asset tag, then the exact serial
 * number (all case-insensitive but the label code). A serial that belongs to several assets is
 * refused (409), never guessed: a wrong asset must never be checked out by a scan. Null = no match.
 */
export async function findAssetByCode(
  trx: Tx,
  candidates: readonly string[],
): Promise<{ row: AssetRow; matchType: AssetMatchType } | null> {
  for (const code of candidates) {
    let [row] = await loadAssetRows(trx, Prisma.sql`a.label_code = ${code}`, 1);
    if (row) return { row, matchType: 'label_code' };
    [row] = await loadAssetRows(trx, Prisma.sql`a.asset_tag_key = lower(${code})`, 1);
    if (row) return { row, matchType: 'asset_tag' };
    const bySerial = await loadAssetRows(trx, Prisma.sql`a.serial_key = lower(${code})`, 2);
    if (bySerial.length > 1) {
      throw problem.conflict(
        'Several assets share this serial number. Scan the label or enter the asset tag instead.',
      );
    }
    if (bySerial[0]) return { row: bySerial[0], matchType: 'serial' };
  }
  return null;
}
