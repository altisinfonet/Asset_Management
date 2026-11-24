/**
 * What the mock import worker knows about files and fields: a small CSV reader (BOM, quotes, quoted
 * newlines, delimiter sniffing), the target fields of every entity and the column-name synonyms
 * behind the suggestions. Mock-only; the real API does this in `apps/api` (M2-IMP-02/03).
 */

/** The byte order mark Excel puts in front of a UTF-8 file (built from its code so no invisible character sits in the source). */
const BOM = String.fromCharCode(0xfeff);

export interface ParsedCsv {
  delimiter: string;
  headers: string[];
  rows: string[][];
}

const DELIMITERS = [',', ';', '\t', '|'];

export function sniffDelimiter(firstLine: string): string {
  let best = ',';
  let count = -1;
  for (const delimiter of DELIMITERS) {
    const n = firstLine.split(delimiter).length - 1;
    if (n > count) {
      best = delimiter;
      count = n;
    }
  }
  return best;
}

/** Parses delimited text; throws a sentence with the line number for text that is not valid CSV. */
export function parseCsv(input: string, forced?: string): ParsedCsv {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = forced ?? sniffDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let quoteLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
      quoteLine = line;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
      line += 1;
    } else cell += char;
  }
  if (quoted) {
    throw new Error(
      `Line ${quoteLine}: a quoted value is never closed. Check the quotes and try again.`,
    );
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  while (records.length > 0 && records[records.length - 1]!.every((c) => c.trim() === '')) {
    records.pop();
  }
  const headers = (records.shift() ?? []).map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw new Error('Line 1: the file has no header row.');
  }
  return { delimiter, headers, rows: records };
}

export type TargetType = 'text' | 'number' | 'date' | 'boolean' | 'money' | 'enum' | 'reference';
export type ReferenceKind =
  | 'category'
  | 'manufacturer'
  | 'asset_model'
  | 'location'
  | 'person'
  | 'department'
  | 'vendor'
  | 'status_label';

export interface TargetSpec {
  key: string;
  label: string;
  required: boolean;
  type: TargetType;
  reference?: ReferenceKind;
  /** Header spellings (normalised) the suggestion recognises. */
  synonyms: string[];
}

const f = (
  key: string,
  label: string,
  type: TargetType,
  synonyms: string[],
  options: { required?: boolean; reference?: ReferenceKind } = {},
): TargetSpec => ({
  key,
  label,
  type,
  synonyms,
  required: options.required ?? false,
  reference: options.reference,
});

export const TARGETS: Record<string, TargetSpec[]> = {
  asset: [
    f('asset_tag', 'Asset tag', 'text', [
      'assettag',
      'tag',
      'assetid',
      'assetnumber',
      'inventorynumber',
    ]),
    f('serial', 'Serial number', 'text', [
      'serial',
      'serialnumber',
      'serialno',
      'sn',
      'servicetag',
    ]),
    f('name', 'Name', 'text', ['name', 'devicename', 'description']),
    f('category', 'Category', 'reference', ['category', 'type', 'devicetype'], {
      reference: 'category',
    }),
    f('manufacturer', 'Manufacturer', 'reference', ['manufacturer', 'make', 'brand'], {
      reference: 'manufacturer',
    }),
    f('model', 'Model', 'reference', ['model', 'modelname'], { reference: 'asset_model' }),
    f('status_label', 'Status', 'reference', ['status', 'state'], { reference: 'status_label' }),
    f('location', 'Location', 'reference', ['location', 'room', 'orgunit', 'orgunitpath', 'site'], {
      reference: 'location',
    }),
    f('department', 'Department', 'reference', ['department', 'dept'], { reference: 'department' }),
    f(
      'assignee',
      'Assigned to',
      'reference',
      ['assignedto', 'annotateduser', 'user', 'owner', 'borrower'],
      { reference: 'person' },
    ),
    f('vendor', 'Supplier', 'reference', ['vendor', 'supplier'], { reference: 'vendor' }),
    f('purchase_date', 'Purchase date', 'date', ['purchasedate', 'purchased', 'dateofpurchase']),
    f('purchase_cost', 'Purchase cost', 'money', ['purchasecost', 'cost', 'price']),
    f('order_number', 'Order number', 'text', ['ordernumber', 'po', 'ponumber']),
    f('warranty_end', 'Warranty ends', 'date', ['warrantyend', 'warrantyexpiry', 'warranty']),
    f('notes', 'Notes', 'text', ['notes', 'note', 'comments', 'annotatednotes']),
  ],
  person: [
    f('display_name', 'Name', 'text', ['name', 'displayname', 'fullname', 'person'], {
      required: true,
    }),
    f('email', 'Email', 'text', ['email', 'emailaddress', 'mail']),
    f('employee_ref', 'Employee or student number', 'text', [
      'employeeref',
      'employeenumber',
      'studentnumber',
      'studentid',
      'staffid',
    ]),
    f('kind', 'Kind', 'enum', ['kind', 'role', 'persontype']),
    f('department', 'Department', 'reference', ['department', 'dept'], { reference: 'department' }),
    f('job_title', 'Job title', 'text', ['jobtitle', 'title', 'position']),
    f('phone', 'Phone', 'text', ['phone', 'telephone', 'mobile']),
    f('location', 'Location', 'reference', ['location', 'room', 'site'], { reference: 'location' }),
  ],
  location: [
    f('name', 'Name', 'text', ['name', 'location', 'room'], { required: true }),
    f('parent', 'Parent location', 'reference', ['parent', 'parentlocation', 'within'], {
      reference: 'location',
    }),
    f('kind', 'Kind', 'enum', ['kind', 'type']),
    f('code', 'Code', 'text', ['code', 'roomnumber']),
  ],
  department: [
    f('name', 'Name', 'text', ['name', 'department'], { required: true }),
    f('code', 'Code', 'text', ['code', 'costcentre', 'costcenter']),
    f('description', 'Description', 'text', ['description']),
    f('manager', 'Manager', 'reference', ['manager', 'head'], { reference: 'person' }),
  ],
};

/** Google Admin ChromeOS device export headers and the field each one fills. */
export const GOOGLE_ADMIN_COLUMNS: Record<string, string> = {
  'Serial Number': 'serial',
  'Asset ID': 'asset_tag',
  Model: 'model',
  'Annotated User': 'assignee',
  'Annotated Location': 'location',
  'Org Unit': 'location',
  Status: 'status_label',
  'Annotated Asset ID': 'asset_tag',
  Notes: 'notes',
};

export const normaliseHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, '');

export function suggestField(
  entity: string,
  header: string,
  source: string,
  taken: Set<string>,
  custom: Array<{ key: string; label: string }> = [],
): string | null {
  if (source === 'google_admin_csv') {
    const exact = GOOGLE_ADMIN_COLUMNS[header];
    if (exact && !taken.has(exact)) return exact;
  }
  const wanted = normaliseHeader(header);
  const hit = (TARGETS[entity] ?? []).find((t) => t.synonyms.includes(wanted) && !taken.has(t.key));
  if (hit) return hit.key;
  const field = custom.find(
    (c) => normaliseHeader(c.label) === wanted || normaliseHeader(c.key) === wanted,
  );
  return field ? `custom_data.${field.key}` : null;
}

export function detectType(values: string[]): 'text' | 'number' | 'date' | 'boolean' {
  const filled = values.filter((v) => v.trim() !== '');
  if (filled.length === 0) return 'text';
  if (filled.every((v) => /^(true|false|yes|no)$/i.test(v.trim()))) return 'boolean';
  if (filled.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))) return 'number';
  if (filled.every((v) => /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(v.trim()))) {
    return 'date';
  }
  return 'text';
}

/** CSV text with every cell quoted when it needs it (the error report and the templates). */
export function toCsv(rows: string[][]): string {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return `${BOM}${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
