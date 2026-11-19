import { createCanvas } from '@napi-rs/canvas';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import jsQR from 'jsqr';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// jsqr ships CommonJS typings (`export default`) that NodeNext cannot call; at run time it is the function.
const decodeQr = jsQR as unknown as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

/**
 * Test-side PDF reader for the label renderer: it takes the finished PDF the way a person or a
 * printer would. Text and positions come from pdf.js, the page is RASTERISED with pdf.js on a pure
 * canvas (@napi-rs/canvas, prebuilt binaries), and every label is cropped out of the bitmap and decoded
 * with jsQR (QR) and ZXing (Code128). Nothing here knows how the renderer drew the codes.
 */

export interface TextItem {
  str: string;
  /** Millimetres from the top-left corner of the page (baseline origin). */
  xMm: number;
  yMm: number;
  fontSizePt: number;
}

export interface PageRaster {
  widthPx: number;
  heightPx: number;
  dpi: number;
  /** Grayscale (0 = black, 255 = white), row-major. */
  gray: Uint8Array;
  /** Rows x columns of pixels set to 1 when darker than mid-gray inside the mm rectangle. */
  darkPixels(rect: Rect): number;
}

export interface Rect {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

const MM_PER_PT = 25.4 / 72;

export async function openPdf(data: Buffer) {
  return getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
}

export type PdfDoc = Awaited<ReturnType<typeof openPdf>>;

export async function pageSizesMm(
  doc: PdfDoc,
): Promise<Array<{ widthMm: number; heightMm: number }>> {
  const sizes = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    sizes.push({ widthMm: (x1 - x0) * MM_PER_PT, heightMm: (y1 - y0) * MM_PER_PT });
  }
  return sizes;
}

/** Every text run of a page with its position in mm from the top-left corner. */
export async function pageText(doc: PdfDoc, pageNumber: number): Promise<TextItem[]> {
  const page = await doc.getPage(pageNumber);
  const height = page.view[3]! - page.view[1]!;
  const content = await page.getTextContent();
  const items: TextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue;
    const [a, , , d, e, f] = item.transform as number[];
    items.push({
      str: item.str,
      xMm: e! * MM_PER_PT,
      yMm: (height - f!) * MM_PER_PT,
      fontSizePt: Math.hypot(a!, d!),
    });
  }
  return items;
}

/** Rasterises page `pageNumber` at `dpi` on a white background. */
export async function rasterize(doc: PdfDoc, pageNumber: number, dpi = 300): Promise<PageRaster> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: dpi / 72 });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  await page.render({
    canvas: canvas as never,
    canvasContext: ctx as never,
    viewport,
    background: 'rgb(255,255,255)',
  }).promise;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(
      0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!,
    );
  }
  const pxPerMm = dpi / 25.4;
  return {
    widthPx: width,
    heightPx: height,
    dpi,
    gray,
    darkPixels(rect) {
      const x0 = Math.max(0, Math.floor(rect.xMm * pxPerMm));
      const y0 = Math.max(0, Math.floor(rect.yMm * pxPerMm));
      const x1 = Math.min(width, Math.ceil((rect.xMm + rect.widthMm) * pxPerMm));
      const y1 = Math.min(height, Math.ceil((rect.yMm + rect.heightMm) * pxPerMm));
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) if (gray[y * width + x]! < 128) n++;
      }
      return n;
    },
  };
}

/** Decodes one barcode format from a rectangle of the raster; `null` when nothing decodes. */
export function decodeRegion(
  raster: PageRaster,
  rect: Rect,
  format: 'QR_CODE' | 'CODE_128',
): string | null {
  const pxPerMm = raster.dpi / 25.4;
  const x0 = Math.max(0, Math.floor(rect.xMm * pxPerMm));
  const y0 = Math.max(0, Math.floor(rect.yMm * pxPerMm));
  const w = Math.min(raster.widthPx - x0, Math.ceil(rect.widthMm * pxPerMm));
  const h = Math.min(raster.heightPx - y0, Math.ceil(rect.heightMm * pxPerMm));
  const crop = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) crop[y * w + x] = raster.gray[(y0 + y) * raster.widthPx + x0 + x]!;
  }
  if (format === 'QR_CODE') {
    // jsQR: ZXing-js fails to decode about 1 in 10 perfectly valid QR symbols (measured against two
    // independent encoders, bwip-js and node-qrcode, 200 random label URLs: ZXing 184 and 181, jsQR 200
    // and 200), so it cannot be the judge of QR content. ZXing remains the Code128 reader.
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < crop.length; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = crop[i]!;
      rgba[i * 4 + 3] = 255;
    }
    return decodeQr(rgba, w, h)?.data ?? null;
  }
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try {
    const source = new RGBLuminanceSource(crop, w, h);
    return reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source))).getText();
  } catch {
    return null;
  }
}
