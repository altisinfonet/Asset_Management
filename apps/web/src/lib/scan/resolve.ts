import { ApiError } from '@assettracker/api-client';
import { assetsApi } from '@/lib/registry/api';
import type { Asset, ScanAction } from '@/lib/registry/types';
import type { CustodyAction } from '@/lib/custody/helpers';
import { extractScanCode, isScannable } from './parse';

export type ScanOutcome =
  | {
      kind: 'found';
      asset: Asset;
      /** Custody actions valid for the asset now and for this user. */
      allowed: CustodyAction[];
      matchedBy: 'label_code' | 'asset_tag' | 'serial';
      code: string;
    }
  | { kind: 'not_found'; code: string }
  /** `409 conflict`: several assets share this serial number. */
  | { kind: 'ambiguous'; code: string };

const CUSTODY: ReadonlySet<ScanAction> = new Set(['checkout', 'checkin', 'transfer']);

/**
 * Resolve scanned or typed text to an asset with one call, `GET /v1/scan/resolve`: the server
 * matches the label code, then the asset tag, then an exact serial number (also from a label URL).
 * `404` means "no match" and `409` that a serial belongs to several assets; every other failure is
 * thrown for the caller to report.
 */
export async function resolveScan(raw: string): Promise<ScanOutcome> {
  const code = extractScanCode(raw);
  if (!isScannable(code)) return { kind: 'not_found', code };
  try {
    const result = await assetsApi.resolve(code);
    return {
      kind: 'found',
      asset: result.asset,
      allowed: result.allowed_actions.filter((a): a is CustodyAction => CUSTODY.has(a)),
      matchedBy: result.match_type,
      code,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { kind: 'not_found', code };
    if (err instanceof ApiError && err.status === 409) return { kind: 'ambiguous', code };
    throw err;
  }
}
