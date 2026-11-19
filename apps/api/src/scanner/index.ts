// Public facade of the scanner module (M2-FILE-02): ClamAV over TCP behind the VIRUS_SCANNER port.
import type { AppConfig } from '../config/env.js';
import type { VirusScanner } from '../ports/index.js';
import { ClamdScanner, DisabledScanner } from './clamd.js';

export {
  ClamdScanner,
  DisabledScanner,
  ScannerUnavailableError,
  parseAnswer,
  type ClamdOptions,
} from './clamd.js';

/** `CLAMD_HOST` set: ClamAV; otherwise a scanner that reports `enabled = false`. */
export function createVirusScanner(
  config: Pick<AppConfig, 'CLAMD_HOST' | 'CLAMD_PORT' | 'CLAMD_TIMEOUT_SECONDS'>,
): VirusScanner {
  return config.CLAMD_HOST
    ? new ClamdScanner({
        host: config.CLAMD_HOST,
        port: config.CLAMD_PORT,
        timeoutMs: config.CLAMD_TIMEOUT_SECONDS * 1000,
      })
    : new DisabledScanner();
}
