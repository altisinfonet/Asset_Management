import type { AssetListQuery } from '@/lib/registry/api';
import type { LabelAssetFilter, LabelCode, LabelCodeType, LabelField, LabelTemplate } from './api';

/**
 * Pure helpers of the label dialog: sheet arithmetic (which slot a label lands in), what a
 * template allows, and the remembered choice.
 */

/** Hard limit of one batch: assets (`asset_ids` or a filter) and labels (assets x copies). */
export const MAX_LABELS = 2000;

/** The text lines a label can carry, in the order the API lists them. */
export const LABEL_FIELDS: readonly LabelField[] = [
  'asset_tag',
  'name',
  'serial',
  'location',
  'model',
  'organisation',
];

export const LABEL_CODES: readonly LabelCode[] = ['qr', 'code128'];

export function slotsPerSheet(template: Pick<LabelTemplate, 'cols' | 'rows'>): number {
  return Math.max(1, template.cols * template.rows);
}

/** 1-based slot -> 0-based row and column (slots count left to right, then top to bottom). */
export function slotCell(
  slot: number,
  template: Pick<LabelTemplate, 'cols' | 'rows'>,
): { row: number; col: number } {
  const index = Math.max(0, slot - 1) % slotsPerSheet(template);
  return { row: Math.floor(index / template.cols), col: index % template.cols };
}

/** Slot of a (row, col) cell, 1-based. */
export function cellSlot(row: number, col: number, template: Pick<LabelTemplate, 'cols'>): number {
  return row * template.cols + col + 1;
}

/** How many sheets `count` labels need when the first sheet starts at `start` (1-based). */
export function sheetCount(
  count: number,
  start: number,
  template: Pick<LabelTemplate, 'cols' | 'rows'>,
): number {
  if (count <= 0) return 0;
  const perSheet = slotsPerSheet(template);
  const used = (Math.max(1, start) - 1) % perSheet;
  return Math.ceil((used + count) / perSheet);
}

/**
 * Which slots of sheet `sheet` (1-based) the labels take: `used` slots are skipped (the part of a
 * sheet that was printed before), `filled` get a label, the rest stay empty.
 */
export function sheetSlots(
  sheet: number,
  count: number,
  start: number,
  template: Pick<LabelTemplate, 'cols' | 'rows'>,
): Array<'used' | 'label' | 'empty'> {
  const perSheet = slotsPerSheet(template);
  const offset = (Math.max(1, start) - 1) % perSheet;
  const firstOfSheet = sheet === 1 ? offset : 0;
  // labels placed before this sheet
  const before = sheet === 1 ? 0 : perSheet - offset + (sheet - 2) * perSheet;
  const remaining = Math.max(0, count - before);
  return Array.from({ length: perSheet }, (_, index) => {
    if (index < firstOfSheet) return 'used';
    return index - firstOfSheet < remaining ? 'label' : 'empty';
  });
}

/** A single-label page (roll printers) has no slots to choose. */
export function isSingleLabel(template: Pick<LabelTemplate, 'cols' | 'rows'>): boolean {
  return slotsPerSheet(template) === 1;
}

/** The codes a template type draws: `qr_and_code128` draws both. */
export function codesOfType(type: LabelCodeType): LabelCode[] {
  return type === 'qr_and_code128' ? ['qr', 'code128'] : [type];
}

/** The codes a template draws unless a batch says otherwise. */
export const codesOf = (template: Pick<LabelTemplate, 'code_type'>): LabelCode[] =>
  codesOfType(template.code_type);

export const showsQr = (codes: readonly LabelCode[]): boolean => codes.includes('qr');
export const showsBarcode = (codes: readonly LabelCode[]): boolean => codes.includes('code128');

/** From the two checkboxes of the form to the API's `codes` list (an empty list prints text only). */
export function codesFrom(qr: boolean, barcode: boolean): LabelCode[] {
  return [...(qr ? (['qr'] as const) : []), ...(barcode ? (['code128'] as const) : [])];
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/**
 * The `filter` of a batch for a list query: the filters of `GET /v1/assets` without paging
 * (`LabelAssetFilter`). `null` when the list uses something a batch filter cannot express (custom
 * field filters): the dialog then sends the asset ids instead.
 */
export function toLabelFilter(query: AssetListQuery): LabelAssetFilter | null {
  if (query.cf && Object.keys(query.cf).length > 0) return null;
  const filter: LabelAssetFilter = {};
  if (query.q) filter.q = query.q;
  if (query.archived) filter.archived = query.archived;
  if (query.status_id?.length) filter.status_id = query.status_id;
  if (query.category_id?.length) filter.category_id = query.category_id;
  if (query.location_id) {
    filter.location_id = query.location_id;
    if (query.include_sublocations !== undefined) {
      filter.include_sublocations = query.include_sublocations;
    }
  }
  if (query.assigned !== undefined) filter.assigned = query.assigned;
  if (query.assigned_person_id) filter.assigned_person_id = query.assigned_person_id;
  if (query.import_job_id) filter.import_job_id = query.import_job_id;
  if (query.sort?.length) filter.sort = query.sort.join(',');
  return filter;
}

/** Template fields as far as this UI knows them (an unknown name from a newer API is dropped). */
export function knownFields(fields: readonly string[] | undefined): LabelField[] {
  return LABEL_FIELDS.filter((field) => fields?.includes(field));
}

/** Millimetres to a CSS length of the preview (`mm` units keep the preview true to scale). */
export const mm = (value: number | undefined): string => `${value ?? 0}mm`;

// ---- the remembered choice ------------------------------------------------------------------

export const LABEL_CHOICE_KEY = 'at-label-choice';

export interface LabelChoice {
  template_key: string;
  codes?: LabelCode[];
  fields?: LabelField[];
}

/** The last template (and code / field choice) used in this browser; storage may be unavailable. */
export function readLabelChoice(): LabelChoice | null {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(LABEL_CHOICE_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.template_key !== 'string' || !record.template_key) return null;
    return {
      template_key: record.template_key.slice(0, 80),
      ...(Array.isArray(record.codes)
        ? { codes: LABEL_CODES.filter((c) => (record.codes as unknown[]).includes(c)) }
        : {}),
      ...(Array.isArray(record.fields)
        ? { fields: LABEL_FIELDS.filter((f) => (record.fields as unknown[]).includes(f)) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function writeLabelChoice(choice: LabelChoice): void {
  try {
    window.localStorage.setItem(LABEL_CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // storage unavailable (private mode, quota): the choice just is not remembered
  }
}
