/**
 * The fixed label templates (M2-TAG-02; the editor is v1.1, plan decision 22). THE geometry constants:
 * migration 0070 seeds the same rows per tenant (`app.seed_label_templates`) and
 * `test/tagging/labels.e2e.test.ts` fails when a seeded row and a constant disagree, so a change here
 * needs a migration. Snapshot-compared by `templates.test.ts`.
 *
 * All lengths are millimetres, measured from the top-left corner of the page; labels are laid out
 * row by row, left to right (the numbering of a start position on a partly used sheet).
 */
export const LABEL_FIELDS = [
  'asset_tag',
  'name',
  'serial',
  'location',
  'model',
  'organisation',
] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

export const LABEL_CODES = ['qr', 'code128'] as const;
export type LabelCode = (typeof LABEL_CODES)[number];

export const CODE_TYPES = ['qr', 'code128', 'qr_and_code128'] as const;
export type CodeType = (typeof CODE_TYPES)[number];

export interface TemplateGeometry {
  key: string;
  name: string;
  pageSize: 'letter' | 'a4' | 'custom';
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  cols: number;
  rows: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
  codeType: CodeType;
  fields: readonly LabelField[];
}

/** A template as the renderer needs it: the geometry plus the calibration shift of the whole sheet. */
export interface RenderTemplate extends TemplateGeometry {
  offsetXMm: number;
  offsetYMm: number;
}

export const LABEL_TEMPLATES: readonly TemplateGeometry[] = [
  {
    key: 'letter-30up-qr',
    name: 'US Letter 30-up (Avery 5160 layout), QR',
    pageSize: 'letter',
    pageWidthMm: 215.9,
    pageHeightMm: 279.4,
    labelWidthMm: 66.68,
    labelHeightMm: 25.4,
    cols: 3,
    rows: 10,
    marginTopMm: 12.7,
    marginLeftMm: 4.76,
    gapXMm: 3.18,
    gapYMm: 0,
    codeType: 'qr',
    fields: ['asset_tag', 'name'],
  },
  {
    key: 'a4-21up-qr',
    name: 'A4 21-up (Avery L7160 layout), QR',
    pageSize: 'a4',
    pageWidthMm: 210,
    pageHeightMm: 297,
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    cols: 3,
    rows: 7,
    marginTopMm: 15.15,
    marginLeftMm: 7.21,
    gapXMm: 2.54,
    gapYMm: 0,
    codeType: 'qr',
    fields: ['asset_tag', 'name'],
  },
  {
    key: 'a4-24up-qr',
    name: 'A4 24-up, 3 x 8 (Avery L7159 layout), QR',
    pageSize: 'a4',
    pageWidthMm: 210,
    pageHeightMm: 297,
    labelWidthMm: 63.5,
    labelHeightMm: 33.9,
    cols: 3,
    rows: 8,
    marginTopMm: 12.9,
    marginLeftMm: 7.21,
    gapXMm: 2.54,
    gapYMm: 0,
    codeType: 'qr',
    fields: ['asset_tag', 'name'],
  },
  {
    key: 'letter-10up-qr',
    name: 'US Letter 10-up (Avery 5163 layout), QR and Code128',
    pageSize: 'letter',
    pageWidthMm: 215.9,
    pageHeightMm: 279.4,
    labelWidthMm: 101.6,
    labelHeightMm: 50.8,
    cols: 2,
    rows: 5,
    marginTopMm: 12.7,
    marginLeftMm: 3.97,
    gapXMm: 4.76,
    gapYMm: 0,
    codeType: 'qr_and_code128',
    fields: ['asset_tag', 'name', 'serial'],
  },
  {
    key: 'single-50x25-qr',
    name: 'Single label 50 x 25 mm, QR (one per page)',
    pageSize: 'custom',
    pageWidthMm: 50,
    pageHeightMm: 25,
    labelWidthMm: 50,
    labelHeightMm: 25,
    cols: 1,
    rows: 1,
    marginTopMm: 0,
    marginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
    codeType: 'qr',
    fields: ['asset_tag'],
  },
  {
    key: 'thermal-2x1in-qr',
    name: 'Single label 2 x 1 inch for thermal / roll printers, QR and Code128',
    pageSize: 'custom',
    pageWidthMm: 50.8,
    pageHeightMm: 25.4,
    labelWidthMm: 50.8,
    labelHeightMm: 25.4,
    cols: 1,
    rows: 1,
    marginTopMm: 0,
    marginLeftMm: 0,
    gapXMm: 0,
    gapYMm: 0,
    codeType: 'qr_and_code128',
    fields: ['asset_tag', 'name'],
  },
];

export const slotsPerPage = (t: Pick<TemplateGeometry, 'cols' | 'rows'>): number => t.cols * t.rows;

/** The codes a template draws by default. */
export const codesOf = (type: CodeType): LabelCode[] =>
  type === 'qr_and_code128' ? ['qr', 'code128'] : [type];

export interface SlotRect {
  /** 0-based page, row and column of the slot. */
  page: number;
  row: number;
  col: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/**
 * Where slot number `index` (0-based, counted across pages from the first slot of the first page)
 * lies: row by row, left to right, calibration offsets applied.
 */
export function slotRect(t: RenderTemplate, index: number): SlotRect {
  const per = slotsPerPage(t);
  const page = Math.floor(index / per);
  const within = index % per;
  const row = Math.floor(within / t.cols);
  const col = within % t.cols;
  return {
    page,
    row,
    col,
    xMm: t.marginLeftMm + col * (t.labelWidthMm + t.gapXMm) + t.offsetXMm,
    yMm: t.marginTopMm + row * (t.labelHeightMm + t.gapYMm) + t.offsetYMm,
    widthMm: t.labelWidthMm,
    heightMm: t.labelHeightMm,
  };
}

/** Pages needed for `labels` labels when the first one goes to 1-based slot `startPosition`. */
export function pagesNeeded(
  t: Pick<TemplateGeometry, 'cols' | 'rows'>,
  labels: number,
  startPosition: number,
): number {
  return Math.ceil((startPosition - 1 + labels) / slotsPerPage(t));
}
