import { looseKey } from './values.js';

/**
 * The target fields of each importable entity (M2-IMP-03, M2-IMP-07): what a column can be mapped to,
 * how a cell is read, and the header synonyms the heuristic suggestion uses. This table is also the data
 * dictionary of the downloadable templates and of `GET /v1/imports/presets`.
 */

export const ENTITY_TYPES = ['asset', 'person', 'location', 'department'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export type FieldKind =
  | 'text'
  | 'long_text'
  | 'email'
  | 'integer'
  | 'number'
  | 'date'
  | 'money'
  | 'enum'
  | 'ref'
  | 'path';

/** Reference data a cell can name. */
export type RefKind =
  | 'category'
  | 'manufacturer'
  | 'model'
  | 'status'
  | 'location'
  | 'department'
  | 'vendor'
  | 'person';
export const REF_KINDS: readonly RefKind[] = [
  'category',
  'manufacturer',
  'model',
  'status',
  'location',
  'department',
  'vendor',
  'person',
];

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  description: string;
  example: string;
  /** Header names (any case or punctuation) that suggest this field. */
  synonyms: readonly string[];
  ref?: RefKind;
  values?: readonly string[];
  /** The row cannot be created without it (unless a default covers it). */
  required?: boolean;
}

const f = (spec: FieldSpec): FieldSpec => spec;

const ASSET_FIELDS: FieldSpec[] = [
  f({
    key: 'asset_tag',
    label: 'Asset tag',
    kind: 'text',
    description:
      'The tag printed on the label. Left empty, the next tag of the numbering template is used. Never changed by an import.',
    example: 'LAP-00042',
    synonyms: [
      'asset tag',
      'tag',
      'tag no',
      'tag number',
      'asset id',
      'assetid',
      'asset number',
      'asset no',
      'inventory number',
      'inventory no',
      'asset_tag',
      'annotated asset id',
      'asset identifier',
      'barcode',
    ],
  }),
  f({
    key: 'name',
    label: 'Name',
    kind: 'text',
    description: 'A display name for the asset.',
    example: "Anna's laptop",
    synonyms: [
      'name',
      'asset name',
      'device name',
      'hostname',
      'computer name',
      'description',
      'title',
      'item',
      'item name',
      'item description',
    ],
  }),
  f({
    key: 'serial',
    label: 'Serial number',
    kind: 'text',
    description: 'The manufacturer serial number. Used to find existing assets when re-importing.',
    example: 'C02XK0ABJGH5',
    synonyms: [
      'serial',
      'serial number',
      'serial no',
      'serial_no',
      's/n',
      'sn',
      'service tag',
      'servicetag',
      'serialnumber',
      'device serial number',
    ],
  }),
  f({
    key: 'category',
    label: 'Category',
    kind: 'ref',
    ref: 'category',
    required: true,
    description:
      'The asset category (must be an asset category). Created when missing if the import allows it.',
    example: 'Laptops',
    synonyms: ['category', 'type', 'asset type', 'device type', 'class', 'asset category', 'kind'],
  }),
  f({
    key: 'manufacturer',
    label: 'Manufacturer',
    kind: 'ref',
    ref: 'manufacturer',
    description: 'The manufacturer; with the model it identifies the model.',
    example: 'Dell',
    synonyms: ['manufacturer', 'make', 'brand', 'vendor name', 'oem'],
  }),
  f({
    key: 'model',
    label: 'Model',
    kind: 'ref',
    ref: 'model',
    description: 'The model name, within the category (and manufacturer, when given).',
    example: 'Latitude 5440',
    synonyms: [
      'model',
      'model name',
      'device model',
      'product',
      'product name',
      'model no',
      'model number',
    ],
  }),
  f({
    key: 'status',
    label: 'Status',
    kind: 'ref',
    ref: 'status',
    description:
      'A status label. Map the names of the file to your labels on the value mapping step.',
    example: 'Ready to deploy',
    synonyms: ['status', 'state', 'asset status', 'device status', 'condition', 'lifecycle'],
  }),
  f({
    key: 'location',
    label: 'Location',
    kind: 'path',
    ref: 'location',
    description: 'A location, or a path such as "HQ > Building 2 > Room 14".',
    example: 'HQ > Building 2 > Room 14',
    synonyms: [
      'location',
      'site',
      'room',
      'building',
      'place',
      'location path',
      'org unit path',
      'annotated location',
      'where',
    ],
  }),
  f({
    key: 'department',
    label: 'Department',
    kind: 'ref',
    ref: 'department',
    description: 'The owning or cost-centre department.',
    example: 'Finance',
    synonyms: [
      'department',
      'dept',
      'cost centre',
      'cost center',
      'team',
      'division',
      'org unit',
      'ou',
    ],
  }),
  f({
    key: 'vendor',
    label: 'Vendor / supplier',
    kind: 'ref',
    ref: 'vendor',
    description: 'Who the asset was bought from.',
    example: 'CDW',
    synonyms: [
      'vendor',
      'supplier',
      'purchased from',
      'bought from',
      'supplied by',
      'reseller',
      'dealer',
    ],
  }),
  f({
    key: 'assigned_to',
    label: 'Assigned to',
    kind: 'ref',
    ref: 'person',
    description:
      'The person holding the asset (email address, employee number or full name). The asset is checked out to them.',
    example: 'anna@example.com',
    synonyms: [
      'assigned to',
      'assigned user',
      'assignee',
      'user',
      'owner',
      'user email',
      'email',
      'annotated user',
      'recent users',
      'checked out to',
      'employee',
      'holder',
    ],
  }),
  f({
    key: 'purchase_date',
    label: 'Purchase date',
    kind: 'date',
    description: 'When it was bought (2024-03-07 or day/month/year).',
    example: '2024-03-07',
    synonyms: [
      'purchase date',
      'purchased',
      'bought',
      'date purchased',
      'date of purchase',
      'date bought',
      'acquired',
      'acquisition date',
      'invoice date',
      'purchase_date',
    ],
  }),
  f({
    key: 'purchase_cost',
    label: 'Purchase cost',
    kind: 'money',
    description: 'What it cost, in major units (1234.50).',
    example: '1249.00',
    synonyms: [
      'purchase cost',
      'cost',
      'price',
      'purchase price',
      'value',
      'amount',
      'purchase_cost',
      'unit price',
    ],
  }),
  f({
    key: 'currency',
    label: 'Currency',
    kind: 'text',
    description:
      'ISO 4217 code of the cost (USD). Defaults to the import option, then to the organisation currency.',
    example: 'EUR',
    synonyms: ['currency', 'currency code', 'curr'],
  }),
  f({
    key: 'order_number',
    label: 'Order number',
    kind: 'text',
    description: 'Purchase order or invoice number.',
    example: 'PO-2024-117',
    synonyms: [
      'order number',
      'order no',
      'po',
      'po number',
      'purchase order',
      'invoice',
      'invoice number',
      'order_number',
    ],
  }),
  f({
    key: 'warranty_end',
    label: 'Warranty end',
    kind: 'date',
    description: 'When the warranty ends.',
    example: '2027-03-07',
    synonyms: [
      'warranty end',
      'warranty expires',
      'warranty expiry',
      'warranty expiration',
      'warranty until',
      'warranty date',
      'warranty_end',
      'auto update expiration',
    ],
  }),
  f({
    key: 'notes',
    label: 'Notes',
    kind: 'long_text',
    description: 'Free text notes.',
    example: 'Has a cracked corner',
    synonyms: ['notes', 'note', 'comments', 'comment', 'remarks', 'annotated notes'],
  }),
  f({
    key: 'external_id',
    label: 'External id',
    kind: 'text',
    description:
      "The id of the asset in the system it comes from (Google device id, ...). With the import's external source it identifies the asset on re-import.",
    example: '8a1b2c3d',
    synonyms: ['external id', 'external_id', 'device id', 'deviceid', 'directory api id'],
  }),
];

const PERSON_FIELDS: FieldSpec[] = [
  f({
    key: 'display_name',
    label: 'Name',
    kind: 'text',
    required: true,
    description: 'The name shown everywhere. Built from first and last name when empty.',
    example: 'Anna Berg',
    synonyms: ['name', 'display name', 'full name', 'person', 'employee name', 'display_name'],
  }),
  f({
    key: 'first_name',
    label: 'First name',
    kind: 'text',
    description: 'Given name.',
    example: 'Anna',
    synonyms: ['first name', 'given name', 'firstname', 'forename', 'first_name'],
  }),
  f({
    key: 'last_name',
    label: 'Last name',
    kind: 'text',
    description: 'Family name.',
    example: 'Berg',
    synonyms: ['last name', 'surname', 'family name', 'lastname', 'last_name'],
  }),
  f({
    key: 'email',
    label: 'Email',
    kind: 'email',
    description:
      'Email address; unique among people. Used to find existing people when re-importing.',
    example: 'anna.berg@example.com',
    synonyms: ['email', 'e-mail', 'email address', 'mail', 'work email'],
  }),
  f({
    key: 'phone',
    label: 'Phone',
    kind: 'text',
    description: 'Phone number.',
    example: '+47 22 00 00 00',
    synonyms: ['phone', 'telephone', 'tel', 'mobile', 'phone number'],
  }),
  f({
    key: 'employee_ref',
    label: 'Employee number',
    kind: 'text',
    description: 'Employee, student or badge number; unique among people.',
    example: 'E-10442',
    synonyms: [
      'employee number',
      'employee id',
      'employee ref',
      'staff id',
      'staff number',
      'student id',
      'badge',
      'employee_ref',
      'emp id',
      'person id',
    ],
  }),
  f({
    key: 'department',
    label: 'Department',
    kind: 'ref',
    ref: 'department',
    description: 'A department.',
    example: 'Finance',
    synonyms: ['department', 'dept', 'team', 'division', 'org unit', 'cost centre'],
  }),
  f({
    key: 'job_title',
    label: 'Job title',
    kind: 'text',
    description: 'Role or title.',
    example: 'Accountant',
    synonyms: ['job title', 'title', 'position', 'role', 'job_title'],
  }),
  f({
    key: 'kind',
    label: 'Kind',
    kind: 'enum',
    values: ['employee', 'student', 'contractor', 'external'],
    description: 'employee, student, contractor or external (default employee).',
    example: 'employee',
    synonyms: ['kind', 'person type', 'type', 'worker type', 'employment type'],
  }),
  f({
    key: 'status',
    label: 'Status',
    kind: 'enum',
    values: ['active', 'inactive'],
    description: 'active or inactive (default active).',
    example: 'active',
    synonyms: ['status', 'state', 'active'],
  }),
  f({
    key: 'location',
    label: 'Location',
    kind: 'path',
    ref: 'location',
    description: 'Where the person sits (a location or a path).',
    example: 'HQ > Building 2',
    synonyms: ['location', 'site', 'office', 'building', 'room', 'desk'],
  }),
  f({
    key: 'notes',
    label: 'Notes',
    kind: 'long_text',
    description: 'Free text notes.',
    example: '',
    synonyms: ['notes', 'comments', 'remarks'],
  }),
];

const LOCATION_FIELDS: FieldSpec[] = [
  f({
    key: 'name',
    label: 'Name',
    kind: 'text',
    description:
      'The name of the location (the last part of a path). Not needed when a full path is mapped.',
    example: 'Room 14',
    synonyms: ['name', 'location name', 'location', 'room', 'site name'],
  }),
  f({
    key: 'path',
    label: 'Full path',
    kind: 'path',
    description:
      'The whole path including this location, parts separated by ">" ("HQ > Building 2 > Room 14"). Missing parents are created.',
    example: 'HQ > Building 2 > Room 14',
    synonyms: ['path', 'full path', 'location path', 'hierarchy', 'full name', 'org unit path'],
  }),
  f({
    key: 'parent_path',
    label: 'Parent path',
    kind: 'path',
    description: 'The path of the parent, when the name is in its own column.',
    example: 'HQ > Building 2',
    synonyms: ['parent', 'parent location', 'parent path', 'parent name', 'belongs to', 'within'],
  }),
  f({
    key: 'kind',
    label: 'Kind',
    kind: 'enum',
    values: ['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'],
    description: 'site, building, floor, room, storage, vehicle or other (default other).',
    example: 'room',
    synonyms: ['kind', 'type', 'location type', 'level'],
  }),
  f({
    key: 'code',
    label: 'Code',
    kind: 'text',
    description: 'A short code.',
    example: 'HQ-B2-14',
    synonyms: ['code', 'location code', 'short code', 'id', 'reference'],
  }),
  f({
    key: 'address_line1',
    label: 'Address line 1',
    kind: 'text',
    description: '',
    example: '1 Main Street',
    synonyms: ['address', 'address line 1', 'address1', 'street', 'address_line1'],
  }),
  f({
    key: 'address_line2',
    label: 'Address line 2',
    kind: 'text',
    description: '',
    example: '',
    synonyms: ['address line 2', 'address2', 'address_line2'],
  }),
  f({
    key: 'city',
    label: 'City',
    kind: 'text',
    description: '',
    example: 'Oslo',
    synonyms: ['city', 'town'],
  }),
  f({
    key: 'region',
    label: 'Region / state',
    kind: 'text',
    description: '',
    example: '',
    synonyms: ['region', 'state', 'province', 'county'],
  }),
  f({
    key: 'postal_code',
    label: 'Postal code',
    kind: 'text',
    description: '',
    example: '0150',
    synonyms: ['postal code', 'zip', 'zip code', 'postcode', 'postal_code'],
  }),
  f({
    key: 'country',
    label: 'Country',
    kind: 'text',
    description: 'Two-letter ISO 3166-1 code (NO).',
    example: 'NO',
    synonyms: ['country', 'country code'],
  }),
  f({
    key: 'latitude',
    label: 'Latitude',
    kind: 'number',
    description: 'Decimal degrees.',
    example: '59.9139',
    synonyms: ['latitude', 'lat'],
  }),
  f({
    key: 'longitude',
    label: 'Longitude',
    kind: 'number',
    description: 'Decimal degrees.',
    example: '10.7522',
    synonyms: ['longitude', 'lng', 'lon', 'long'],
  }),
  f({
    key: 'notes',
    label: 'Notes',
    kind: 'long_text',
    description: '',
    example: '',
    synonyms: ['notes', 'comments', 'remarks'],
  }),
];

const DEPARTMENT_FIELDS: FieldSpec[] = [
  f({
    key: 'name',
    label: 'Name',
    kind: 'text',
    required: true,
    description: 'The department name; unique ignoring case.',
    example: 'Finance',
    synonyms: ['name', 'department', 'department name', 'dept'],
  }),
  f({
    key: 'code',
    label: 'Code',
    kind: 'text',
    description: 'A short code or cost-centre number.',
    example: 'CC-100',
    synonyms: ['code', 'department code', 'cost centre', 'cost center', 'cost centre code', 'id'],
  }),
  f({
    key: 'description',
    label: 'Description',
    kind: 'long_text',
    description: '',
    example: 'Accounting and payroll',
    synonyms: ['description', 'notes', 'about'],
  }),
  f({
    key: 'manager',
    label: 'Manager',
    kind: 'ref',
    ref: 'person',
    description: 'The head of the department (email address or employee number of a person).',
    example: 'anna.berg@example.com',
    synonyms: ['manager', 'head', 'department head', 'lead', 'owner'],
  }),
];

export const FIELD_SPECS: Record<EntityType, readonly FieldSpec[]> = {
  asset: ASSET_FIELDS,
  person: PERSON_FIELDS,
  location: LOCATION_FIELDS,
  department: DEPARTMENT_FIELDS,
};

/** A custom field of a category, as a mapping target `cf:<key>`. */
export interface CustomTarget {
  key: string;
  label: string;
  dataType: string;
  categoryId: string | null;
}

export const CUSTOM_PREFIX = 'cf:';

export function specOf(entity: EntityType, key: string): FieldSpec | undefined {
  return FIELD_SPECS[entity].find((s) => s.key === key);
}

export interface Suggestion {
  index: number;
  header: string;
  target: string | null;
  confidence: number;
}

/** The words of a header or synonym: lower case, accents and punctuation removed. */
function wordsOf(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Words that name a field only when they are the whole header: "Supplier Name" is the supplier, not the
 * asset's name; "Item Type" is not the asset's name either.
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'name',
  'title',
  'description',
  'item',
  'type',
  'kind',
  'class',
  'value',
  'amount',
  'state',
]);

/** Does `phrase` occur in `words` as whole, consecutive words? */
function containsPhrase(words: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > words.length) return false;
  for (let i = 0; i + phrase.length <= words.length; i++) {
    if (phrase.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

/**
 * How well a header that is not exactly a synonym still names a field (0 = not at all). A synonym found
 * as whole words of the header scores by the share of the header it covers, so a longer phrase beats a
 * single word ("Bought From" is the vendor's "bought from", not the purchase date's "bought"); a synonym
 * hidden inside a longer word ("purchasedate" in "purchasedateutc") scores lowest.
 */
export function partialScore(header: string, synonyms: readonly string[]): number {
  const words = wordsOf(header);
  const loose = looseKey(header);
  let best = 0;
  for (const synonym of synonyms) {
    const phrase = wordsOf(synonym);
    const key = looseKey(synonym);
    const generic = phrase.length === 1 && GENERIC_WORDS.has(phrase[0]!);
    if (key.length >= 4 && !generic && containsPhrase(words, phrase)) {
      best = Math.max(best, 0.6 + 0.25 * (phrase.length / Math.max(words.length, 1)));
    } else if (
      loose.length >= 5 &&
      key.length >= 5 &&
      (loose.includes(key) || key.includes(loose))
    ) {
      best = Math.max(best, 0.5);
    }
  }
  return Math.min(best, 0.85);
}

/**
 * Heuristic mapping of headers to targets: case- and punctuation-insensitive (`Serial No.`, `S/N`,
 * `service_tag`), exact synonym first, then a header that contains a synonym as whole words (the longer
 * the phrase the better), then one that contains it inside a word; every target is taken by at most one
 * column (the best match). Custom fields match their key or label (`cf:<key>` exports match exactly).
 */
export function suggestMapping(
  entity: EntityType,
  headers: readonly string[],
  custom: readonly CustomTarget[] = [],
): Suggestion[] {
  interface Candidate {
    index: number;
    target: string;
    score: number;
  }
  const candidates: Candidate[] = [];
  const specs = FIELD_SPECS[entity];
  const lowerHeaders = headers.map((h) => h.trim().toLowerCase());
  const hasNameColumn = lowerHeaders.some(
    (h) => looseKey(h) === 'name' || looseKey(h) === 'locationname',
  );
  headers.forEach((header, index) => {
    const loose = looseKey(header);
    if (loose === '') return;
    for (const spec of specs) {
      let score = 0;
      const phrases = [spec.key, spec.label, ...spec.synonyms];
      const own = phrases.map(looseKey);
      if (own.includes(loose))
        score = loose === looseKey(spec.key) || loose === looseKey(spec.label) ? 1 : 0.9;
      else score = partialScore(header, phrases);
      // an export writes the ancestors of a location in `path` next to its own `name`
      if (entity === 'location' && spec.key === 'path' && loose === 'path' && hasNameColumn)
        score = 0;
      if (entity === 'location' && spec.key === 'parent_path' && loose === 'path' && hasNameColumn)
        score = 0.95;
      if (score > 0) candidates.push({ index, target: spec.key, score });
    }
    if (entity === 'asset') {
      for (const c of custom) {
        const keys = [c.key, c.label, `cf${c.key}`].map(looseKey);
        if (keys.includes(loose))
          candidates.push({
            index,
            target: `${CUSTOM_PREFIX}${c.key}`,
            score: header.toLowerCase().startsWith(CUSTOM_PREFIX) ? 1 : 0.85,
          });
      }
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const usedTarget = new Set<string>();
  const usedColumn = new Set<number>();
  const chosen = new Map<number, Candidate>();
  for (const c of candidates) {
    if (usedTarget.has(c.target) || usedColumn.has(c.index)) continue;
    usedTarget.add(c.target);
    usedColumn.add(c.index);
    chosen.set(c.index, c);
  }
  return headers.map((header, index) => {
    const c = chosen.get(index);
    return { index, header, target: c?.target ?? null, confidence: c ? c.score : 0 };
  });
}
