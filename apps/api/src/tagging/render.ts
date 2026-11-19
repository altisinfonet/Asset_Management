import { setImmediate as tick } from 'node:timers/promises';
import bwipjs from 'bwip-js';
import PDFDocument from 'pdfkit';
import {
  type LabelCode,
  type LabelField,
  type RenderTemplate,
  pagesNeeded,
  slotRect,
  slotsPerPage,
} from './templates.js';

/**
 * Pure label renderer (M2-TAG-02): labels in, one PDF out. No database, no storage, no clock: the
 * worker feeds it and tests decode what it produced.
 *
 * Libraries (ADR 0007): `pdfkit` writes the PDF (pure JS, maintained, standard fonts so nothing is
 * embedded), `bwip-js` encodes QR and Code128 into module matrices / bar widths (pure JS, no canvas,
 * no headless browser). BOTH codes are drawn as vector rectangles, never as bitmaps, so they stay
 * sharp at any printer resolution and the PDF stays small.
 */

const PT_PER_MM = 72 / 25.4;
const mm = (v: number): number => v * PT_PER_MM;

/** Quiet zone of a QR symbol, in modules, kept inside the QR square (the label's own padding adds more). */
const QR_QUIET_MODULES = 2;
/** Code128 asks for 10 modules of quiet zone on each side; they are kept inside the bar area. */
const CODE128_QUIET_MODULES = 10;
/** Smallest module a Code128 may be printed with (about 6.7 mil): below it handheld scanners struggle. */
export const MIN_CODE128_MODULE_MM = 0.17;
const MIN_FONT_PT = 4.5;
const LINE_SPACING = 1.2;
const GAP_MM = 1.5;

/** A permanent problem with the input: retrying cannot help. */
export class LabelRenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LabelRenderError';
  }
}

export interface LabelItem {
  assetTag: string;
  name: string;
  serial: string | null;
  location: string | null;
  model: string | null;
  /** The opaque public code; the QR encodes `<qrBaseUrl><labelCode>`. */
  labelCode: string;
}

export interface RenderInput {
  template: RenderTemplate;
  /** One entry per printed label, in print order (copies already expanded). */
  labels: readonly LabelItem[];
  /** 1-based slot of the first label on the first page (re-use of a partly used sheet). */
  startPosition: number;
  codes: readonly LabelCode[];
  fields: readonly LabelField[];
  organisation: string;
  /** `https://host/s/`: the QR of a label encodes this plus its `labelCode`. */
  qrBaseUrl: string;
  /** PNG or JPEG bytes (optional). */
  logo?: Buffer | null;
  /** Draw a hairline around each label (calibration on plain paper). */
  outlines?: boolean;
}

export interface RenderResult {
  pdf: Buffer;
  pages: number;
  labels: number;
}

// ----------------------------------------------------------------------------------------- codes

/** The characters Code128 subset B (and the auto-switching encoder) can carry: printable ASCII. */
export const isCode128Text = (text: string): boolean => /^[\x20-\x7e]{1,80}$/.test(text);

/** Bar and space widths (in modules, starting with a bar) of a Code128 symbol, with the stop pattern. */
export function code128Widths(text: string): number[] {
  if (!isCode128Text(text)) {
    throw new LabelRenderError('code128-unsupported', `"${text}" cannot be encoded as Code128.`);
  }
  const symbol = bwipjs.raw('code128', text, {}) as Array<{ sbs: number[] }>;
  const sbs = symbol[0]?.sbs;
  if (!sbs) throw new LabelRenderError('code128-failed', 'Code128 encoding produced nothing.');
  return sbs;
}

export const code128Modules = (text: string): number =>
  code128Widths(text).reduce((a, b) => a + b, 0);

export interface QrMatrix {
  /** Modules per side. */
  size: number;
  /** Row-major, 1 = dark. */
  dark: Uint8Array;
}

/** The QR symbol of `text` (error correction M: 15 % recovery, a good fit for a scuffed label). */
export function qrMatrix(text: string): QrMatrix {
  const symbol = bwipjs.raw('qrcode', text, 'eclevel=M') as Array<{
    pixs: number[];
    pixx: number;
    pixy: number;
  }>;
  const s = symbol[0];
  if (!s || s.pixx !== s.pixy) {
    throw new LabelRenderError('qr-failed', 'QR encoding produced no square symbol.');
  }
  return { size: s.pixx, dark: Uint8Array.from(s.pixs) };
}

// ------------------------------------------------------------------------------------- text

/** Characters Helvetica (WinAnsi) can print; everything else becomes `?`. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (c === 0x09 || c === 0x0a || c === 0x0d) out += ' ';
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) {
      out += ch;
    } else out += '?';
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ----------------------------------------------------------------------------------- layout

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the parts of one label go, in millimetres relative to the label's top-left corner. */
export interface LabelPlan {
  qr: Box | null;
  barcode: Box | null;
  logo: Box | null;
  text: Box;
  /** Width of one Code128 module for a symbol of `modules` modules, or null without a barcode. */
  barcodeModuleMm(modules: number): number | null;
}

/**
 * The layout rule (documented in ADR 0007): padding 6 % of the label height (1 to 2 mm); a QR square on
 * the left (at most 45 % of the width, at most the content height); the right column holds, top to
 * bottom, the optional logo, the text lines and the Code128 bars (at most 34 % of the height). Without
 * a QR the column spans the whole label.
 */
export function planLabel(
  t: Pick<RenderTemplate, 'labelWidthMm' | 'labelHeightMm'>,
  opts: { codes: readonly LabelCode[]; hasLogo: boolean },
): LabelPlan {
  const pad = Math.min(2, Math.max(1, t.labelHeightMm * 0.06));
  const cw = t.labelWidthMm - 2 * pad;
  const ch = t.labelHeightMm - 2 * pad;
  const hasQr = opts.codes.includes('qr');
  const hasBar = opts.codes.includes('code128');

  const qrSide = hasQr ? Math.min(ch, cw * 0.45) : 0;
  const qr: Box | null = hasQr
    ? { x: pad, y: pad + (ch - qrSide) / 2, w: qrSide, h: qrSide }
    : null;
  const colX = pad + (hasQr ? qrSide + GAP_MM : 0);
  const colW = t.labelWidthMm - pad - colX;

  let top = pad;
  let bottom = pad + ch;
  let logo: Box | null = null;
  if (opts.hasLogo) {
    const lh = Math.min(ch * 0.3, 9);
    logo = { x: colX, y: top, w: Math.min(colW * 0.6, lh * 3), h: lh };
    top += lh + 0.8;
  }
  let barcode: Box | null = null;
  if (hasBar) {
    const bh = Math.min(ch * 0.34, 12);
    barcode = { x: colX, y: bottom - bh, w: colW, h: bh };
    bottom -= bh + 0.8;
  }
  const text: Box = { x: colX, y: top, w: colW, h: Math.max(0, bottom - top) };
  return {
    qr,
    barcode,
    logo,
    text,
    barcodeModuleMm: (modules) =>
      barcode ? barcode.w / (modules + 2 * CODE128_QUIET_MODULES) : null,
  };
}

/**
 * Request-time check that every tag fits a readable Code128 in this template: returns the tags that
 * cannot (non printable-ASCII, or modules narrower than {@link MIN_CODE128_MODULE_MM}).
 */
export function unprintableCode128Tags(
  t: Pick<RenderTemplate, 'labelWidthMm' | 'labelHeightMm'>,
  codes: readonly LabelCode[],
  tags: readonly string[],
): string[] {
  if (!codes.includes('code128')) return [];
  const plan = planLabel(t, { codes, hasLogo: false });
  const bad: string[] = [];
  for (const tag of tags) {
    if (!isCode128Text(tag)) {
      bad.push(tag);
      continue;
    }
    const module = plan.barcodeModuleMm(code128Modules(tag));
    if (module === null || module < MIN_CODE128_MODULE_MM) bad.push(tag);
  }
  return bad;
}

// ------------------------------------------------------------------------------------ render

type Doc = InstanceType<typeof PDFDocument>;

function valueOf(item: LabelItem, field: LabelField, organisation: string): string {
  switch (field) {
    case 'asset_tag':
      return item.assetTag;
    case 'name':
      return item.name;
    case 'serial':
      return item.serial ? `S/N ${item.serial}` : '';
    case 'location':
      return item.location ?? '';
    case 'model':
      return item.model ?? '';
    case 'organisation':
      return organisation;
  }
}

/** Largest size (<= `max`) at which `text` fits `width`; when even `MIN_FONT_PT` is too big it is cut with an ellipsis. */
function fitText(
  doc: Doc,
  text: string,
  font: string,
  width: number,
  max: number,
): { text: string; size: number } {
  doc.font(font);
  const unit = doc.fontSize(1).widthOfString(text);
  if (unit === 0) return { text, size: max };
  const size = Math.min(max, width / unit);
  if (size >= MIN_FONT_PT) return { text, size };
  // cut at the minimum size: binary search the longest prefix that fits with an ellipsis
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const w = doc.fontSize(MIN_FONT_PT).widthOfString(`${text.slice(0, mid)}…`);
    if (w <= width) lo = mid;
    else hi = mid - 1;
  }
  return { text: lo > 0 ? `${text.slice(0, lo)}…` : '', size: MIN_FONT_PT };
}

interface TextLine {
  text: string;
  font: string;
  max: number;
}

/** Draws the text lines top-aligned in `box` (points), shrinking sizes to the height and then to the width. */
function drawText(doc: Doc, lines: TextLine[], box: Box): void {
  const wanted = lines.filter((l) => l.text !== '');
  if (wanted.length === 0 || box.w <= 0 || box.h <= 0) return;
  let used = wanted;
  let scale = 1;
  for (;;) {
    const total = used.reduce((s, l) => s + l.max * LINE_SPACING, 0);
    scale = Math.min(1, box.h / total);
    if (used.every((l) => l.max * scale >= MIN_FONT_PT) || used.length === 1) break;
    used = used.slice(0, -1); // the lowest-priority line goes first
  }
  let y = box.y;
  for (const line of used) {
    const fitted = fitText(doc, line.text, line.font, box.w, line.max * scale);
    if (fitted.text === '') continue;
    doc.font(line.font).fontSize(fitted.size).fillColor('#000000');
    doc.text(fitted.text, box.x, y, { lineBreak: false });
    y += fitted.size * LINE_SPACING;
  }
}

/** Draws a QR symbol as one vector path inside `box` (points), quiet zone included. */
function drawQr(doc: Doc, qr: QrMatrix, box: Box): void {
  const module = Math.min(box.w, box.h) / (qr.size + 2 * QR_QUIET_MODULES);
  const side = module * qr.size;
  const ox = box.x + (box.w - side) / 2;
  const oy = box.y + (box.h - side) / 2;
  for (let row = 0; row < qr.size; row++) {
    let col = 0;
    while (col < qr.size) {
      if (qr.dark[row * qr.size + col] !== 1) {
        col++;
        continue;
      }
      const start = col;
      while (col < qr.size && qr.dark[row * qr.size + col] === 1) col++;
      doc.rect(ox + start * module, oy + row * module, (col - start) * module, module);
    }
  }
  doc.fill('#000000');
}

/** Draws the Code128 bars as one vector path in `box` (points), quiet zones included. */
function drawBars(doc: Doc, widths: readonly number[], box: Box): void {
  const modules = widths.reduce((a, b) => a + b, 0);
  const module = box.w / (modules + 2 * CODE128_QUIET_MODULES);
  let x = box.x + CODE128_QUIET_MODULES * module;
  widths.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(x, box.y, w * module, box.h);
    x += w * module;
  });
  doc.fill('#000000');
}

const abs = (origin: { x: number; y: number }, b: Box): Box => ({
  x: origin.x + mm(b.x),
  y: origin.y + mm(b.y),
  w: mm(b.w),
  h: mm(b.h),
});

/** Renders the labels into one PDF. Throws {@link LabelRenderError} for input that can never render. */
export async function renderLabelPdf(input: RenderInput): Promise<RenderResult> {
  const { template: t, labels } = input;
  const per = slotsPerPage(t);
  if (
    !Number.isInteger(input.startPosition) ||
    input.startPosition < 1 ||
    input.startPosition > per
  ) {
    throw new LabelRenderError(
      'bad-start-position',
      `The start position must be between 1 and ${per} for this template.`,
    );
  }
  if (labels.length === 0) throw new LabelRenderError('no-labels', 'There is nothing to print.');
  if (input.codes.length === 0 && input.fields.length === 0) {
    throw new LabelRenderError('empty-label', 'A label needs a code or at least one field.');
  }

  const pageW = mm(t.pageWidthMm);
  const pageH = mm(t.pageHeightMm);
  const pages = pagesNeeded(t, labels.length, input.startPosition);

  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [pageW, pageH],
    margin: 0,
    compress: true,
    info: { Title: 'Asset labels', Producer: 'Asset Tracker', Creator: 'Asset Tracker' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  // pdfkit embeds an image object once however often it is drawn (a Buffer would be embedded per label);
  // `openImage` exists at runtime but not in @types/pdfkit.
  let logo: object | null = null;
  if (input.logo) {
    try {
      logo = (doc as unknown as { openImage(src: Buffer): object }).openImage(input.logo);
    } catch {
      throw new LabelRenderError(
        'logo-invalid',
        'The logo is not a PNG or JPEG image pdfkit can read.',
      );
    }
  }

  const plan = planLabel(t, { codes: input.codes, hasLogo: logo !== null });
  const wantsQr = input.codes.includes('qr');
  const wantsBars = input.codes.includes('code128');

  // Labels run row by row across pages, so a page is opened the moment its first label arrives.
  let page = -1;
  for (let i = 0; i < labels.length; i++) {
    const item = labels[i]!;
    const slot = slotRect(t, input.startPosition - 1 + i);
    while (page < slot.page) {
      doc.addPage({ size: [pageW, pageH], margin: 0 });
      page++;
    }
    const origin = { x: mm(slot.xMm), y: mm(slot.yMm) };

    if (input.outlines) {
      doc
        .save()
        .lineWidth(0.4)
        .dash(2, { space: 2 })
        .strokeColor('#000000')
        .rect(origin.x, origin.y, mm(slot.widthMm), mm(slot.heightMm))
        .stroke()
        .undash()
        .restore();
    }
    if (wantsQr && plan.qr) {
      drawQr(doc, qrMatrix(`${input.qrBaseUrl}${item.labelCode}`), abs(origin, plan.qr));
    }
    if (wantsBars && plan.barcode) {
      const widths = code128Widths(item.assetTag);
      const module = plan.barcodeModuleMm(widths.reduce((a, b) => a + b, 0));
      if (module === null || module < MIN_CODE128_MODULE_MM) {
        throw new LabelRenderError(
          'barcode-too-dense',
          `The tag "${item.assetTag}" is too long for a readable Code128 on this template.`,
        );
      }
      drawBars(doc, widths, abs(origin, plan.barcode));
    }
    if (logo && plan.logo) {
      const box = abs(origin, plan.logo);
      doc.image(logo as never, box.x, box.y, { fit: [box.w, box.h] });
    }
    const lines: TextLine[] = input.fields.map((field, n) => ({
      text: toWinAnsi(valueOf(item, field, input.organisation)),
      font: n === 0 ? 'Helvetica-Bold' : 'Helvetica',
      max: n === 0 ? 11 : 8,
    }));
    drawText(doc, lines, abs(origin, plan.text));

    if (i % 100 === 99) await tick(); // let the worker's timers and pings run on a long batch
  }

  doc.end();
  await finished;
  return { pdf: Buffer.concat(chunks), pages, labels: labels.length };
}
