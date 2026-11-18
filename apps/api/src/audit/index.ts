// Public facade of the audit module (M1-PLAT-04). Domain code injects the AUDIT_WRITER port
// (src/ports) rather than importing this; the helpers here are for building diffs.
export { PgAuditWriter } from './audit-writer.js';
export {
  REDACTED,
  SENSITIVE_KEY_FRAGMENTS,
  diffRecords,
  isSensitiveKey,
  redactSensitive,
  type AuditDiff,
} from './redact.js';
