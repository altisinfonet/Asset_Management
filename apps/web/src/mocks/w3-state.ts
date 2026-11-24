import type { components } from '@assettracker/api-client';
import { onMockReset } from './state';

/**
 * State of the M2 wave 3 mock endpoints: loaner pools (with their members and the organisation's
 * loan defaults) and import jobs (with their rows and the saved column mappings). Held in memory
 * and mirrored to `localStorage` on every change, like the registry, so a full page load keeps what
 * a user did. The loans themselves live in the registry (assignments); the first use of a loaner
 * endpoint seeds two pools and a few loans (see `w3-loaner-handlers.ts`).
 */
type S = components['schemas'];

export interface MockPool {
  id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  name: string;
  description: string | null;
  home_location_id: string | null;
  default_loan_days: number;
  max_loan_days: number | null;
  max_loans_per_person: number | null;
  eligible_person_kinds: Array<'employee' | 'student' | 'contractor' | 'external'> | null;
  owner_user_id: string | null;
  is_active: boolean;
  _v: number;
}

export interface MockMember {
  loaner_pool_id: string;
  asset_id: string;
  added_at: string;
}

export interface MockCustodySettings {
  default_expected_return_days: number | null;
  loan_reminder_days: number;
  _v: number;
}

export type ImportState = S['ImportJob']['state'];

/** A stored import job: the contract object (as the API keeps it) plus what the mock worker needs. */
export interface MockImportJob {
  id: string;
  entity_type: S['ImportJob']['entity_type'];
  source: S['ImportJob']['source'];
  preset_key: string | null;
  state: ImportState;
  filename: string | null;
  file_attachment_id: string | null;
  parse: Record<string, unknown>;
  headers: string[] | null;
  mapping: Record<string, unknown>;
  options: Record<string, unknown>;
  value_map: Record<string, Record<string, unknown>>;
  rows_total: number;
  /** The dry-run verdict counts and the commit result counts. */
  plan: { create: number; update: number; skip: number; error: number };
  done: { created: number; updated: number; skipped: number; error: number };
  dry_run_digest: string | null;
  dry_run_at: string | null;
  committed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  data_purged_at: string | null;
  cancel_requested: boolean;
  error: string | null;
  summary: Record<string, unknown> | null;
  requested_by: string;
  created_at: string;
  updated_at: string;
  profile: unknown[] | null;
  samples: string[][] | null;
  confidence: Record<string, number> | null;
  /** The text of the attached CSV (the mock storage keeps no bytes); null for a spreadsheet or after the purge. */
  file_text: string | null;
  /** Epoch ms the running phase started (the mock worker derives its progress from it); null when idle. */
  phase_started_at: number | null;
  /** Rows of the running phase the worker has handled so far. */
  cursor: number;
  /** Batches the worker had finished when a cancel was asked: the batch in flight is finished, then it stops. */
  cancel_batches: number;
  _v: number;
}

/** One row of the file with its verdicts (the import_row table): raw cells, typed record, dry-run plan and commit result. */
export interface MockImportRow {
  job_id: string;
  row_no: number;
  line_no: number;
  raw: string[];
  mapped: Record<string, unknown> | null;
  plan: 'create' | 'update' | 'skip' | 'error' | null;
  errors: Array<{ field: string | null; message: string; code: string }>;
  warnings: Array<{ field: string | null; message: string; code: string }>;
  entity_id: string | null;
  /** Version of the existing record at dry-run time (to notice an edit before the commit). */
  entity_version: number | null;
  dup_of: number | null;
  result: 'created' | 'updated' | 'skipped' | 'error' | null;
  result_errors: Array<{ field: string | null; message: string; code: string }> | null;
  created_id: string | null;
  before_image: Record<string, unknown> | null;
}

export interface MockMappingTemplate {
  id: string;
  name: string;
  description: string | null;
  entity_type: S['ImportJob']['entity_type'];
  columns: Array<{ header: string; target: string | null; date_format?: string }>;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  _v: number;
}

export interface W3Data {
  pools: MockPool[];
  members: MockMember[];
  custodySettings: MockCustodySettings;
  /** The two seed pools and their loans were created. */
  loansSeeded: boolean;
  importJobs: MockImportJob[];
  importRows: MockImportRow[];
  mappingTemplates: MockMappingTemplate[];
}

const KEY = 'at-mock-w3-v3';

const KIND_CODE = { pool: '00b1', import: '00b2', template: '00b3', row: '00b4' } as const;
export type W3Kind = keyof typeof KIND_CODE;

export function w3Id(kind: W3Kind, n: number): string {
  return `0190a6b2-${KIND_CODE[kind]}-7000-8000-${String(n).padStart(12, '0')}`;
}

let created = 0;
/** Ids of created records, apart from the seeded ranges; well-formed UUIDs. */
export function newW3Id(kind: W3Kind): string {
  created += 1;
  return w3Id(kind, 800_000_000_000 + (Date.now() % 100_000_000_000) + created);
}

function emptyState(): W3Data {
  return {
    pools: [],
    members: [],
    custodySettings: { default_expected_return_days: null, loan_reminder_days: 2, _v: 1 },
    loansSeeded: false,
    importJobs: [],
    importRows: [],
    mappingTemplates: [],
  };
}

let memory: W3Data | undefined;

export function w3(): W3Data {
  if (memory) return memory;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      memory = JSON.parse(raw) as W3Data;
      return memory;
    }
  } catch {
    // storage unavailable or corrupt: start empty
  }
  memory = emptyState();
  return memory;
}

function persist() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(memory));
  } catch {
    // storage unavailable or full: memory only
  }
}

/** Apply `change` to the data and persist the result. */
export function mutateW3<T>(change: (data: W3Data) => T): T {
  const result = change(w3());
  persist();
  return result;
}

/** What the mock storage received per `import_file` attachment (the PUT handler fills it, the import worker reads it). */
const uploadedText = new Map<string, string>();
export const rememberImportUpload = (attachmentId: string, text: string): void => {
  uploadedText.set(attachmentId, text);
};
export const importUploadText = (attachmentId: string): string | null =>
  uploadedText.get(attachmentId) ?? null;

export function resetW3(): void {
  uploadedText.clear();
  memory = undefined;
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

onMockReset(resetW3);
