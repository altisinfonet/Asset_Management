import { type RawDocument, loadDocument } from './contract.js';

/**
 * A small JSON-schema subset checker for response bodies against the contract's component schemas:
 * `$ref`, `type` (single or list, with `integer`), `enum`, `oneOf` / `anyOf` / `allOf`, `format`
 * (uuid, date, date-time, email, uri), `properties` / `required`, `items`, numeric and string
 * bounds. Not enforced (a response may carry more than the contract promises, never less):
 * `additionalProperties`. No dependency on a validator library: the contract is simple.
 */

type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  allOf?: Schema[];
  format?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

const FORMATS: Record<string, RegExp> = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  email: /^[^\s@]+@[^\s@]+$/,
  uri: /^[a-z][a-z0-9+.-]*:/i,
};

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

export function resolveRef(doc: RawDocument, ref: string): Schema {
  const name = ref.split('/').pop()!;
  const schema = doc.components.schemas[name] as Schema | undefined;
  if (!schema) throw new Error(`unknown schema ${ref}`);
  return schema;
}

/** Problems of `value` against `schema` (empty = valid). `path` is a JSON pointer for the messages. */
export function check(schema: Schema, value: unknown, path = '', doc = loadDocument()): string[] {
  if (schema.$ref) return check(resolveRef(doc, schema.$ref), value, path, doc);
  const problems: string[] = [];
  const here = path || '/';

  if (schema.allOf) for (const s of schema.allOf) problems.push(...check(s, value, path, doc));
  for (const key of ['oneOf', 'anyOf'] as const) {
    const options = schema[key];
    if (options && !options.some((s) => check(s, value, path, doc).length === 0)) {
      problems.push(`${here}: matches none of the ${key} options`);
    }
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return [...problems, `${here}: expected ${types.join('|')}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${here}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string') {
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format]!.test(value)) {
      problems.push(`${here}: not a ${schema.format}: ${value}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${here}: too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${here}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      problems.push(`${here}: does not match ${schema.pattern}`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${here}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${here}: above maximum`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => problems.push(...check(schema.items!, item, `${path}/${i}`, doc)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) problems.push(`${path}/${key}: required property is missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) problems.push(...check(sub, obj[key], `${path}/${key}`, doc));
    }
  }
  return problems;
}
