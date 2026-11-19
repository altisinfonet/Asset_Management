import { crc32 } from 'node:zlib';
import sharp from 'sharp';

/** Real (tiny) files for the upload tests: images by sharp, PDF/CSV by hand, OOXML/ODF as stored zips. */

export async function png(width = 40, height = 30): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

export async function jpeg(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

/** A JPEG carrying EXIF with a camera make, a copyright, GPS coordinates and orientation 6 (rotated). */
export async function jpegWithExif(width = 64, height = 48): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 200, b: 90 } },
  })
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Make: 'ACME CAMERA', Copyright: 'secret-copyright' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '40/1 26/1 46/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '79/1 58/1 56/1',
        },
      },
    })
    .jpeg()
    .toBuffer();
}

export async function webp(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: '#336699' } })
    .webp()
    .toBuffer();
}

export const pdf = (): Buffer =>
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

export const csv = (): Buffer => Buffer.from('tag,name\nLAP-00001,Laptop\nLAP-00002,Dock\n');

export const svg = (): Buffer =>
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>',
  );

export const html = (): Buffer => Buffer.from('<!doctype html><html><script>alert(1)</script>');

/** A minimal Windows executable header (MZ). */
export const exe = (): Buffer => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);

/** A stored (uncompressed) zip with the given entries: what an OOXML / ODF container looks like to a sniffer. */
export function zip(entries: Array<{ name: string; data: string | Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(body.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

export const docx = (): Buffer =>
  zip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    { name: '_rels/.rels', data: '<Relationships/>' },
    { name: 'word/document.xml', data: '<w:document/>' },
  ]);

export const xlsx = (): Buffer =>
  zip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    },
    { name: '_rels/.rels', data: '<Relationships/>' },
    { name: 'xl/workbook.xml', data: '<workbook/>' },
  ]);

/** A plain zip archive (not an office file). */
export const plainZip = (): Buffer => zip([{ name: 'readme.txt', data: 'hello' }]);

export const sha256Hex = async (data: Buffer): Promise<string> =>
  (await import('node:crypto')).createHash('sha256').update(data).digest('hex');
