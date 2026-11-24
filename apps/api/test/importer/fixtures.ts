/**
 * Synthetic importer fixtures (M2-IMP-06, M2-IMP-09 groundwork). No imports: `node fixtures.ts <dir>` writes
 * the static sample files (the founder will later supply a real, anonymised export, F-09).
 *
 * The Google Admin sample follows the columns of the Admin console's "Chrome devices" export as the
 * importer's preset knows them: Serial number, Asset ID, Status, Model, OS version, Platform version,
 * Firmware version, Last sync, User (annotated user), Location (annotated location), Notes, Org unit path,
 * MAC address, Ethernet MAC address, Last known IP address, Device ID, Boot mode, Auto update expiration.
 * Values are made up; the shapes (status words, org unit paths, ISO sync times, upper-case MACs) are not.
 */

export const GOOGLE_HEADERS = [
  'Serial number',
  'Asset ID',
  'Status',
  'Model',
  'OS version',
  'Platform version',
  'Firmware version',
  'Last sync',
  'User',
  'Location',
  'Notes',
  'Org unit path',
  'MAC address',
  'Ethernet MAC address',
  'Last known IP address',
  'Device ID',
  'Boot mode',
  'Auto update expiration',
] as const;

const MODELS = [
  'HP Chromebook 14 G6',
  'Lenovo 300e Chromebook 2nd Gen',
  'Acer Chromebook 311',
  'Dell Chromebook 3100',
];
const OUS = [
  '/Students/Grade 5',
  '/Students/Grade 6',
  '/Students/Grade 7',
  '/Staff',
  '/Staff/Library',
  '/Spare pool',
];
const STATUS = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'PROVISIONED', 'DISABLED', 'DEPROVISIONED'];

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

/** `rows` devices; the same input always gives the same file. */
export function googleRows(rows: number, serialPrefix = '5CD'): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < rows; i++) {
    const status = STATUS[i % STATUS.length]!;
    const ou = OUS[i % OUS.length]!;
    const staff = ou.startsWith('/Staff');
    const user =
      status === 'ACTIVE' && i % 4 !== 3
        ? `${staff ? 'teacher' : 'student'}.${pad(i, 4)}@school.example`
        : '';
    const mac = (k: number) =>
      `3C:E9:F7:${pad((i >> 8) & 255, 2).toUpperCase()}:${(i & 255).toString(16).toUpperCase().padStart(2, '0')}:${k.toString(16).toUpperCase().padStart(2, '0')}`;
    out.push([
      `${serialPrefix}${pad(i, 7)}`,
      i % 3 === 0 ? `CHR-${pad(i + 1, 5)}` : '',
      status,
      MODELS[i % MODELS.length]!,
      `126.0.6478.${100 + (i % 120)}`,
      `15886.${60 + (i % 9)}.0`,
      `Google_Dedede.14505.${400 + (i % 40)}.0`,
      `2026-11-${pad(1 + (i % 24), 2)}T0${i % 9}:${pad(i % 60, 2)}:00.000Z`,
      user,
      i % 5 === 0 ? `Room ${10 + (i % 20)}` : '',
      i % 17 === 0 ? 'Cracked screen, still usable' : '',
      ou,
      mac(1),
      i % 7 === 0 ? mac(2) : '',
      status === 'ACTIVE' ? `10.${20 + (i % 10)}.${(i >> 8) & 255}.${i & 255}` : '',
      `8a1b2c3d-${pad(i, 4)}-4000-8000-${pad(i, 12)}`,
      'Verified',
      `2029-0${1 + (i % 9)}-28`,
    ]);
  }
  return out;
}

const quote = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const toCsv = (rows: string[][]): string =>
  `${rows.map((r) => r.map(quote).join(',')).join('\r\n')}\r\n`;

export const googleCsv = (rows: number, serialPrefix?: string): string =>
  toCsv([[...GOOGLE_HEADERS], ...googleRows(rows, serialPrefix)]);

/** Assets for the volume tests: all columns of the generic asset template, unique serials and no tags. */
export function assetRows(rows: number, prefix = 'SN'): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < rows; i++) {
    out.push([
      '',
      `${prefix}-${pad(i, 7)}`,
      `Device ${i}`,
      `Category ${i % 8}`,
      `Maker ${i % 5}`,
      `Model ${i % 40}`,
      'Ready to deploy',
      `Site ${i % 10} > Building ${i % 4} > Room ${i % 25}`,
      `Department ${i % 12}`,
      `Vendor ${i % 6}`,
      `2024-0${1 + (i % 9)}-1${i % 9}`,
      String(100 + (i % 900)),
      i % 11 === 0 ? 'Needs a new battery' : '',
    ]);
  }
  return out;
}
export const ASSET_HEADERS = [
  'Asset Tag',
  'Serial Number',
  'Name',
  'Category',
  'Manufacturer',
  'Model',
  'Status',
  'Location',
  'Department',
  'Vendor',
  'Purchase Date',
  'Cost',
  'Notes',
];
export const assetCsv = (rows: number, prefix?: string): string =>
  toCsv([ASSET_HEADERS, ...assetRows(rows, prefix)]);

// `node fixtures.ts <dir>` (Node >= 22.18 strips the types itself)
if (process.argv[1]?.endsWith('fixtures.ts') && process.argv[2]) {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = process.argv[2];
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    `${dir}/google-admin-chromeos-sample.csv`,
    String.fromCharCode(0xfeff) + googleCsv(48),
  );
  console.log(`wrote ${dir}/google-admin-chromeos-sample.csv`);
}
