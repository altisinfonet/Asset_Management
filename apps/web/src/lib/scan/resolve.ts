import { ApiError } from '@assettracker/api-client';
import { assetsApi } from '@/lib/registry/api';
import type { Asset, ScanAction } from '@/lib/registry/types';
import {
  availableActions,
  type CustodyAction,
  type CustodyPermission,
} from '@/lib/custody/helpers';
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
  | { kind: 'ambiguous'; code: string };

const CUSTODY: ReadonlySet<ScanAction> = new Set(['checkout', 'checkin', 'transfer']);

/**
 * Resolve scanned or typed text to an asset: `GET /v1/scan/resolve` (label code or tag, also from
 * a label URL), then an exact serial number lookup as a fallback. Only `404` means "no match";
 * every other failure is thrown for the caller to report.
 */
export async function resolveScan(raw: string, can: CustodyPermission): Promise<ScanOutcome> {
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
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  const bySerial = await assetsApi.list({ serial: code, limit: 2, archived: 'exclude' });
  if (bySerial.data.length === 1) {
    const asset = bySerial.data[0]!;
    return {
      kind: 'found',
      asset,
      allowed: availableActions(asset, can),
      matchedBy: 'serial',
      code,
    };
  }
  return bySerial.data.length > 1 ? { kind: 'ambiguous', code } : { kind: 'not_found', code };
}
