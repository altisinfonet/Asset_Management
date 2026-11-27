import { CUSTOM_PREFIX, type EntityType, type FieldSpec, specOf } from './fields.js';
import type { ImportOptions, MappedRecord, Mapping, RowIssue } from './types.js';
import {
  type DateFormat,
  cellText,
  currencyHint,
  parseDate,
  parseNumber,
  toMinor,
} from './values.js';

/** A mapped column resolved against the entity's field table. */
export interface ColumnPlan {
  index: number;
  target: string;
  /** The spec of a core field; `null` for a custom field. */
  spec: FieldSpec | null;
  /** Custom field key (without the `cf:` prefix). */
  custom?: string;
  dateFormat?: DateFormat;
}

/** The columns of a mapping that point at a known target (unknown targets are reported by `checkMapping`). */
export function planColumns(entity: EntityType, mapping: Partial<Mapping>): ColumnPlan[] {
  const out: ColumnPlan[] = [];
  for (const col of mapping.columns ?? []) {
    if (!col.target) continue;
    if (col.target.startsWith(CUSTOM_PREFIX)) {
      out.push({
        index: col.index,
        target: col.target,
        spec: null,
        custom: col.target.slice(CUSTOM_PREFIX.length),
        ...(col.date_format ? { dateFormat: col.date_format } : {}),
      });
      continue;
    }
    const spec = specOf(entity, col.target);
    if (spec) {
      out.push({
        index: col.index,
        target: col.target,
        spec,
        ...(col.date_format ? { dateFormat: col.date_format } : {}),
      });
    }
  }
  return out;
}

/** Problems with a mapping that make a dry run pointless (unknown or repeated targets, missing essentials). */
export function checkMapping(
  entity: EntityType,
  mapping: Partial<Mapping>,
  options: Pick<ImportOptions, 'defaults'>,
  customKeys: ReadonlySet<string>,
  headerCount: number | null,
): RowIssue[] {
  const issues: RowIssue[] = [];
  const seen = new Map<string, number>();
  for (const col of mapping.columns ?? []) {
    if (headerCount !== null && col.index >= headerCount) {
      issues.push({
        field: null,
        code: 'column',
        message: `Column ${col.index + 1} is not in the file.`,
      });
    }
    if (!col.target) continue;
    const isCustom = col.target.startsWith(CUSTOM_PREFIX);
    if (isCustom && entity !== 'asset') {
      issues.push({
        field: col.target,
        code: 'target',
        message: 'Custom fields can only be imported into assets.',
      });
    } else if (isCustom && !customKeys.has(col.target.slice(CUSTOM_PREFIX.length))) {
      issues.push({
        field: col.target,
        code: 'target',
        message: `There is no custom field "${col.target.slice(CUSTOM_PREFIX.length)}".`,
      });
    } else if (!isCustom && !specOf(entity, col.target)) {
      issues.push({
        field: col.target,
        code: 'target',
        message: `"${col.target}" is not a field of ${entity} imports.`,
      });
    }
    if (seen.has(col.target)) {
      issues.push({
        field: col.target,
        code: 'duplicate',
        message: `Two columns (${seen.get(col.target)! + 1} and ${col.index + 1}) are mapped to ${col.target}.`,
      });
    }
    seen.set(col.target, col.index);
  }
  const consts = (mapping as { constants?: Record<string, string> }).constants ?? {};
  const has = (k: string) => seen.has(k) || k in consts;
  switch (entity) {
    case 'asset':
      if (!has('category') && !options.defaults.category) {
        issues.push({
          field: 'category',
          code: 'required',
          message: 'Map a column to Category, or choose a default category.',
        });
      }
      if (!has('asset_tag') && !has('serial') && !has('name') && !has('external_id')) {
        issues.push({
          field: null,
          code: 'required',
          message:
            'Map at least one of asset tag, serial number, name or external id so rows can be told apart.',
        });
      }
      break;
    case 'person':
      if (!has('display_name') && !(has('first_name') || has('last_name')) && !has('email')) {
        issues.push({
          field: 'display_name',
          code: 'required',
          message: 'Map a column to Name (or First/Last name, or Email).',
        });
      }
      break;
    case 'location':
      if (!has('name') && !has('path')) {
        issues.push({
          field: 'name',
          code: 'required',
          message: 'Map a column to Name or to Full path.',
        });
      }
      break;
    case 'department':
      if (!has('name'))
        issues.push({ field: 'name', code: 'required', message: 'Map a column to Name.' });
      break;
  }
  return issues;
}

const REF_TARGETS = new Set([
  'category',
  'manufacturer',
  'model',
  'status',
  'location',
  'department',
  'vendor',
  'assigned_to',
  'manager',
]);

export interface MapContext {
  columns: readonly ColumnPlan[];
  options: ImportOptions;
  baseCurrency: string;
  /** Texts for targets without a column (`mapping.constants`). */
  constants?: Record<string, string>;
}

/**
 * A summary line at the foot of a spreadsheet ("TOTAL ITEMS: 120", "Grand total 58,000"): exactly one
 * non-empty cell, which starts with total / subtotal / grand total / sum / count and holds a number.
 * Returns that cell, or null. Such a row is skipped by the dry run with its own reason (ED-36) instead of
 * failing on whatever field it lacks.
 */
export function summaryRowText(cells: readonly string[]): string | null {
  const filled = cells.map((c) => cellText(c)).filter((c) => c !== '');
  if (filled.length !== 1) return null;
  const text = filled[0]!;
  if (text.length > 120 || !/\d/.test(text)) return null;
  return /^(?:grand\s+|sub\s*-?\s*)?(?:totals?|sum|count)\b/i.test(text) ? text : null;
}

/** One row of cells -> the typed record and the problems with the cells themselves. */
export function mapRow(
  cells: readonly string[],
  ctx: MapContext,
): { record: MappedRecord; issues: RowIssue[] } {
  const record: MappedRecord = { f: {}, r: {}, c: {}, b: [] };
  const issues: RowIssue[] = [];
  const bad = (field: string, message: string, code: string) =>
    issues.push({ field, message, code });
  let costAmount: number | null = null;
  let costHint: string | null = null;

  for (const col of ctx.columns) {
    const text = cellText(cells[col.index]);
    if (text === '') {
      record.b.push(col.target);
      continue;
    }
    if (col.custom !== undefined) {
      record.c[col.custom] = text;
      continue;
    }
    const spec = col.spec!;
    switch (spec.kind) {
      case 'text':
      case 'long_text':
        record.f[spec.key] = text;
        break;
      case 'email':
        record.f[spec.key] = text.toLowerCase();
        break;
      case 'ref':
      case 'path':
        // a reference is resolved later; the `path` / `parent_path` of a location import are plain text
        if (spec.ref) record.r[spec.key] = text.replace(/\s+/g, ' ');
        else record.f[spec.key] = text;
        break;
      case 'integer':
      case 'number': {
        const n = parseNumber(text, ctx.options.number_format);
        if (!n.ok) bad(spec.key, `${spec.label} ${n.message}`, n.code);
        else if (spec.kind === 'integer' && !Number.isInteger(n.value))
          bad(spec.key, `${spec.label} must be a whole number`, 'integer');
        else record.f[spec.key] = n.value;
        break;
      }
      case 'date': {
        const d = parseDate(text, col.dateFormat ?? ctx.options.date_format);
        if (!d.ok) bad(spec.key, `${spec.label}: ${d.message}`, d.code);
        else record.f[spec.key] = d.value;
        break;
      }
      case 'money': {
        const n = parseNumber(text, ctx.options.number_format);
        if (!n.ok) bad(spec.key, `${spec.label} ${n.message}`, n.code);
        else {
          costAmount = n.value;
          costHint = currencyHint(text, ctx.options.default_currency ?? ctx.baseCurrency);
        }
        break;
      }
      case 'enum': {
        const hit = spec.values!.find((v) => v === text.toLowerCase());
        if (!hit)
          bad(
            spec.key,
            `${spec.label} must be one of ${spec.values!.join(', ')} (got "${text.slice(0, 40)}")`,
            'enum',
          );
        else record.f[spec.key] = hit;
        break;
      }
    }
  }

  for (const [target, text] of Object.entries(ctx.constants ?? {})) {
    if (record.r[target] !== undefined || record.f[target] !== undefined) continue;
    if (target.startsWith(CUSTOM_PREFIX)) record.c[target.slice(CUSTOM_PREFIX.length)] ??= text;
    else if (REF_TARGETS.has(target)) record.r[target] = text;
    else record.f[target] = text;
  }

  if (costAmount !== null) {
    const raw = typeof record.f.currency === 'string' ? record.f.currency.toUpperCase() : null;
    const currency = raw ?? costHint ?? ctx.options.default_currency ?? ctx.baseCurrency;
    if (!/^[A-Z]{3}$/.test(currency)) {
      bad(
        'currency',
        `"${String(record.f.currency).slice(0, 20)}" is not a three-letter currency code`,
        'currency',
      );
    } else {
      const minor = toMinor(costAmount, currency);
      if (!minor.ok) bad('purchase_cost', `Purchase cost ${minor.message}`, minor.code);
      else record.f.purchase_cost = { amount_minor: minor.value, currency };
    }
  }
  delete record.f.currency;
  return { record, issues };
}
