import type { LabelCodeType, LabelField, LabelTemplate } from './api';

/**
 * Pure helpers of the label dialog: sheet arithmetic (which slot a label lands in), what a
 * template allows, and the remembered choice.
 */

/** Hard limit of one render request (`LabelRenderRequest.asset_ids`). */
export const MAX_LABELS = 500;

export const LABEL_FIELDS: readonly LabelField[] = [
  'tag',
  'name',
  'location',
  'serial',
  'organisation',
];

export const CODE_TYPES: readonly LabelCodeType[] = ['qr', 'code128', 'qr_and_code128'];

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

/** Template codes -> what the template can print. `qr_and_code128` templates print both. */
export function codeTypeOf(template: Pick<LabelTemplate, 'code_type'>): LabelCodeType {
  return template.code_type;
}

export function showsQr(type: LabelCodeType): boolean {
  return type === 'qr' || type === 'qr_and_code128';
}
export function showsBarcode(type: LabelCodeType): boolean {
  return type === 'code128' || type === 'qr_and_code128';
}

/** From the two checkboxes of the form to the API's code type; `null` when neither is ticked. */
export function codeTypeFrom(qr: boolean, barcode: boolean): LabelCodeType | null {
  if (qr && barcode) return 'qr_and_code128';
  if (qr) return 'qr';
  if (barcode) return 'code128';
  return null;
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
  code_type?: LabelCodeType;
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
      ...(CODE_TYPES.includes(record.code_type as LabelCodeType)
        ? { code_type: record.code_type as LabelCodeType }
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
