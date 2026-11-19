import { describe, expect, it } from 'vitest';
import {
  type PageRaster,
  decodeRegion,
  openPdf,
  pageSizesMm,
  pageText,
  rasterize,
} from '../../test/support/pdf-decode.js';
import {
  type LabelItem,
  code128Modules,
  code128Widths,
  isCode128Text,
  planLabel,
  qrMatrix,
  renderLabelPdf,
  toWinAnsi,
  unprintableCode128Tags,
} from './render.js';
import { LABEL_TEMPLATES, type RenderTemplate, slotRect, slotsPerPage } from './templates.js';

/**
 * The renderer is judged by what comes OUT of the PDF: the file is parsed and rasterised by pdf.js on a
 * pure-JS canvas and every label is cropped out of the bitmap and decoded with ZXing. A QR that does
 * not decode, a Code128 that does not match the tag, or a label in the wrong slot fails here.
 */

const BASE = 'https://assets.example.test/s/';
const template = (key: string, offset: { x?: number; y?: number } = {}): RenderTemplate => {
  const t = LABEL_TEMPLATES.find((x) => x.key === key)!;
  return { ...t, offsetXMm: offset.x ?? 0, offsetYMm: offset.y ?? 0 };
};

const item = (n: number, extra: Partial<LabelItem> = {}): LabelItem => ({
  assetTag: `AT-${String(n).padStart(5, '0')}`,
  name: `Chromebook ${n}`,
  serial: `SN${n}X`,
  location: `Room ${n}`,
  model: 'Acer 314',
  labelCode: `${n.toString(16).padStart(8, '0')}abcdef0123456789abcdef01`,
  ...extra,
});
const items = (count: number, from = 1): LabelItem[] =>
  Array.from({ length: count }, (_, i) => item(from + i));

const labelRect = (t: RenderTemplate, index: number) => {
  const s = slotRect(t, index);
  return { xMm: s.xMm, yMm: s.yMm, widthMm: s.widthMm, heightMm: s.heightMm };
};

describe('code helpers', () => {
  it('Code128 widths add up to the symbol and only printable ASCII is accepted', () => {
    const widths = code128Widths('AT-00123');
    expect(widths.length % 2).toBe(1); // bar, space, ..., bar
    expect(code128Modules('AT-00123')).toBe(widths.reduce((a, b) => a + b, 0));
    expect(isCode128Text('AT-00123')).toBe(true);
    expect(isCode128Text('Tagé')).toBe(false);
    expect(isCode128Text('')).toBe(false);
    expect(() => code128Widths('Tagé')).toThrow(/cannot be encoded/);
  });

  it('the QR matrix is square with the finder patterns in three corners', () => {
    const qr = qrMatrix(`${BASE}0123456789abcdef0123456789abcdef`);
    expect(qr.dark.length).toBe(qr.size * qr.size);
    const at = (r: number, c: number) => qr.dark[r * qr.size + c];
    for (const [r, c] of [
      [0, 0],
      [0, qr.size - 1],
      [qr.size - 1, 0],
    ] as const) {
      expect(at(r, c)).toBe(1);
    }
    expect(at(qr.size - 1, qr.size - 1)).toBe(0);
  });

  it('text is reduced to what Helvetica (WinAnsi) can print', () => {
    expect(toWinAnsi('Café “X” €5')).toBe('Café “X” €5');
    expect(toWinAnsi('中文 laptop')).toBe('?? laptop');
    expect(toWinAnsi('a\tb\nc')).toBe('a b c');
    expect(toWinAnsi('  \u0007 ')).toBe('?');
  });
});

describe('template geometry', () => {
  it('every fixed template fits its page and snapshot-compares', () => {
    for (const t of LABEL_TEMPLATES) {
      const right = t.marginLeftMm + t.cols * t.labelWidthMm + (t.cols - 1) * t.gapXMm;
      const bottom = t.marginTopMm + t.rows * t.labelHeightMm + (t.rows - 1) * t.gapYMm;
      expect(right, t.key).toBeLessThanOrEqual(t.pageWidthMm + 0.05);
      expect(bottom, t.key).toBeLessThanOrEqual(t.pageHeightMm + 0.05);
    }
    const summary = LABEL_TEMPLATES.map(
      (t) =>
        `${t.key} ${t.pageSize} ${t.pageWidthMm}x${t.pageHeightMm} label ${t.labelWidthMm}x${t.labelHeightMm} ` +
        `${t.cols}x${t.rows} top ${t.marginTopMm} left ${t.marginLeftMm} gap ${t.gapXMm}/${t.gapYMm} ` +
        `${t.codeType} [${t.fields.join(',')}]`,
    );
    expect(summary).toEqual([
      'letter-30up-qr letter 215.9x279.4 label 66.68x25.4 3x10 top 12.7 left 4.76 gap 3.18/0 qr [asset_tag,name]',
      'a4-21up-qr a4 210x297 label 63.5x38.1 3x7 top 15.15 left 7.21 gap 2.54/0 qr [asset_tag,name]',
      'a4-24up-qr a4 210x297 label 63.5x33.9 3x8 top 12.9 left 7.21 gap 2.54/0 qr [asset_tag,name]',
      'letter-10up-qr letter 215.9x279.4 label 101.6x50.8 2x5 top 12.7 left 3.97 gap 4.76/0 qr_and_code128 [asset_tag,name,serial]',
      'single-50x25-qr custom 50x25 label 50x25 1x1 top 0 left 0 gap 0/0 qr [asset_tag]',
      'thermal-2x1in-qr custom 50.8x25.4 label 50.8x25.4 1x1 top 0 left 0 gap 0/0 qr_and_code128 [asset_tag,name]',
    ]);
    expect(LABEL_TEMPLATES.map((t) => slotsPerPage(t))).toEqual([30, 21, 24, 10, 1, 1]);
  });

  it('slots run row by row, left to right, and the calibration offset moves the whole sheet', () => {
    const t = template('letter-30up-qr');
    expect(slotRect(t, 0)).toMatchObject({ page: 0, row: 0, col: 0, xMm: 4.76, yMm: 12.7 });
    expect(slotRect(t, 2)).toMatchObject({ row: 0, col: 2 });
    expect(slotRect(t, 3)).toMatchObject({ row: 1, col: 0 });
    expect(slotRect(t, 30)).toMatchObject({ page: 1, row: 0, col: 0 });
    const shifted = template('letter-30up-qr', { x: 1.5, y: -0.5 });
    expect(slotRect(shifted, 4).xMm - slotRect(t, 4).xMm).toBeCloseTo(1.5, 5);
    expect(slotRect(shifted, 4).yMm - slotRect(t, 4).yMm).toBeCloseTo(-0.5, 5);
  });

  it('flags tags that cannot be a readable Code128', () => {
    const thermal = template('single-50x25-qr');
    expect(unprintableCode128Tags(thermal, ['qr'], ['anything-at-all-' + 'x'.repeat(60)])).toEqual(
      [],
    );
    expect(
      unprintableCode128Tags(
        thermal,
        ['qr', 'code128'],
        ['AT-00123', 'LONG-' + 'X'.repeat(40), 'Té'],
      ),
    ).toEqual(['LONG-' + 'X'.repeat(40), 'Té']);
    const wide = template('letter-10up-qr');
    expect(unprintableCode128Tags(wide, ['code128'], ['LONG-' + 'X'.repeat(40)])).toEqual([]);
  });
});

describe('rendered PDF, decoded', () => {
  it('single-label page: the QR decodes to the label URL and the page has the template size', async () => {
    const t = template('single-50x25-qr');
    const a = item(7);
    const { pdf, pages, labels } = await renderLabelPdf({
      template: t,
      labels: [a],
      startPosition: 1,
      codes: ['qr'],
      fields: ['asset_tag'],
      organisation: 'Acme',
      qrBaseUrl: BASE,
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect({ pages, labels }).toEqual({ pages: 1, labels: 1 });
    const doc = await openPdf(pdf);
    const [size] = await pageSizesMm(doc);
    expect(size!.widthMm).toBeCloseTo(50, 1);
    expect(size!.heightMm).toBeCloseTo(25, 1);
    const raster = await rasterize(doc, 1);
    expect(decodeRegion(raster, labelRect(t, 0), 'QR_CODE')).toBe(`${BASE}${a.labelCode}`);
    const text = await pageText(doc, 1);
    expect(text.map((x) => x.str)).toEqual([a.assetTag]);
  });

  it('start position on a partly used sheet: the used slots stay empty and the labels run on to page 2', async () => {
    const t = template('letter-30up-qr');
    const batch = items(30);
    const start = 7;
    const { pdf, pages } = await renderLabelPdf({
      template: t,
      labels: batch,
      startPosition: start,
      codes: ['qr'],
      fields: ['asset_tag', 'name'],
      organisation: 'Acme',
      qrBaseUrl: BASE,
    });
    expect(pages).toBe(2); // slots 7..30 on page 1 (24 labels), 6 more on page 2
    const doc = await openPdf(pdf);
    expect(doc.numPages).toBe(2);
    const rasters: PageRaster[] = [await rasterize(doc, 1), await rasterize(doc, 2)];

    // slots 1..6 of page 1 are untouched (nothing drawn inside them)
    for (let s = 0; s < start - 1; s++) {
      expect(rasters[0]!.darkPixels(labelRect(t, s)), `slot ${s + 1} must be blank`).toBe(0);
    }
    // every label sits in the slot start + n and decodes to ITS code
    for (let n = 0; n < batch.length; n++) {
      const index = start - 1 + n;
      const slot = slotRect(t, index);
      const decoded = decodeRegion(rasters[slot.page]!, labelRect(t, index), 'QR_CODE');
      expect(decoded, `label ${n + 1} in slot ${index + 1}`).toBe(`${BASE}${batch[n]!.labelCode}`);
    }
    // the rest of page 2 is blank
    for (let s = 6; s < 30; s++) {
      expect(rasters[1]!.darkPixels(labelRect(t, 30 + s))).toBe(0);
    }
    // the tag text is printed inside its own slot (first line, bold)
    const text1 = await pageText(doc, 1);
    for (let n = 0; n < 24; n++) {
      const slot = slotRect(t, start - 1 + n);
      const tag = text1.find((x) => x.str === batch[n]!.assetTag);
      expect(tag, batch[n]!.assetTag).toBeDefined();
      expect(tag!.xMm).toBeGreaterThan(slot.xMm);
      expect(tag!.xMm).toBeLessThan(slot.xMm + slot.widthMm);
      expect(tag!.yMm).toBeGreaterThan(slot.yMm);
      expect(tag!.yMm).toBeLessThan(slot.yMm + slot.heightMm);
    }
    // the slot of label 25 is the first of page 2
    const text2 = await pageText(doc, 2);
    const first = text2.find((x) => x.str === batch[24]!.assetTag)!;
    const s0 = slotRect(t, 0);
    expect(first.xMm).toBeGreaterThan(s0.xMm);
    expect(first.yMm).toBeLessThan(s0.yMm + s0.heightMm);
  });

  it('QR and Code128 on the same label both decode, and match the asset', async () => {
    for (const key of ['letter-10up-qr', 'thermal-2x1in-qr']) {
      const t = template(key);
      const batch = items(3, 118);
      const { pdf } = await renderLabelPdf({
        template: t,
        labels: batch,
        startPosition: 1,
        codes: ['qr', 'code128'],
        fields: ['asset_tag', 'name', 'serial'],
        organisation: 'Acme',
        qrBaseUrl: BASE,
      });
      const doc = await openPdf(pdf);
      const raster = await rasterize(doc, 1);
      const first = batch.slice(0, slotsPerPage(t));
      for (let n = 0; n < first.length; n++) {
        const rect = labelRect(t, n);
        expect(decodeRegion(raster, rect, 'QR_CODE'), `${key} QR ${n}`).toBe(
          `${BASE}${first[n]!.labelCode}`,
        );
        expect(decodeRegion(raster, rect, 'CODE_128'), `${key} Code128 ${n}`).toBe(
          first[n]!.assetTag,
        );
      }
    }
  });

  it('Code128 alone decodes to the tag on every sheet template', async () => {
    for (const t0 of LABEL_TEMPLATES) {
      const t = template(t0.key);
      const batch = items(Math.min(4, slotsPerPage(t)), 9000);
      const { pdf } = await renderLabelPdf({
        template: t,
        labels: batch,
        startPosition: 1,
        codes: ['code128'],
        fields: ['asset_tag'],
        organisation: 'Acme',
        qrBaseUrl: BASE,
      });
      const raster = await rasterize(await openPdf(pdf), 1);
      for (let n = 0; n < batch.length; n++) {
        expect(decodeRegion(raster, labelRect(t, n), 'CODE_128'), `${t.key} ${n}`).toBe(
          batch[n]!.assetTag,
        );
      }
    }
  });

  it('every template renders QR labels that decode (all slots of a full first page)', async () => {
    for (const t0 of LABEL_TEMPLATES) {
      const t = template(t0.key);
      const per = slotsPerPage(t);
      const batch = items(per, 500);
      const { pdf } = await renderLabelPdf({
        template: t,
        labels: batch,
        startPosition: 1,
        codes: ['qr'],
        fields: ['asset_tag', 'name'],
        organisation: 'Acme',
        qrBaseUrl: BASE,
      });
      const raster = await rasterize(await openPdf(pdf), 1);
      let decoded = 0;
      for (let n = 0; n < per; n++) {
        if (decodeRegion(raster, labelRect(t, n), 'QR_CODE') === `${BASE}${batch[n]!.labelCode}`)
          decoded++;
      }
      expect(decoded, t.key).toBe(per);
    }
  });

  it('the calibration offset shifts the drawing by exactly that much', async () => {
    const plain = template('letter-30up-qr');
    const shifted = template('letter-30up-qr', { x: 2, y: 1 });
    const input = {
      labels: items(1),
      startPosition: 1,
      codes: ['qr'] as const,
      fields: ['asset_tag'] as const,
      organisation: 'Acme',
      qrBaseUrl: BASE,
    };
    const a = await pageText(
      await openPdf((await renderLabelPdf({ ...input, template: plain })).pdf),
      1,
    );
    const b = await pageText(
      await openPdf((await renderLabelPdf({ ...input, template: shifted })).pdf),
      1,
    );
    expect(b[0]!.xMm - a[0]!.xMm).toBeCloseTo(2, 1);
    expect(b[0]!.yMm - a[0]!.yMm).toBeCloseTo(1, 1);
    // and the shifted QR is still decodable inside the shifted slot
    const raster = await rasterize(
      await openPdf((await renderLabelPdf({ ...input, template: shifted })).pdf),
      1,
    );
    expect(decodeRegion(raster, labelRect(shifted, 0), 'QR_CODE')).toBe(
      `${BASE}${input.labels[0]!.labelCode}`,
    );
  });

  it('long text shrinks to fit and finally ends with an ellipsis; nothing leaves the label', async () => {
    const t = template('letter-30up-qr');
    const long = item(1, {
      name: 'A very long asset name that cannot possibly fit on one line of a label '.repeat(4),
    });
    const { pdf } = await renderLabelPdf({
      template: t,
      labels: [long],
      startPosition: 1,
      codes: ['qr'],
      fields: ['asset_tag', 'name', 'serial', 'location', 'organisation'],
      organisation: 'Acme School District',
      qrBaseUrl: BASE,
    });
    const doc = await openPdf(pdf);
    const text = await pageText(doc, 1);
    const slot = slotRect(t, 0);
    for (const run of text) {
      expect(run.fontSizePt, run.str).toBeGreaterThanOrEqual(4.4);
      expect(run.yMm, run.str).toBeLessThanOrEqual(slot.yMm + slot.heightMm);
      expect(run.xMm, run.str).toBeLessThan(slot.xMm + slot.widthMm);
    }
    expect(text.some((x) => x.str.endsWith('…'))).toBe(true);
    // the tag line stays the biggest
    const tag = text.find((x) => x.str === long.assetTag)!;
    expect(Math.max(...text.map((x) => x.fontSizePt))).toBeCloseTo(tag.fontSizePt, 3);
    // the QR is still readable with that much text next to it
    const raster = await rasterize(doc, 1);
    expect(decodeRegion(raster, labelRect(t, 0), 'QR_CODE')).toBe(`${BASE}${long.labelCode}`);
  });

  it('the optional logo is drawn and the code stays readable; outlines mark the slots', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const c = createCanvas(120, 40);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#c00000';
    ctx.fillRect(0, 0, 120, 40);
    const logo = c.toBuffer('image/png');
    const t = template('a4-21up-qr');
    const a = item(3);
    const withLogo = await renderLabelPdf({
      template: t,
      labels: [a],
      startPosition: 1,
      codes: ['qr'],
      fields: ['asset_tag', 'name'],
      organisation: 'Acme',
      qrBaseUrl: BASE,
      logo,
      outlines: true,
    });
    const without = await renderLabelPdf({
      template: t,
      labels: [a],
      startPosition: 1,
      codes: ['qr'],
      fields: ['asset_tag', 'name'],
      organisation: 'Acme',
      qrBaseUrl: BASE,
    });
    expect(withLogo.pdf.length).toBeGreaterThan(without.pdf.length);
    const doc = await openPdf(withLogo.pdf);
    const raster = await rasterize(doc, 1);
    expect(decodeRegion(raster, labelRect(t, 0), 'QR_CODE')).toBe(`${BASE}${a.labelCode}`);
    // the outline of the slot is on the page (dark pixels along its top edge)
    const s = slotRect(t, 0);
    expect(
      raster.darkPixels({ xMm: s.xMm, yMm: s.yMm - 0.3, widthMm: s.widthMm, heightMm: 0.6 }),
    ).toBeGreaterThan(50);
  });

  it('refuses input that can never render', async () => {
    const t = template('letter-30up-qr');
    const base = {
      template: t,
      labels: items(1),
      codes: ['qr'] as const,
      fields: ['asset_tag'] as const,
      organisation: 'A',
      qrBaseUrl: BASE,
    };
    await expect(renderLabelPdf({ ...base, startPosition: 31 })).rejects.toMatchObject({
      code: 'bad-start-position',
    });
    await expect(renderLabelPdf({ ...base, startPosition: 0 })).rejects.toMatchObject({
      code: 'bad-start-position',
    });
    await expect(renderLabelPdf({ ...base, startPosition: 1, labels: [] })).rejects.toMatchObject({
      code: 'no-labels',
    });
    await expect(
      renderLabelPdf({ ...base, startPosition: 1, codes: [], fields: [] }),
    ).rejects.toMatchObject({ code: 'empty-label' });
    await expect(
      renderLabelPdf({
        ...base,
        startPosition: 1,
        codes: ['code128'],
        labels: [item(1, { assetTag: 'Té' })],
      }),
    ).rejects.toMatchObject({ code: 'code128-unsupported' });
    await expect(
      renderLabelPdf({ ...base, startPosition: 1, logo: Buffer.from('not an image') }),
    ).rejects.toMatchObject({ code: 'logo-invalid' });
  });

  it('plans: the QR square never exceeds the label, the barcode sits below the text', () => {
    for (const t of LABEL_TEMPLATES) {
      for (const codes of [['qr'], ['code128'], ['qr', 'code128']] as const) {
        const plan = planLabel(t, { codes, hasLogo: false });
        if (plan.qr) {
          expect(plan.qr.x + plan.qr.w).toBeLessThanOrEqual(t.labelWidthMm);
          expect(plan.qr.y + plan.qr.h).toBeLessThanOrEqual(t.labelHeightMm);
        }
        if (plan.barcode) expect(plan.text.y + plan.text.h).toBeLessThanOrEqual(plan.barcode.y);
      }
    }
  });
});
