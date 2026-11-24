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
  is_active: boolean;
  _v: number;
}

export interface MockMember {
  loaner_pool_id: string;
  asset_id: string;
  added_at: string;
}

export interface MockLoanSettings {
  default_loan_days: number;
  max_loan_days: number | null;
  reminder_lead_days: number;
  _v: number;
}

export type ImportState = S['ImportJob']['state'];

/** A stored import job: the contract object plus what the mock "worker" keeps to move it along. */
export interface MockImportJob {
  id: string;
  source: S['ImportJob']['source'];
  entity_type: S['ImportJob']['entity_type'];
  state: ImportState;
  file_attachment_id: string | null;
  original_filename: string | null;
  mapping: Record<string, string>;
  options: Record<string, unknown>;
  rows_total: number;
  rows_create: number;
  rows_update: number;
  rows_skip: number;
  rows_error: number;
  dry_run_digest: string | null;
  dry_run_completed_at: string | null;
  committed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  commit_progress: S['ImportCommitProgress'] | null;
  /** The text of the attached CSV file (the mock storage keeps no bytes). */
  file_text: string | null;
  /** Epoch ms at which the queued dry run finishes (the mock "worker"). */
  dry_run_ready_at: number | null;
  /** Epoch ms at which the commit started running. */
  commit_started_at: number | null;
  cancel_requested: boolean;
  _v: number;
}

export interface MockImportRow {
  job_id: string;
  row_no: number;
  phase: 'dry_run' | 'commit';
  outcome: 'create' | 'update' | 'skip' | 'error';
  entity_id: string | null;
  errors: Array<{ pointer: string; message: string; code?: string }>;
  warnings: Array<{ pointer: string; message: string; code?: string }>;
  source_data: Record<string, string> | null;
}

export interface MockMappingTemplate {
  id: string;
  name: string;
  entity_type: S['ImportJob']['entity_type'];
  source: S['ImportJob']['source'];
  mapping: Record<string, string>;
  options: Record<string, unknown>;
  created_at: string;
}

export interface W3Data {
  pools: MockPool[];
  members: MockMember[];
  loanSettings: MockLoanSettings;
  /** The two seed pools and their loans were created. */
  loansSeeded: boolean;
  importJobs: MockImportJob[];
  importRows: MockImportRow[];
  mappingTemplates: MockMappingTemplate[];
}

const KEY = 'at-mock-w3-v1';

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
    loanSettings: { default_loan_days: 7, max_loan_days: 30, reminder_lead_days: 1, _v: 1 },
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
