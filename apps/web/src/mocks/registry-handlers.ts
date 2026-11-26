import type { components } from '@assettracker/api-client';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, problem, problemBody, requireSession } from './http';
import {
  MOCK_ROLES,
  newResourceId,
  roleAssignmentView,
  roleIdFor,
  type MockAsset,
  type MockUserRecord,
  type Rec,
  type RegistryData,
} from './registry-fixtures';
import { locationPathText, subtreeIds } from '@/lib/registry/locations';
import { mutateRegistry, registry } from './registry-state';
import { w3 } from './w3-state';
import { inScope, scopedLocationErrors } from './scope';

/**
 * Mock handlers for the registry endpoints of docs/engineering/openapi.yaml: categories, custom
 * fields, status labels, manufacturers, models, vendors, locations, assets (CRUD, archive,
 * restore, history, scan resolve), search, users, roles, invitations and user sessions.
 *
 * They follow the contract's conventions: cursor pagination bound to sort and filters, comma-
 * separated array filters, `archived=exclude|include|only`, weak `ETag`s with `If-Match` (428 /
 * 412), problem+json with `errors[]` pointers, and server-side permission checks.
 */
type S = components['schemas'];
export type FieldError = { pointer: string; message: string; code?: string };
export type Body = Record<string, unknown>;

export const strip = <T extends { _v: number }>(record: T): Omit<T, '_v' | '_system'> => {
  const { _v: _ignored, _system: _hidden, ...rest } = record as T & { _system?: unknown };
  return rest;
};
export const nowIso = () => new Date().toISOString();

export function one<T extends { _v: number }>(
  record: T,
  status = 200,
  extra: Record<string, string> = {},
) {
  return HttpResponse.json(strip(record), {
    status,
    headers: { ETag: etagOf(record._v), ...extra },
  });
}

export async function readBody(request: Request): Promise<Body | null> {
  const body = (await request.json().catch(() => null)) as unknown;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Body) : null;
}

export function validation(errors: FieldError[]) {
  return problem(422, 'validation', 'Validation failed', { errors });
}

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// ---- listing: filters, sort, cursor ------------------------------------------------------------

export interface ListConfig<T> {
  sorts: Record<string, (item: T) => string | number | null | undefined>;
  defaultSort: string;
  /** Sort keys whose empty values come LAST in both directions (the asset sorts of M2-REG-03). */
  emptyLast?: string[];
  /** Free-text match for `q`. */
  haystack?: (item: T) => Array<string | null | undefined>;
  filter?: (item: T, params: URLSearchParams) => boolean;
}

export const csv = (params: URLSearchParams, name: string): string[] =>
  (params.get(name) ?? '').split(',').filter(Boolean);

export function paginate<T extends { id: string; archived_at?: string | null; _v: number }>(
  request: Request,
  items: T[],
  config: ListConfig<T>,
  decorate: (item: T) => unknown = (item) => strip(item),
) {
  const params = new URL(request.url).searchParams;
  const archived = params.get('archived') ?? 'exclude';
  const q = params.get('q')?.trim().toLowerCase();
  const sortKeys = (params.get('sort') ?? config.defaultSort).split(',').filter(Boolean);
  const limit = Math.max(1, Math.min(200, Number(params.get('limit') ?? 50) || 50));

  for (const key of sortKeys) {
    if (!(key.replace(/^-/, '') in config.sorts)) {
      return problem(400, 'bad-request', `Unsupported sort key ${key}`);
    }
  }

  // A cursor is only valid for the sort and filters that produced it.
  const fingerprint = [...params.entries()]
    .filter(([name]) => !['cursor', 'limit', 'include_total'].includes(name))
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join('&');
  let offset = 0;
  const cursor = params.get('cursor');
  if (cursor) {
    try {
      const decoded = JSON.parse(atob(cursor)) as { o: number; f: string };
      if (decoded.f !== fingerprint || !Number.isInteger(decoded.o)) throw new Error('stale');
      offset = decoded.o;
    } catch {
      return problem(400, 'invalid-cursor', 'Invalid cursor');
    }
  }

  const rows = items
    .filter((item) => {
      const isArchived = !!item.archived_at;
      if (archived === 'exclude' && isArchived) return false;
      if (archived === 'only' && !isArchived) return false;
      if (q && !(config.haystack?.(item) ?? []).some((v) => v?.toLowerCase().includes(q))) {
        return false;
      }
      return config.filter ? config.filter(item, params) : true;
    })
    .sort((a, b) => {
      for (const key of sortKeys) {
        const desc = key.startsWith('-');
        const name = key.replace(/^-/, '');
        const get = config.sorts[name]!;
        const av = get(a) ?? '';
        const bv = get(b) ?? '';
        if (av === bv) continue;
        if (config.emptyLast?.includes(name) && (av === '' || bv === '')) return av === '' ? 1 : -1;
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' });
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
      return a.id.localeCompare(b.id);
    });

  const slice = rows.slice(offset, offset + limit);
  const hasMore = offset + limit < rows.length;
  return HttpResponse.json({
    data: slice.map(decorate),
    page: {
      next_cursor: hasMore ? btoa(JSON.stringify({ o: offset + limit, f: fingerprint })) : null,
      has_more: hasMore,
      ...(params.get('include_total') === 'true' ? { total: rows.length } : {}),
    },
  });
}

// ---- generic resource CRUD ---------------------------------------------------------------------

type Collection<T> = (data: RegistryData) => Rec<T>[];

interface ResourceConfig<T extends { id: string; archived_at?: string | null }> {
  path: string;
  readPermission: string;
  writePermission: string;
  collection: Collection<T>;
  idKind: Parameters<typeof newResourceId>[0];
  list: ListConfig<Rec<T>>;
  /** Validate a create (`existing` undefined) or update body; return field errors or a conflict. */
  validate: (
    body: Body,
    data: RegistryData,
    existing?: Rec<T>,
  ) => FieldError[] | { conflict: string; pointer?: string };
  build: (body: Body, id: string, data: RegistryData) => T;
  merge: (existing: Rec<T>, body: Body, data: RegistryData) => Partial<T>;
  /** Why an archive is refused (returns a sentence with counts), or undefined when allowed. */
  inUse?: (record: Rec<T>, data: RegistryData) => InUse | undefined;
  /** Hook after a write (e.g. keep exactly one default status label). */
  afterWrite?: (record: Rec<T>, data: RegistryData) => void;
}

function resource<T extends { id: string; archived_at?: string | null }>(
  config: ResourceConfig<T>,
): HttpHandler[] {
  const find = (id: string) => config.collection(registry()).find((r) => r.id === id);
  const notFound = () => problem(404, 'not-found', 'Not found');

  return [
    http.get(config.path, ({ request }) => {
      const guard = requireSession(request, { permission: config.readPermission });
      if (!guard.ok) return guard.response;
      return paginate(request, config.collection(registry()), config.list);
    }),

    http.get(`${config.path}/:id`, ({ request, params }) => {
      const guard = requireSession(request, { permission: config.readPermission });
      if (!guard.ok) return guard.response;
      const record = find(String(params.id));
      return record ? one(record) : notFound();
    }),

    http.post(config.path, async ({ request }) => {
      const guard = requireSession(request, { mutation: true, permission: config.writePermission });
      if (!guard.ok) return guard.response;
      const body = await readBody(request);
      if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
      const outcome = config.validate(body, registry());
      if (Array.isArray(outcome) && outcome.length > 0) return validation(outcome);
      if (!Array.isArray(outcome)) {
        return problem(409, 'conflict', outcome.conflict, {
          errors: outcome.pointer ? [{ pointer: outcome.pointer, message: outcome.conflict }] : [],
        });
      }
      const record = mutateRegistry((data) => {
        const id = newResourceId(config.idKind);
        const stamp = nowIso();
        const created = {
          ...config.build(body, id, data),
          id,
          created_at: stamp,
          updated_at: stamp,
          archived_at: null,
          _v: 1,
        } as unknown as Rec<T>;
        config.collection(data).push(created);
        config.afterWrite?.(created, data);
        return created;
      });
      return one(record, 201, { Location: `${config.path}/${record.id}` });
    }),

    http.patch(`${config.path}/:id`, async ({ request, params }) => {
      const guard = requireSession(request, { mutation: true, permission: config.writePermission });
      if (!guard.ok) return guard.response;
      const existing = find(String(params.id));
      if (!existing) return notFound();
      const stale = checkIfMatch(request, existing._v);
      if (stale) return stale;
      const body = await readBody(request);
      if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
      const outcome = config.validate(body, registry(), existing);
      if (Array.isArray(outcome) && outcome.length > 0) return validation(outcome);
      if (!Array.isArray(outcome)) {
        return problem(409, 'conflict', outcome.conflict, {
          errors: outcome.pointer ? [{ pointer: outcome.pointer, message: outcome.conflict }] : [],
        });
      }
      const record = mutateRegistry((data) => {
        const target = config.collection(data).find((r) => r.id === existing.id)!;
        Object.assign(target, config.merge(target, body, data), {
          updated_at: nowIso(),
          _v: target._v + 1,
        });
        config.afterWrite?.(target, data);
        return target;
      });
      return one(record);
    }),

    http.delete(`${config.path}/:id`, ({ request, params }) => {
      const guard = requireSession(request, { mutation: true, permission: config.writePermission });
      if (!guard.ok) return guard.response;
      const existing = find(String(params.id));
      if (!existing) return notFound();
      const stale = checkIfMatch(request, existing._v);
      if (stale) return stale;
      const reason = config.inUse?.(existing, registry());
      if (reason) return problem(409, 'conflict', 'The record is in use', reason);
      mutateRegistry((data) => {
        const target = config.collection(data).find((r) => r.id === existing.id)!;
        target.archived_at = nowIso();
        target._v += 1;
      });
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

/** What a refused delete answers: the API's sentence and the `usage` counts (zeros included). */
type InUse = { detail: string; usage?: Record<string, number> };

/** Mirrors the API's `inUse()`: `409 conflict` listing what references the record. */
function inUse(label: string, usage: Record<string, number>): InUse | undefined {
  const parts = Object.entries(usage)
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${what}: ${n}`);
  return parts.length
    ? { detail: `${label} is in use (${parts.join(', ')}) and cannot be deleted.`, usage }
    : undefined;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function requireName(body: Body, existing: unknown): FieldError[] {
  const errors: FieldError[] = [];
  if (!existing || 'name' in body) {
    if (!text(body.name))
      errors.push({ pointer: '/name', message: 'is required', code: 'required' });
  }
  return errors;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const activeAssets = (data: RegistryData) => data.assets.filter((a) => !a.archived_at);

// ---- the resources -------------------------------------------------------------------------------

const categoryHandlers = resource<S['Category']>({
  path: '/v1/categories',
  readPermission: 'catalog:read',
  writePermission: 'catalog:manage',
  collection: (d) => d.categories,
  idKind: 'category',
  list: {
    sorts: { name: (c) => c.name, created_at: (c) => c.created_at },
    defaultSort: 'name',
    haystack: (c) => [c.name, c.tag_prefix],
    filter: (c, p) => !p.get('kind') || c.kind === p.get('kind'),
  },
  validate: (body, data, existing) => {
    const errors = requireName(body, existing);
    if (
      typeof body.tag_prefix === 'string' &&
      body.tag_prefix !== '' &&
      !/^[A-Z0-9-]{1,12}$/.test(body.tag_prefix)
    ) {
      errors.push({
        pointer: '/tag_prefix',
        message: 'use letters, digits, - or _',
        code: 'pattern',
      });
    }
    if (existing && body.kind !== undefined && body.kind !== existing.kind) {
      errors.push({ pointer: '/kind', message: 'cannot be changed', code: 'immutable' });
    }
    if (errors.length > 0) return errors;
    const name = text(body.name);
    if (
      name &&
      data.categories.some((c) => c.id !== existing?.id && !c.archived_at && sameName(c.name, name))
    ) {
      return { conflict: 'A category with this name already exists', pointer: '/name' };
    }
    return [];
  },
  build: (body) => ({
    id: '',
    name: text(body.name)!,
    kind: (body.kind as S['Category']['kind']) ?? 'asset',
    tag_prefix: text(body.tag_prefix) ?? null,
    description: text(body.description) ?? null,
  }),
  merge: (_existing, body) => ({
    ...(body.name !== undefined ? { name: text(body.name)! } : {}),
    ...(body.tag_prefix !== undefined ? { tag_prefix: text(body.tag_prefix) ?? null } : {}),
    ...(body.description !== undefined ? { description: text(body.description) ?? null } : {}),
  }),
  inUse: (category, data) => {
    const assets = data.assets.filter((a) => a.category_id === category.id).length;
    const models = data.models.filter(
      (m) => !m.archived_at && m.category_id === category.id,
    ).length;
    const customFields = data.customFields.filter(
      (f) => !f.archived_at && f.category_id === category.id,
    ).length;
    return inUse('Category', { assets, models, custom_fields: customFields });
  },
});

const manufacturerHandlers = resource<S['Manufacturer']>({
  path: '/v1/manufacturers',
  readPermission: 'catalog:read',
  writePermission: 'catalog:manage',
  collection: (d) => d.manufacturers,
  idKind: 'manufacturer',
  list: {
    sorts: { name: (m) => m.name, created_at: (m) => m.created_at },
    defaultSort: 'name',
    haystack: (m) => [m.name],
  },
  validate: (body, data, existing) => {
    const errors = requireName(body, existing);
    if (errors.length > 0) return errors;
    const name = text(body.name);
    if (
      name &&
      data.manufacturers.some(
        (m) => m.id !== existing?.id && !m.archived_at && sameName(m.name, name),
      )
    ) {
      return { conflict: 'A manufacturer with this name already exists', pointer: '/name' };
    }
    return [];
  },
  build: (body) => ({
    id: '',
    name: text(body.name)!,
    url: text(body.url) ?? null,
    support_url: text(body.support_url) ?? null,
    support_email: text(body.support_email) ?? null,
    support_phone: text(body.support_phone) ?? null,
    notes: text(body.notes) ?? null,
  }),
  merge: (_e, body) => ({
    ...(body.name !== undefined ? { name: text(body.name)! } : {}),
    ...(body.url !== undefined ? { url: text(body.url) ?? null } : {}),
    ...(body.support_url !== undefined ? { support_url: text(body.support_url) ?? null } : {}),
    ...(body.support_email !== undefined
      ? { support_email: text(body.support_email) ?? null }
      : {}),
    ...(body.support_phone !== undefined
      ? { support_phone: text(body.support_phone) ?? null }
      : {}),
    ...(body.notes !== undefined ? { notes: text(body.notes) ?? null } : {}),
  }),
  inUse: (m, data) => {
    const models = data.models.filter((x) => !x.archived_at && x.manufacturer_id === m.id).length;
    return inUse('Manufacturer', { models });
  },
});

const vendorHandlers = resource<S['Vendor']>({
  path: '/v1/vendors',
  readPermission: 'catalog:read',
  writePermission: 'catalog:manage',
  collection: (d) => d.vendors,
  idKind: 'vendor',
  list: {
    sorts: { name: (v) => v.name, created_at: (v) => v.created_at },
    defaultSort: 'name',
    haystack: (v) => [v.name, v.contact_name, v.contact_email],
  },
  validate: (body, data, existing) => {
    const errors = requireName(body, existing);
    if (
      typeof body.contact_email === 'string' &&
      body.contact_email &&
      !/^\S+@\S+\.\S+$/.test(body.contact_email)
    ) {
      errors.push({
        pointer: '/contact_email',
        message: 'must be an email address',
        code: 'format',
      });
    }
    if (typeof body.url === 'string' && body.url) {
      try {
        new URL(body.url);
      } catch {
        errors.push({ pointer: '/url', message: 'must be a valid URL', code: 'format' });
      }
    }
    if (errors.length > 0) return errors;
    const name = text(body.name);
    if (
      name &&
      data.vendors.some((v) => v.id !== existing?.id && !v.archived_at && sameName(v.name, name))
    ) {
      return { conflict: 'A vendor with this name already exists', pointer: '/name' };
    }
    return [];
  },
  build: (body) => ({
    id: '',
    name: text(body.name)!,
    contact_name: text(body.contact_name) ?? null,
    contact_email: text(body.contact_email) ?? null,
    phone: text(body.phone) ?? null,
    url: text(body.url) ?? null,
    address: text(body.address) ?? null,
    notes: text(body.notes) ?? null,
  }),
  merge: (_e, body) => {
    const out: Partial<S['Vendor']> = {};
    if (body.name !== undefined) out.name = text(body.name)!;
    for (const key of [
      'contact_name',
      'contact_email',
      'phone',
      'url',
      'address',
      'notes',
    ] as const) {
      if (body[key] !== undefined) out[key] = text(body[key]) ?? null;
    }
    return out;
  },
  inUse: (v, data) => {
    const assets = data.assets.filter((a) => a.vendor_id === v.id).length;
    return inUse('Vendor', { assets });
  },
});

const modelHandlers = resource<S['AssetModel']>({
  path: '/v1/models',
  readPermission: 'catalog:read',
  writePermission: 'catalog:manage',
  collection: (d) => d.models,
  idKind: 'model',
  list: {
    sorts: { name: (m) => m.name, created_at: (m) => m.created_at },
    defaultSort: 'name',
    haystack: (m) => [m.name, m.model_number],
    filter: (m, p) =>
      (!p.get('category_id') || m.category_id === p.get('category_id')) &&
      (!p.get('manufacturer_id') || m.manufacturer_id === p.get('manufacturer_id')),
  },
  validate: (body, data, existing) => {
    const errors = requireName(body, existing);
    if (!existing || 'category_id' in body) {
      const category = data.categories.find((c) => c.id === body.category_id);
      if (!category || category.kind !== 'asset') {
        errors.push({
          pointer: '/category_id',
          message: 'choose an asset category',
          code: 'required',
        });
      }
    }
    if (
      typeof body.manufacturer_id === 'string' &&
      !data.manufacturers.some((m) => m.id === body.manufacturer_id)
    ) {
      errors.push({
        pointer: '/manufacturer_id',
        message: 'unknown manufacturer',
        code: 'invalid',
      });
    }
    const months = body.default_depreciation_months;
    if (
      months !== undefined &&
      months !== null &&
      (!Number.isInteger(months) || (months as number) < 0)
    ) {
      errors.push({
        pointer: '/default_depreciation_months',
        message: 'must be a whole number of months',
        code: 'type',
      });
    }
    return errors;
  },
  build: (body) => ({
    id: '',
    category_id: body.category_id as string,
    manufacturer_id: (body.manufacturer_id as string | null | undefined) ?? null,
    name: text(body.name)!,
    model_number: text(body.model_number) ?? null,
    default_depreciation_months:
      (body.default_depreciation_months as number | null | undefined) ?? null,
    eol_date: text(body.eol_date) ?? null,
    notes: text(body.notes) ?? null,
  }),
  merge: (_e, body) => {
    const out: Partial<S['AssetModel']> = {};
    if (body.name !== undefined) out.name = text(body.name)!;
    if (body.category_id !== undefined) out.category_id = body.category_id as string;
    if (body.manufacturer_id !== undefined)
      out.manufacturer_id = body.manufacturer_id as string | null;
    if (body.model_number !== undefined) out.model_number = text(body.model_number) ?? null;
    if (body.default_depreciation_months !== undefined) {
      out.default_depreciation_months = body.default_depreciation_months as number | null;
    }
    if (body.eol_date !== undefined) out.eol_date = text(body.eol_date) ?? null;
    if (body.notes !== undefined) out.notes = text(body.notes) ?? null;
    return out;
  },
  inUse: (m, data) => {
    const assets = data.assets.filter((a) => a.model_id === m.id).length;
    return inUse('Model', { assets });
  },
});

const STATE_TYPES = ['deployable', 'deployed', 'pending', 'undeployable', 'archived', 'lost'];

const statusHandlers = resource<S['StatusLabel']>({
  path: '/v1/status-labels',
  readPermission: 'catalog:read',
  writePermission: 'catalog:manage',
  collection: (d) => d.statusLabels,
  idKind: 'status',
  list: {
    sorts: { position: (s) => s.position, name: (s) => s.name },
    defaultSort: 'position',
    filter: (s, p) =>
      csv(p, 'state_type').length === 0 || csv(p, 'state_type').includes(s.state_type),
  },
  validate: (body, data, existing) => {
    const errors = requireName(body, existing);
    if (!existing || 'state_type' in body) {
      if (!STATE_TYPES.includes(String(body.state_type))) {
        errors.push({ pointer: '/state_type', message: 'choose a state type', code: 'enum' });
      }
    }
    if (existing && body.state_type !== undefined && body.state_type !== existing.state_type) {
      const used = activeAssets(data).filter((a) => a.status_id === existing.id).length;
      if (used > 0) {
        errors.push({
          pointer: '/state_type',
          message: 'cannot change while assets use this label',
          code: 'in-use',
        });
      }
    }
    if (errors.length > 0) return errors;
    const name = text(body.name);
    if (
      name &&
      data.statusLabels.some(
        (s) => s.id !== existing?.id && !s.archived_at && sameName(s.name, name),
      )
    ) {
      return { conflict: 'A status label with this name already exists', pointer: '/name' };
    }
    return [];
  },
  build: (body, _id, data) => ({
    id: '',
    name: text(body.name)!,
    state_type: body.state_type as S['StatusLabel']['state_type'],
    color: null,
    description: text(body.description) ?? null,
    position: (body.position as number | undefined) ?? data.statusLabels.length,
    is_default: body.is_default === true,
  }),
  merge: (_e, body) => ({
    ...(body.name !== undefined ? { name: text(body.name)! } : {}),
    ...(body.state_type !== undefined
      ? { state_type: body.state_type as S['StatusLabel']['state_type'] }
      : {}),
    ...(body.description !== undefined ? { description: text(body.description) ?? null } : {}),
    ...(body.position !== undefined ? { position: body.position as number } : {}),
    ...(body.is_default !== undefined ? { is_default: body.is_default === true } : {}),
  }),
  inUse: (s, data) => {
    if (s.is_default) {
      return {
        detail: `"${s.name}" is the default status of new assets: make another label the default first.`,
      };
    }
    const assets = data.assets.filter((a) => a.status_id === s.id).length;
    return inUse('Status label', { assets });
  },
  // Exactly one default: setting one clears the others.
  afterWrite: (record, data) => {
    if (record.is_default) {
      for (const other of data.statusLabels) if (other.id !== record.id) other.is_default = false;
    }
  },
});

const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'url',
  'email',
];

const fieldHandlers = resource<S['CustomFieldDef']>({
  path: '/v1/custom-fields',
  readPermission: 'catalog:read',
  writePermission: 'catalog:manage',
  collection: (d) => d.customFields,
  idKind: 'field',
  list: {
    sorts: { position: (f) => f.position, key: (f) => f.key, created_at: (f) => f.created_at },
    defaultSort: 'position',
    haystack: (f) => [f.key, f.label],
    // "Fields applying to this category (including fields that apply to all categories)".
    filter: (f, p) =>
      !p.get('category_id') || f.category_id == null || f.category_id === p.get('category_id'),
  },
  validate: (body, data, existing) => {
    const errors: FieldError[] = [];
    if (!existing) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(String(body.key ?? ''))) {
        errors.push({
          pointer: '/key',
          message: 'use lower-case letters, digits and _, starting with a letter',
          code: 'pattern',
        });
      }
    } else if (body.key !== undefined && body.key !== existing.key) {
      errors.push({
        pointer: '/key',
        message: 'cannot be changed after creation',
        code: 'immutable',
      });
    }
    if (!existing || 'label' in body) {
      if (!text(body.label))
        errors.push({ pointer: '/label', message: 'is required', code: 'required' });
    }
    const type = (body.data_type ?? existing?.data_type) as string | undefined;
    if (!FIELD_TYPES.includes(String(type))) {
      errors.push({ pointer: '/data_type', message: 'choose a field type', code: 'enum' });
    }
    if (type === 'select' || type === 'multiselect') {
      const options = (body.options ?? existing?.options) as
        Array<{ value: string }> | null | undefined;
      if (!options || options.length === 0) {
        errors.push({ pointer: '/options', message: 'add at least one option', code: 'required' });
      } else if (new Set(options.map((o) => o.value)).size !== options.length) {
        errors.push({
          pointer: '/options',
          message: 'option values must be unique',
          code: 'unique',
        });
      }
    }
    if (
      typeof body.category_id === 'string' &&
      !data.categories.some((c) => c.id === body.category_id)
    ) {
      errors.push({ pointer: '/category_id', message: 'unknown category', code: 'invalid' });
    }
    if (errors.length > 0) return errors;
    if (existing && body.data_type !== undefined && body.data_type !== existing.data_type) {
      const withValues = data.assets.filter(
        (a) => a.custom_data[existing.key] !== undefined,
      ).length;
      if (withValues > 0) {
        return {
          conflict: `Cannot change the type: ${plural(withValues, 'asset has', 'assets have')} a value for this field.`,
        };
      }
    }
    const key = (body.key ?? existing?.key) as string;
    const scope =
      (body.category_id !== undefined ? body.category_id : existing?.category_id) ?? null;
    const clash = data.customFields.some(
      (f) =>
        f.id !== existing?.id &&
        !f.archived_at &&
        f.key === key &&
        (f.category_id == null || scope == null || f.category_id === scope),
    );
    return clash
      ? { conflict: 'A field with this key already exists for this category', pointer: '/key' }
      : [];
  },
  build: (body, _id, data) => ({
    id: '',
    category_id: (body.category_id as string | null | undefined) ?? null,
    key: body.key as string,
    label: text(body.label)!,
    data_type: body.data_type as S['CustomFieldDef']['data_type'],
    required: body.required === true,
    options: (body.options as S['CustomFieldDef']['options']) ?? null,
    validation: (body.validation as S['CustomFieldDef']['validation']) ?? null,
    help_text: text(body.help_text) ?? null,
    position: (body.position as number | undefined) ?? data.customFields.length + 1,
    show_in_list: body.show_in_list === true,
  }),
  merge: (_e, body) => {
    const out: Partial<S['CustomFieldDef']> = {};
    if (body.label !== undefined) out.label = text(body.label)!;
    if (body.data_type !== undefined)
      out.data_type = body.data_type as S['CustomFieldDef']['data_type'];
    if (body.required !== undefined) out.required = body.required === true;
    if (body.options !== undefined) out.options = body.options as S['CustomFieldDef']['options'];
    if (body.validation !== undefined)
      out.validation = body.validation as S['CustomFieldDef']['validation'];
    if (body.help_text !== undefined) out.help_text = text(body.help_text) ?? null;
    if (body.position !== undefined) out.position = body.position as number;
    if (body.show_in_list !== undefined) out.show_in_list = body.show_in_list === true;
    if (body.category_id !== undefined) out.category_id = body.category_id as string | null;
    return out;
  },
});

// ---- assets ----------------------------------------------------------------------------------------

function isValidDate(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Validate `values` against the definitions that apply to `categoryId` (server-side rules). */
function validateCustomData(
  data: RegistryData,
  categoryId: string | undefined,
  values: Record<string, unknown>,
  options: { checkRequiredAgainst?: Record<string, unknown> } = {},
): FieldError[] {
  const defs = data.customFields.filter(
    (f) => !f.archived_at && (f.category_id == null || f.category_id === categoryId),
  );
  const errors: FieldError[] = [];
  for (const [key, value] of Object.entries(values)) {
    const pointer = `/custom_data/${key}`;
    const def = defs.find((d) => d.key === key);
    if (!def) {
      errors.push({ pointer, message: 'unknown field', code: 'unknown' });
      continue;
    }
    if (value === null || value === '') continue;
    const rules = (def.validation ?? {}) as {
      min?: number;
      max?: number;
      pattern?: string;
      max_length?: number;
    };
    switch (def.data_type) {
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push({ pointer, message: 'must be a number', code: 'type' });
        } else if (rules.min !== undefined && value < rules.min) {
          errors.push({ pointer, message: `must be at least ${rules.min}`, code: 'min' });
        } else if (rules.max !== undefined && value > rules.max) {
          errors.push({ pointer, message: `must be at most ${rules.max}`, code: 'max' });
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean')
          errors.push({ pointer, message: 'must be true or false', code: 'type' });
        break;
      case 'date':
        if (!isValidDate(value))
          errors.push({ pointer, message: 'must be a date (YYYY-MM-DD)', code: 'format' });
        break;
      case 'select':
        if (!def.options?.some((o) => o.value === value)) {
          errors.push({ pointer, message: 'is not one of the options', code: 'enum' });
        }
        break;
      case 'multiselect':
        if (!Array.isArray(value) || value.some((v) => !def.options?.some((o) => o.value === v))) {
          errors.push({ pointer, message: 'contains a value that is not an option', code: 'enum' });
        }
        break;
      case 'url':
        try {
          new URL(String(value));
        } catch {
          errors.push({ pointer, message: 'must be a valid URL', code: 'format' });
        }
        break;
      case 'email':
        if (!/^\S+@\S+\.\S+$/.test(String(value))) {
          errors.push({ pointer, message: 'must be an email address', code: 'format' });
        }
        break;
      default:
        if (typeof value !== 'string') {
          errors.push({ pointer, message: 'must be text', code: 'type' });
        } else if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
          errors.push({ pointer, message: 'does not match the expected format', code: 'pattern' });
        } else if (rules.max_length && value.length > rules.max_length) {
          errors.push({
            pointer,
            message: `must be at most ${rules.max_length} characters`,
            code: 'max',
          });
        }
    }
  }
  const effective = options.checkRequiredAgainst ?? values;
  for (const def of defs) {
    const value = effective[def.key];
    if (
      def.required &&
      (value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0))
    ) {
      errors.push({ pointer: `/custom_data/${def.key}`, message: 'is required', code: 'required' });
    }
  }
  return errors;
}

function validateAssetBody(
  body: Body,
  data: RegistryData,
  existing?: MockAsset,
): FieldError[] | { conflict: string; pointer: string } {
  const errors: FieldError[] = [];
  const categoryId = (body.category_id ?? existing?.category_id) as string | undefined;
  const category = data.categories.find((c) => c.id === categoryId);
  if (!categoryId || !category || category.kind !== 'asset') {
    errors.push({ pointer: '/category_id', message: 'choose an asset category', code: 'required' });
  }
  const modelId = body.model_id !== undefined ? body.model_id : existing?.model_id;
  if (typeof modelId === 'string') {
    const model = data.models.find((m) => m.id === modelId);
    if (!model) errors.push({ pointer: '/model_id', message: 'unknown model', code: 'invalid' });
    else if (model.category_id !== categoryId) {
      errors.push({
        pointer: '/model_id',
        message: 'does not belong to the chosen category',
        code: 'invalid',
      });
    }
  }
  if (
    typeof body.status_id === 'string' &&
    !data.statusLabels.some((s) => s.id === body.status_id)
  ) {
    errors.push({ pointer: '/status_id', message: 'unknown status', code: 'invalid' });
  }
  if (
    typeof body.location_id === 'string' &&
    !data.locations.some((l) => l.id === body.location_id)
  ) {
    errors.push({ pointer: '/location_id', message: 'unknown location', code: 'invalid' });
  }
  if (typeof body.vendor_id === 'string' && !data.vendors.some((v) => v.id === body.vendor_id)) {
    errors.push({ pointer: '/vendor_id', message: 'unknown vendor', code: 'invalid' });
  }
  // ED-17: a live department (the API answers `not-found` on the field)
  if (
    typeof body.department_id === 'string' &&
    body.department_id !== existing?.department_id &&
    !data.departments.some((d) => d.id === body.department_id && !d.archived_at)
  ) {
    errors.push({ pointer: '/department_id', message: 'No such department.', code: 'not-found' });
  }
  if (typeof body.asset_tag === 'string' && /\s/.test(body.asset_tag.trim())) {
    errors.push({ pointer: '/asset_tag', message: 'must not contain whitespace', code: 'pattern' });
  }
  for (const key of ['purchase_date', 'warranty_end'] as const) {
    if (typeof body[key] === 'string' && !isValidDate(body[key])) {
      errors.push({ pointer: `/${key}`, message: 'must be a date (YYYY-MM-DD)', code: 'format' });
    }
  }
  const cost = body.purchase_cost as
    { amount_minor?: unknown; currency?: unknown } | null | undefined;
  if (
    cost &&
    (!Number.isInteger(cost.amount_minor) ||
      (cost.amount_minor as number) < 0 ||
      typeof cost.currency !== 'string')
  ) {
    errors.push({
      pointer: '/purchase_cost',
      message: 'needs whole minor units and a currency',
      code: 'type',
    });
  }
  const custom = body.custom_data;
  if (
    custom !== undefined &&
    (typeof custom !== 'object' || custom === null || Array.isArray(custom))
  ) {
    errors.push({ pointer: '/custom_data', message: 'must be an object', code: 'type' });
  } else if (categoryId) {
    const incoming = (custom ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...(existing?.custom_data ?? {}) };
    for (const [k, v] of Object.entries(incoming)) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    errors.push(
      ...validateCustomData(data, categoryId, incoming, { checkRequiredAgainst: merged }),
    );
  }
  if (errors.length > 0) return errors;
  if (typeof body.asset_tag === 'string' && body.asset_tag.trim()) {
    const tag = body.asset_tag.trim().toLowerCase();
    if (data.assets.some((a) => a.id !== existing?.id && a.asset_tag.toLowerCase() === tag)) {
      return { conflict: 'This asset tag is already in use', pointer: '/asset_tag' };
    }
  }
  return [];
}

export function pushHistory(
  data: RegistryData,
  asset: MockAsset,
  event_type: S['HistoryEvent']['event_type'],
  summary: string,
  actorId: string | undefined,
  payload: Record<string, unknown> = {},
) {
  data.history.push({
    id: newResourceId('history'),
    asset_id: asset.id,
    at: nowIso(),
    event_type,
    actor_type: 'user',
    actor_id: actorId ?? null,
    assignment_id: null,
    transfer_id: null,
    summary,
    payload,
  });
}

// ---- asset writes shared by the single and the bulk endpoints ----------------------------------

/** Applies a validated PATCH body to an asset (inside `mutateRegistry`) and writes its history. */
function applyAssetPatch(data: RegistryData, id: string, body: Body, actorId: string): MockAsset {
  const target = data.assets.find((a) => a.id === id)!;
  const before = { status: target.status_id, location: target.location_id };
  /** The names of the fields whose value really changed (the `updated` event lists them). */
  const changed: string[] = [];
  const assign = (key: string, value: unknown) => {
    const record = target as Record<string, unknown>;
    if (JSON.stringify(record[key]) === JSON.stringify(value)) return;
    record[key] = value;
    changed.push(key);
  };
  const simple = [
    'name',
    'serial',
    'order_number',
    'notes',
    'purchase_date',
    'warranty_end',
  ] as const;
  for (const key of simple) if (body[key] !== undefined) assign(key, text(body[key]) ?? null);
  if (body.asset_tag !== undefined && text(body.asset_tag))
    assign('asset_tag', text(body.asset_tag));
  if (body.category_id !== undefined) assign('category_id', body.category_id);
  if (body.model_id !== undefined) assign('model_id', body.model_id);
  if (body.status_id !== undefined) assign('status_id', body.status_id);
  if (body.location_id !== undefined) assign('location_id', body.location_id);
  if (body.vendor_id !== undefined) assign('vendor_id', body.vendor_id);
  if (body.department_id !== undefined) assign('department_id', body.department_id);
  if (body.purchase_cost !== undefined) assign('purchase_cost', body.purchase_cost);
  if (body.custom_data !== undefined) {
    const merged = { ...target.custom_data } as Record<string, unknown>;
    for (const [k, v] of Object.entries(body.custom_data as Record<string, unknown>)) {
      if (v === null || v === '') delete merged[k];
      else merged[k] = v;
    }
    assign('custom_data', merged);
  }
  target.updated_at = nowIso();
  target._v += 1;
  // The events of the API: a status change, a location change, then one `updated` for the rest.
  if (target.status_id !== before.status) {
    const from = data.statusLabels.find((s) => s.id === before.status)?.name ?? null;
    const to = data.statusLabels.find((s) => s.id === target.status_id)?.name ?? null;
    pushHistory(data, target, 'status_changed', `Status changed from ${from} to ${to}`, actorId, {
      from: before.status,
      to: target.status_id,
      from_name: from,
      to_name: to,
    });
  }
  if (target.location_id !== before.location) {
    const name = (locationId: string | null | undefined) =>
      locationId ? (data.locations.find((l) => l.id === locationId)?.name ?? 'unknown') : null;
    pushHistory(
      data,
      target,
      'location_changed',
      `Moved from ${name(before.location) ?? 'no location'} to ${name(target.location_id) ?? 'no location'}`,
      actorId,
      {
        from: before.location ?? null,
        to: target.location_id ?? null,
        from_name: name(before.location),
        to_name: name(target.location_id),
      },
    );
  }
  const other = changed.filter((key) => key !== 'status_id' && key !== 'location_id');
  if (other.length > 0) {
    pushHistory(data, target, 'updated', `Updated ${other.join(', ')}`, actorId, { fields: other });
  }
  return target;
}

function setAssetArchived(
  data: RegistryData,
  id: string,
  archive: boolean,
  actorId: string,
): MockAsset {
  const target = data.assets.find((a) => a.id === id)!;
  target.archived_at = archive ? nowIso() : null;
  // a restored disposal loses its record and gets the tenant default status (`POST .../restore`)
  if (!archive && target.disposal) {
    target.disposal = null;
    const fallback = data.statusLabels.find((st) => st.is_default && !st.archived_at);
    if (fallback) target.status_id = fallback.id;
  }
  target._v += 1;
  pushHistory(
    data,
    target,
    archive ? 'archived' : 'restored',
    archive ? 'Asset archived' : 'Asset restored',
    actorId,
  );
  return target;
}

const BULK_MAX = 100;

/** The `ids` of a bulk body (de-duplicated, as the API does), or the 422 answer for a bad one. */
function bulkIds(body: Body | null): string[] | Response {
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((i) => typeof i !== 'string')) {
    return validation([
      { pointer: '/ids', message: 'must contain at least 1 id', code: 'too_small' },
    ]);
  }
  if (ids.length > BULK_MAX) {
    return problem(422, 'validation', 'Validation failed', {
      detail: `A bulk request accepts at most ${BULK_MAX} items.`,
      errors: [
        {
          pointer: '/ids',
          message: `must contain at most ${BULK_MAX} items (got ${ids.length})`,
          code: 'too_big',
        },
      ],
    });
  }
  return [...new Set(ids as string[])];
}

type ItemOutcome = MockAsset | { problem: ReturnType<typeof problemBody> };
const itemProblem = (
  status: number,
  code: string,
  title: string,
  extra: Parameters<typeof problemBody>[3] = {},
): ItemOutcome => ({ problem: problemBody(status, code, title, extra) });

/** `200 { results[], summary }`: one result per id in request order (`index`, `status`, `data` | `error`). */
function bulkResponse(ids: string[], run: (id: string) => ItemOutcome) {
  const results = ids.map((id, index) => {
    const out = run(id);
    return 'problem' in out
      ? { index, status: out.problem.status, error: out.problem }
      : { index, status: 200, data: expandAsset(out, []) };
  });
  const failed = results.filter((r) => 'error' in r).length;
  return HttpResponse.json({
    results,
    summary: { total: results.length, succeeded: results.length - failed, failed },
  });
}

export function expandAsset(asset: MockAsset, expand: string[]): Record<string, unknown> {
  const data = registry();
  const { _v: _ignored, ...pub } = asset;
  const status = data.statusLabels.find((s) => s.id === asset.status_id);
  const expanded: Record<string, unknown> = {};
  if (expand.includes('model') && asset.model_id) {
    const m = data.models.find((x) => x.id === asset.model_id);
    if (m) expanded.model = strip(m);
  }
  if (expand.includes('category')) {
    const c = data.categories.find((x) => x.id === asset.category_id);
    if (c) expanded.category = strip(c);
  }
  if (expand.includes('location') && asset.location_id) {
    const l = data.locations.find((x) => x.id === asset.location_id);
    if (l) expanded.location = strip(l);
  }
  if (expand.includes('department') && asset.department_id) {
    const d = data.departments.find((x) => x.id === asset.department_id);
    // the embedded department has no counts and no manager name (`departmentDto` of the API)
    if (d) expanded.department = { ...strip(d), manager_name: null };
  }
  if (expand.includes('vendor') && asset.vendor_id) {
    const v = data.vendors.find((x) => x.id === asset.vendor_id);
    if (v) expanded.vendor = strip(v);
  }
  const holder = asset.current_assignment;
  return {
    ...pub,
    // `overdue` is the server's: the custody is open and its due date is before today (UTC)
    current_assignment: holder
      ? {
          ...holder,
          overdue: !!holder.expected_return && holder.expected_return < nowIso().slice(0, 10),
        }
      : null,
    status: status
      ? { id: status.id, name: status.name, state_type: status.state_type }
      : undefined,
    ...(expand.length > 0 ? { expanded } : {}),
  };
}

export function oneAsset(
  asset: MockAsset,
  expand: string[] = [],
  status = 200,
  extra: Record<string, string> = {},
) {
  return HttpResponse.json(expandAsset(asset, expand), {
    status,
    headers: { ETag: etagOf(asset._v), ...extra },
  });
}

const ASSET_SORTS: ListConfig<MockAsset>['sorts'] = {
  created_at: (a) => a.created_at,
  updated_at: (a) => a.updated_at,
  asset_tag: (a) => a.asset_tag,
  name: (a) => a.name,
  purchase_date: (a) => a.purchase_date,
  warranty_end: (a) => a.warranty_end,
  // M2-REG-03: the location path, the holder's name and the expected return; empty values last
  location: (a) => locationPathText(registry().locations, a.location_id).toLowerCase(),
  assignee: (a) => a.current_assignment?.target_name?.toLowerCase(),
  due: (a) => a.current_assignment?.expected_return,
};

export function assetFilter(a: MockAsset, p: URLSearchParams): boolean {
  const data = registry();
  const tag = p.get('tag');
  if (tag && a.asset_tag.toLowerCase() !== tag.toLowerCase()) return false;
  const serial = p.get('serial');
  if (serial && (a.serial ?? '').toLowerCase() !== serial.toLowerCase()) return false;
  const statusIds = csv(p, 'status_id');
  if (statusIds.length > 0 && !statusIds.includes(a.status_id)) return false;
  const stateTypes = csv(p, 'state_type');
  if (stateTypes.length > 0) {
    const label = data.statusLabels.find((s) => s.id === a.status_id);
    if (!label || !stateTypes.includes(label.state_type)) return false;
  }
  const categories = csv(p, 'category_id');
  if (categories.length > 0 && !categories.includes(a.category_id)) return false;
  const models = csv(p, 'model_id');
  if (models.length > 0 && !(a.model_id && models.includes(a.model_id))) return false;
  const manufacturer = p.get('manufacturer_id');
  if (manufacturer) {
    const model = data.models.find((m) => m.id === a.model_id);
    if (model?.manufacturer_id !== manufacturer) return false;
  }
  const locationId = p.get('location_id');
  if (locationId) {
    const include = p.get('include_sublocations') !== 'false';
    const here = include
      ? subtreeIds(data.locations, locationId).has(a.location_id ?? '')
      : a.location_id === locationId;
    if (!here) return false;
  }
  const assigned = p.get('assigned');
  if (assigned === 'true' && !a.current_assignment) return false;
  if (assigned === 'false' && a.current_assignment) return false;
  // `overdue` is the server's: checked out with an expected return before today (UTC)
  const overdue = p.get('overdue');
  if (overdue === 'true' || overdue === 'false') {
    const due = a.current_assignment?.expected_return;
    const isOverdue = !!due && due < nowIso().slice(0, 10);
    if (isOverdue !== (overdue === 'true')) return false;
  }
  const holder = p.get('assigned_person_id');
  if (holder) {
    const current = a.current_assignment;
    if (!(current?.target_type === 'person' && current.target_id === holder)) return false;
  }
  if (p.get('vendor_id') && a.vendor_id !== p.get('vendor_id')) return false;
  if (p.get('department_id') && a.department_id !== p.get('department_id')) return false;
  // ED-38: the assets an import created
  const importJob = p.get('import_job_id');
  if (
    importJob &&
    !w3().importRows.some(
      (r) => r.job_id === importJob && r.result === 'created' && r.created_id === a.id,
    )
  )
    return false;
  const before = p.get('warranty_end_before');
  if (before && !(a.warranty_end && a.warranty_end <= before)) return false;
  const after = p.get('warranty_end_after');
  if (after && !(a.warranty_end && a.warranty_end >= after)) return false;
  for (const [name, value] of p.entries()) {
    const match = /^cf\[(.+)\]$/.exec(name);
    if (match && String(a.custom_data[match[1]!]) !== value) return false;
  }
  return true;
}

// ---- GET/PUT /v1/settings/asset-tag-template (ETag = tenant settings version) --------------------

const tagTemplateView = (data: RegistryData) => {
  const { prefix, width, use_category_prefix } = data.tagTemplate;
  const example = prefix + (use_category_prefix ? 'LAP-' : '') + String(42).padStart(width, '0');
  return { prefix, width, use_category_prefix, example };
};

const tagTemplateHandlers: HttpHandler[] = [
  http.get('/v1/settings/asset-tag-template', ({ request }) => {
    const guard = requireSession(request, { permission: 'catalog:read' });
    if (!guard.ok) return guard.response;
    const data = registry();
    return HttpResponse.json(tagTemplateView(data), {
      headers: { ETag: etagOf(data.settingsVersion) },
    });
  }),

  http.put('/v1/settings/asset-tag-template', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'catalog:manage' });
    if (!guard.ok) return guard.response;
    const stale = checkIfMatch(request, registry().settingsVersion);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    // Strict like the API: only these three members; `example` is read-only and rejected.
    const errors: FieldError[] = [];
    for (const key of Object.keys(body)) {
      if (!['prefix', 'width', 'use_category_prefix'].includes(key)) {
        errors.push({ pointer: `/${key}`, message: 'is not allowed', code: 'unrecognized_keys' });
      }
    }
    const prefix = body.prefix ?? '';
    if (typeof prefix !== 'string' || !/^[A-Z0-9-]{0,12}$/.test(prefix)) {
      errors.push({
        pointer: '/prefix',
        message: 'must be up to 12 of A-Z, 0-9 and -',
        code: 'invalid_format',
      });
    }
    const width = body.width ?? 5;
    if (typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > 12) {
      errors.push({
        pointer: '/width',
        message: 'must be a whole number from 1 to 12',
        code: 'invalid_type',
      });
    }
    const useCategory = body.use_category_prefix ?? true;
    if (typeof useCategory !== 'boolean') {
      errors.push({
        pointer: '/use_category_prefix',
        message: 'must be true or false',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    const data = mutateRegistry((d) => {
      d.tagTemplate = {
        prefix: prefix as string,
        width: width as number,
        use_category_prefix: useCategory as boolean,
      };
      d.settingsVersion += 1;
      return d;
    });
    return HttpResponse.json(tagTemplateView(data), {
      headers: { ETag: etagOf(data.settingsVersion) },
    });
  }),
];

const assetHandlers: HttpHandler[] = [
  http.get('/v1/assets', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const expand = csv(new URL(request.url).searchParams, 'expand');
    const scope = guard.user.locationScope;
    return paginate(
      request,
      registry().assets,
      {
        sorts: ASSET_SORTS,
        emptyLast: ['location', 'assignee', 'due'],
        defaultSort: '-created_at',
        haystack: (a) => [a.asset_tag, a.serial, a.name, a.order_number],
        // M2-LOC-03: a scoped principal lists only the assets inside its subtrees
        filter: (a, p) => inScope(scope, a.location_id) && assetFilter(a, p),
      },
      (a) => expandAsset(a, expand),
    );
  }),

  http.get('/v1/assets/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset || !inScope(guard.user.locationScope, asset.location_id)) {
      return problem(404, 'not-found', 'Not found');
    }
    return oneAsset(asset, csv(new URL(request.url).searchParams, 'expand'));
  }),

  http.post('/v1/assets', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:create' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validateAssetBody(body, registry());
    if (Array.isArray(outcome) && outcome.length > 0) return validation(outcome);
    // M2-LOC-03: a scoped principal creates inside its scope, never without a location
    const outside = scopedLocationErrors(
      guard.user.locationScope,
      body.location_id,
      '/location_id',
      true,
    );
    if (outside.length > 0) return validation(outside);
    if (!Array.isArray(outcome)) {
      return problem(409, 'conflict', outcome.conflict, {
        errors: [{ pointer: outcome.pointer, message: outcome.conflict, code: 'unique' }],
      });
    }
    const asset = mutateRegistry((data) => {
      const category = data.categories.find((c) => c.id === body.category_id)!;
      let tag = text(body.asset_tag);
      if (!tag) {
        // Auto-numbering from the tenant template and the category prefix; skips numbers taken.
        const template = data.tagTemplate;
        const prefix =
          template.prefix + (template.use_category_prefix ? (category.tag_prefix ?? '') : '');
        let n = data.tagCounters[prefix] ?? 1;
        const taken = new Set(data.assets.map((a) => a.asset_tag.toLowerCase()));
        const numbered = (k: number) => prefix + String(k).padStart(template.width, '0');
        while (taken.has(numbered(n).toLowerCase())) n += 1;
        tag = numbered(n);
        data.tagCounters[prefix] = n + 1;
      }
      const defaultStatus = data.statusLabels.find((s) => s.is_default && !s.archived_at)!;
      const stamp = nowIso();
      const created: MockAsset = {
        id: newResourceId('asset'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        asset_tag: tag,
        name: text(body.name) ?? null,
        serial: text(body.serial) ?? null,
        category_id: category.id,
        model_id: (body.model_id as string | null | undefined) ?? null,
        status_id: (body.status_id as string | undefined) ?? defaultStatus.id,
        location_id: (body.location_id as string | null | undefined) ?? null,
        department_id: (body.department_id as string | null | undefined) ?? null,
        vendor_id: (body.vendor_id as string | null | undefined) ?? null,
        parent_asset_id: null,
        purchase_date: text(body.purchase_date) ?? null,
        purchase_cost: (body.purchase_cost as S['Money'] | null | undefined) ?? null,
        order_number: text(body.order_number) ?? null,
        warranty_end: text(body.warranty_end) ?? null,
        notes: text(body.notes) ?? null,
        custom_data: Object.fromEntries(
          Object.entries((body.custom_data ?? {}) as Record<string, unknown>).filter(
            ([, v]) => v !== null && v !== '',
          ),
        ),
        label_code: `LBL${Date.now().toString(36).toUpperCase()}`,
        current_assignment: null,
        _v: 1,
      };
      data.assets.push(created);
      pushHistory(data, created, 'created', `Asset ${created.asset_tag} created`, guard.user.id, {
        status_id: created.status_id,
        location_id: created.location_id,
      });
      return created;
    });
    return oneAsset(asset, [], 201, { Location: `/v1/assets/${asset.id}` });
  }),

  http.patch('/v1/assets/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:update' });
    if (!guard.ok) return guard.response;
    const existing = registry().assets.find((a) => a.id === params.id);
    if (!existing || !inScope(guard.user.locationScope, existing.location_id)) {
      return problem(404, 'not-found', 'Not found');
    }
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    if (existing.archived_at) {
      return problem(409, 'conflict', 'The asset is archived', {
        detail: 'The asset is archived. Restore it before changing it.',
      });
    }
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validateAssetBody(body, registry(), existing);
    if (Array.isArray(outcome) && outcome.length > 0) return validation(outcome);
    const outside = scopedLocationErrors(
      guard.user.locationScope,
      body.location_id,
      '/location_id',
      false,
    );
    if (outside.length > 0) return validation(outside);
    if (!Array.isArray(outcome)) {
      return problem(409, 'conflict', outcome.conflict, {
        errors: [{ pointer: outcome.pointer, message: outcome.conflict, code: 'unique' }],
      });
    }
    const asset = mutateRegistry((data) => applyAssetPatch(data, existing.id, body, guard.user.id));
    return oneAsset(asset);
  }),

  http.delete('/v1/assets/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:delete' });
    if (!guard.ok) return guard.response;
    const existing = registry().assets.find((a) => a.id === params.id);
    if (!existing || !inScope(guard.user.locationScope, existing.location_id)) {
      return problem(404, 'not-found', 'Not found');
    }
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    if (existing.archived_at) return problem(409, 'conflict', 'The asset is already archived');
    mutateRegistry((data) => setAssetArchived(data, existing.id, true, guard.user.id));
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/v1/assets/:id/restore', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:delete' });
    if (!guard.ok) return guard.response;
    const existing = registry().assets.find((a) => a.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    if (!existing.archived_at) return problem(409, 'conflict', 'The asset is not archived');
    const asset = mutateRegistry((data) =>
      setAssetArchived(data, existing.id, false, guard.user.id),
    );
    return oneAsset(asset);
  }),

  // Bulk: up to 100 ids, `200` with one result per id; a failing item never rolls back the others.
  http.post('/v1/assets/bulk-update', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:update' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    const ids = bulkIds(body);
    if (!Array.isArray(ids)) return ids;
    const changes = body?.changes;
    const allowed = [
      'status_id',
      'category_id',
      'model_id',
      'vendor_id',
      'department_id',
      'custom_data',
    ];
    if (
      typeof changes !== 'object' ||
      changes === null ||
      Array.isArray(changes) ||
      Object.keys(changes).length === 0 ||
      Object.keys(changes).some((k) => !allowed.includes(k))
    ) {
      return validation([
        {
          pointer: '/changes',
          message: `must change at least one of ${allowed.join(', ')} and nothing else`,
          code: 'invalid',
        },
      ]);
    }
    return bulkResponse(ids, (id) => {
      const existing = registry().assets.find((a) => a.id === id);
      if (!existing) return itemProblem(404, 'not-found', 'Not found');
      if (existing.archived_at) {
        return itemProblem(409, 'conflict', 'The asset is archived', {
          detail: 'The asset is archived. Restore it before changing it.',
        });
      }
      const outcome = validateAssetBody(changes as Body, registry(), existing);
      if (Array.isArray(outcome) && outcome.length > 0) {
        return itemProblem(422, 'validation', 'Validation failed', { errors: outcome });
      }
      if (!Array.isArray(outcome)) {
        return itemProblem(409, 'conflict', outcome.conflict, {
          errors: [{ pointer: outcome.pointer, message: outcome.conflict, code: 'unique' }],
        });
      }
      return mutateRegistry((data) => applyAssetPatch(data, id, changes as Body, guard.user.id));
    });
  }),

  // `POST /v1/assets/bulk-move` (M1-REG-09): one location (or none) for every listed asset.
  http.post('/v1/assets/bulk-move', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:update' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    const ids = bulkIds(body);
    if (!Array.isArray(ids)) return ids;
    const locationId = body?.location_id;
    if (locationId === undefined || (locationId !== null && typeof locationId !== 'string')) {
      return validation([{ pointer: '/location_id', message: 'Required', code: 'invalid_type' }]);
    }
    if (
      typeof locationId === 'string' &&
      !registry().locations.some((l) => l.id === locationId && !l.archived_at)
    ) {
      return validation([
        { pointer: '/location_id', message: 'No such location.', code: 'not-found' },
      ]);
    }
    const outside = scopedLocationErrors(
      guard.user.locationScope,
      locationId,
      '/location_id',
      false,
    );
    if (outside.length > 0) return validation(outside);
    const note = text(body?.note);
    return bulkResponse(ids, (id) => {
      const existing = registry().assets.find((a) => a.id === id);
      if (!existing || !inScope(guard.user.locationScope, existing.location_id)) {
        return itemProblem(404, 'not-found', 'Not found');
      }
      if (existing.archived_at) {
        return itemProblem(409, 'conflict', 'The asset is archived', {
          detail: 'Archived assets cannot be moved. Restore it first.',
        });
      }
      return mutateRegistry((data) => {
        const before = data.history.length;
        const moved = applyAssetPatch(data, id, { location_id: locationId }, guard.user.id);
        const event = data.history[before];
        if (note && event) event.payload = { ...event.payload, note };
        return moved;
      });
    });
  }),

  http.post('/v1/assets/bulk-archive', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:delete' });
    if (!guard.ok) return guard.response;
    const ids = bulkIds(await readBody(request));
    if (!Array.isArray(ids)) return ids;
    return bulkResponse(ids, (id) => {
      const existing = registry().assets.find((a) => a.id === id);
      if (!existing) return itemProblem(404, 'not-found', 'Not found');
      if (existing.archived_at) {
        return itemProblem(409, 'conflict', 'The asset is already archived');
      }
      return mutateRegistry((data) => setAssetArchived(data, id, true, guard.user.id));
    });
  }),

  http.post('/v1/assets/bulk-restore', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:delete' });
    if (!guard.ok) return guard.response;
    const ids = bulkIds(await readBody(request));
    if (!Array.isArray(ids)) return ids;
    return bulkResponse(ids, (id) => {
      const existing = registry().assets.find((a) => a.id === id);
      if (!existing) return itemProblem(404, 'not-found', 'Not found');
      if (!existing.archived_at) return itemProblem(409, 'conflict', 'The asset is not archived');
      return mutateRegistry((data) => setAssetArchived(data, id, false, guard.user.id));
    });
  }),
];

// ---- search -----------------------------------------------------------------------------------------

function rank(query: string, ...values: Array<string | null | undefined>): number {
  let best = 99;
  for (const value of values) {
    const v = value?.toLowerCase();
    if (!v) continue;
    if (v === query) best = Math.min(best, 0);
    else if (v.startsWith(query)) best = Math.min(best, 1);
    else if (v.includes(query)) best = Math.min(best, 2);
  }
  return best;
}

const searchHandler = http.get('/v1/search', ({ request }) => {
  const guard = requireSession(request, { permission: 'search:read' });
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const q = params.get('q')?.trim().toLowerCase();
  if (!q || q.length > 200) {
    return problem(400, 'bad-request', 'q must be 1-200 characters', {
      errors: [{ pointer: 'query:q', message: 'is required' }],
    });
  }
  const limit = Math.max(1, Math.min(50, Number(params.get('limit') ?? 5) || 5));
  const types = csv(params, 'types');
  const wants = (type: string) => types.length === 0 || types.includes(type);
  const data = registry();
  const user = guard.user;
  const can = (permission: string) =>
    user.permissions.includes('*') ||
    user.permissions.includes(permission) ||
    user.permissions.includes(`${permission.split(':')[0]}:*`);
  const results: S['SearchResult'][] = [];

  if (wants('asset') && can('asset:read')) {
    data.assets
      .filter((a) => !a.archived_at)
      .map((a) => ({ a, r: rank(q, a.asset_tag, a.serial, a.name) }))
      .filter((x) => x.r < 99)
      .sort((x, y) => x.r - y.r || x.a.asset_tag.localeCompare(y.a.asset_tag))
      .slice(0, limit)
      .forEach(({ a }) =>
        results.push({
          type: 'asset',
          id: a.id,
          label: `${a.asset_tag} ${a.name ?? ''}`.trim(),
          sublabel: a.serial ?? null,
          href_hint: `/assets/view?id=${a.id}`,
        }),
      );
  }
  if (wants('model') && can('catalog:read')) {
    data.models
      .filter((m) => !m.archived_at && rank(q, m.name, m.model_number) < 99)
      .slice(0, limit)
      .forEach((m) =>
        results.push({
          type: 'model',
          id: m.id,
          label: m.name,
          sublabel: data.manufacturers.find((x) => x.id === m.manufacturer_id)?.name ?? null,
          href_hint: '/settings/models',
        }),
      );
  }
  if (wants('category') && can('catalog:read')) {
    data.categories
      .filter((c) => !c.archived_at && c.kind === 'asset' && rank(q, c.name, c.tag_prefix) < 99)
      .slice(0, limit)
      .forEach((c) =>
        results.push({
          type: 'category',
          id: c.id,
          label: c.name,
          sublabel: c.tag_prefix ?? null,
          href_hint: '/settings/categories',
        }),
      );
  }
  return HttpResponse.json({ data: results });
});

// ---- users, roles, invitations --------------------------------------------------------------------------

const adminRoleId = roleIdFor('tenant_admin');
/** An org-wide administrator (a location-scoped one does not keep the organisation manageable). */
const isActiveAdmin = (u: MockUserRecord) =>
  !u.archived_at &&
  u.status === 'active' &&
  u.role_assignments.some(
    (r) => r.role_id === adminRoleId && (r.scope_type ?? 'tenant') === 'tenant',
  );

type AssignmentInput = {
  role_id?: unknown;
  scope_type?: unknown;
  company_id?: unknown;
  location_id?: unknown;
};

/** The checks of `resolveRoles` in apps/api/src/auth/users.service.ts, with its pointers and codes. */
function validateRoleAssignments(
  value: unknown,
  /** Where the pointers of assignment `i` start: a list in the body, or (ED-27) the body itself. */
  base: (i: number) => string = (i) => `/role_assignments/${i}`,
): FieldError[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ pointer: '/role_assignments', message: 'choose a role', code: 'required' }];
  }
  const errors: FieldError[] = [];
  value.forEach((raw, i) => {
    const a = (raw ?? {}) as AssignmentInput;
    const at = (field: string) => `${base(i)}/${field}`;
    if (!MOCK_ROLES.some((r) => r.id === a.role_id)) {
      errors.push({ pointer: at('role_id'), message: 'Unknown role.', code: 'not-found' });
      return;
    }
    const scope = a.scope_type ?? 'tenant';
    if (!['tenant', 'company', 'location'].includes(String(scope))) {
      errors.push({ pointer: at('scope_type'), message: 'Invalid option.', code: 'invalid' });
      return;
    }
    if (scope === 'company' && !a.company_id) {
      errors.push({
        pointer: at('company_id'),
        message: 'A company-scoped assignment needs an existing company_id.',
        code: 'invalid',
      });
    }
    if (scope === 'location') {
      // M2-LOC-03 (ED-26): the grant covers the location and its whole subtree
      const location = registry().locations.find((l) => l.id === a.location_id);
      if (!a.location_id || !location || location.archived_at) {
        errors.push({
          pointer: at('location_id'),
          message: 'A location-scoped assignment needs an existing, active location_id.',
          code: a.location_id ? 'not-found' : 'invalid',
        });
      }
      if (a.company_id) {
        errors.push({
          pointer: at('company_id'),
          message: 'A location-scoped assignment has no company_id.',
          code: 'invalid',
        });
      }
    }
    if (scope === 'company' && a.location_id) {
      errors.push({
        pointer: at('location_id'),
        message: 'A company-scoped assignment has no location_id.',
        code: 'invalid',
      });
    }
    if (scope === 'tenant' && (a.company_id || a.location_id)) {
      errors.push({
        pointer: at('scope_type'),
        message: 'A tenant-scoped assignment has no company_id or location_id.',
        code: 'invalid',
      });
    }
  });
  return errors;
}

/** The assignments as stored and returned: an id each, `company_id` / `location_id` always present. */
function storedAssignments(
  value: unknown,
  current: readonly S['RoleAssignment'][] = [],
): S['RoleAssignment'][] {
  // like the API, an unchanged assignment (same role and scope) keeps its id
  const key = (a: S['RoleAssignment']) =>
    [a.role_id, a.scope_type ?? 'tenant', a.company_id ?? '', a.location_id ?? ''].join('|');
  return (value as Array<S['RoleAssignment']>).map((a) =>
    roleAssignmentView(
      a,
      current.find((c) => key(c) === key(a))?.id ?? newResourceId('roleAssignment'),
    ),
  );
}

/** `person_id`: the person record of the login (every login has exactly one, M2-USR-03). */
const publicUser = (u: MockUserRecord) => {
  const { _v: _v1, invitation_expires_at: _expires, ...pub } = u;
  return {
    ...pub,
    person_id: registry().people.find((p) => p.user_id === u.id)?.id ?? null,
  };
};

function oneUser(user: MockUserRecord, status = 200, extra: Record<string, string> = {}) {
  return HttpResponse.json(publicUser(user), {
    status,
    headers: { ETag: etagOf(user._v), ...extra },
  });
}

/** A 409 as the API answers it: the reason is the `detail` (problem.conflict in the API). */
const conflict = (detail: string) => problem(409, 'conflict', 'Conflict', { detail });

const revokedUserSessions = new Set<string>();

const userHandlers: HttpHandler[] = [
  http.get('/v1/roles', ({ request }) => {
    const guard = requireSession(request, { permission: 'role:read' });
    if (!guard.ok) return guard.response;
    return HttpResponse.json({ data: MOCK_ROLES });
  }),

  http.get('/v1/users', ({ request }) => {
    const guard = requireSession(request, { permission: 'user:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      registry().users,
      {
        sorts: {
          display_name: (u) => u.display_name,
          email: (u) => u.email,
          created_at: (u) => u.created_at,
          last_login_at: (u) => u.last_login_at,
        },
        defaultSort: 'display_name',
        haystack: (u) => [u.display_name, u.email],
        filter: (u, p) =>
          (!p.get('status') || u.status === p.get('status')) &&
          (!p.get('role_id') || u.role_assignments.some((r) => r.role_id === p.get('role_id'))),
      },
      publicUser,
    );
  }),

  http.get('/v1/users/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'user:read' });
    if (!guard.ok) return guard.response;
    const user = registry().users.find((u) => u.id === params.id);
    return user ? oneUser(user) : problem(404, 'not-found', 'Not found');
  }),

  http.post('/v1/users', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const errors: FieldError[] = [];
    const email = text(body.email)?.toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      errors.push({ pointer: '/email', message: 'must be an email address', code: 'format' });
    }
    if (!text(body.display_name))
      errors.push({ pointer: '/display_name', message: 'is required', code: 'required' });
    errors.push(...validateRoleAssignments(body.role_assignments));
    if (errors.length > 0) return validation(errors);
    if (registry().users.some((u) => u.email.toLowerCase() === email && !u.archived_at)) {
      return problem(409, 'conflict', 'A user with this email already exists', {
        errors: [{ pointer: '/email', message: 'already in use', code: 'unique' }],
      });
    }
    const user = mutateRegistry((data) => {
      const stamp = nowIso();
      const created = {
        id: newResourceId('role'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        email: email!,
        display_name: text(body.display_name)!,
        status: 'invited',
        role_assignments: storedAssignments(body.role_assignments),
        mfa_enabled: false,
        last_login_at: null,
        invitation_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        _v: 1,
      } as MockUserRecord;
      data.users.push(created);
      // every login has the person the system makes for it (a database trigger in the API)
      data.people.push({
        id: newResourceId('person'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        kind: 'employee',
        display_name: created.display_name,
        first_name: null,
        last_name: null,
        email: data.people.some((p) => !p.archived_at && p.email?.toLowerCase() === email)
          ? null
          : email!,
        phone: null,
        employee_ref: null,
        department: null,
        department_id: null,
        job_title: null,
        location_id: null,
        company_id: data.people[0]?.company_id ?? '',
        status: 'active',
        notes: null,
        user_id: created.id,
        _system: true,
        _v: 1,
      });
      return created;
    });
    return oneUser(user, 201, { Location: `/v1/users/${user.id}` });
  }),

  http.patch('/v1/users/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const errors: FieldError[] = [];
    if (body.display_name !== undefined && !text(body.display_name)) {
      errors.push({ pointer: '/display_name', message: 'is required', code: 'required' });
    }
    if (body.role_assignments !== undefined)
      errors.push(...validateRoleAssignments(body.role_assignments));
    if (body.status !== undefined && !['active', 'disabled'].includes(String(body.status))) {
      errors.push({ pointer: '/status', message: 'must be active or disabled', code: 'enum' });
    }
    if (errors.length > 0) return validation(errors);

    const draft: MockUserRecord = {
      ...existing,
      ...(body.role_assignments
        ? { role_assignments: storedAssignments(body.role_assignments, existing.role_assignments) }
        : {}),
      ...(body.status ? { status: body.status as 'active' | 'disabled' } : {}),
    };
    if (
      isActiveAdmin(existing) &&
      !isActiveAdmin(draft) &&
      registry().users.filter(isActiveAdmin).length <= 1
    ) {
      return problem(409, 'conflict', 'The last administrator cannot be removed or disabled');
    }
    const user = mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      if (body.display_name !== undefined) target.display_name = text(body.display_name)!;
      if (body.role_assignments !== undefined) target.role_assignments = draft.role_assignments;
      if (body.status !== undefined) target.status = body.status as 'active' | 'disabled';
      target.updated_at = nowIso();
      target._v += 1;
      return target;
    });
    return oneUser(user);
  }),

  // ED-27: one role assignment at a time (apps/api/src/auth/users.service.ts addRoleAssignment)
  http.post('/v1/users/:id/role-assignments', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing || existing.archived_at) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    if (existing.role_assignments.length >= 20) {
      return conflict('A user can hold at most 20 role assignments.');
    }
    const errors = validateRoleAssignments([body], () => '');
    if (errors.length > 0) return validation(errors);
    const [added] = storedAssignments([body]);
    const same = (a: S['RoleAssignment']) =>
      a.role_id === added!.role_id &&
      a.scope_type === added!.scope_type &&
      a.company_id === added!.company_id &&
      a.location_id === added!.location_id;
    if (existing.role_assignments.some(same)) {
      return conflict('This user already holds this role with the same scope.');
    }
    const user = mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      target.role_assignments = [...target.role_assignments, added!];
      target.updated_at = nowIso();
      target._v += 1;
      return target;
    });
    return oneUser(user, 201);
  }),

  http.delete('/v1/users/:id/role-assignments/:assignmentId', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing || existing.archived_at) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const removed = existing.role_assignments.find((a) => a.id === params.assignmentId);
    if (!removed) return problem(404, 'not-found', 'Role assignment not found.');
    const draft: MockUserRecord = {
      ...existing,
      role_assignments: existing.role_assignments.filter((a) => a.id !== removed.id),
    };
    if (draft.role_assignments.length === 0) {
      return conflict(
        'A user needs at least one role assignment. Add another first, or disable or archive the user.',
      );
    }
    if (
      isActiveAdmin(existing) &&
      !isActiveAdmin(draft) &&
      registry().users.filter(isActiveAdmin).length <= 1
    ) {
      return conflict(
        'The last active administrator cannot be removed, demoted, disabled or archived.',
      );
    }
    // your own last administrator access: even when other administrators exist
    if (
      guard.user.email.toLowerCase() === existing.email.toLowerCase() &&
      isActiveAdmin(existing) &&
      !isActiveAdmin(draft)
    ) {
      return conflict(
        'You cannot remove your own last administrator access. Ask another administrator.',
      );
    }
    const user = mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      target.role_assignments = draft.role_assignments;
      target.updated_at = nowIso();
      target._v += 1;
      return target;
    });
    return oneUser(user);
  }),

  http.delete('/v1/users/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    if (isActiveAdmin(existing) && registry().users.filter(isActiveAdmin).length <= 1) {
      return problem(409, 'conflict', 'The last administrator cannot be removed or disabled');
    }
    mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      target.archived_at = nowIso();
      target.status = 'disabled';
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/v1/users/:id/invitation/resend', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    if (existing.status !== 'invited' || existing.archived_at) {
      return problem(409, 'conflict', 'This user has no pending invitation');
    }
    mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      target.invitation_expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString();
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('/v1/users/:id/invitation', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    if (existing.status !== 'invited' || existing.archived_at) {
      return problem(409, 'conflict', 'This user has no pending invitation');
    }
    mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      target.archived_at = nowIso();
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('/v1/users/:id/mfa', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const existing = registry().users.find((u) => u.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    if (existing.email.toLowerCase() === guard.user.email.toLowerCase()) {
      return problem(409, 'conflict', 'You cannot reset your own MFA here');
    }
    mutateRegistry((data) => {
      const target = data.users.find((u) => u.id === existing.id)!;
      target.mfa_enabled = false;
      target._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/v1/users/:id/sessions', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const user = registry().users.find((u) => u.id === params.id);
    if (!user) return problem(404, 'not-found', 'Not found');
    const now = Date.now();
    const sessions: S['SessionInfo'][] =
      user.status !== 'active'
        ? []
        : [
            {
              id: `${user.id.slice(0, -2)}s1`,
              created_at: new Date(now - 86_400_000).toISOString(),
              last_seen_at: new Date(now - 3_600_000).toISOString(),
              ip: '198.51.100.24',
              user_agent: 'Safari on iPhone',
              current: false,
            },
            {
              id: `${user.id.slice(0, -2)}s2`,
              created_at: new Date(now - 4 * 86_400_000).toISOString(),
              last_seen_at: new Date(now - 2 * 86_400_000).toISOString(),
              ip: '192.0.2.77',
              user_agent: 'Firefox on Linux',
              current: false,
            },
          ];
    return HttpResponse.json({ data: sessions.filter((s) => !revokedUserSessions.has(s.id)) });
  }),

  http.delete('/v1/users/:id/sessions/:sessionId', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    if (!registry().users.some((u) => u.id === params.id))
      return problem(404, 'not-found', 'Not found');
    revokedUserSessions.add(String(params.sessionId));
    return new HttpResponse(null, { status: 204 });
  }),
];

export const registryHandlers: HttpHandler[] = [
  ...categoryHandlers,
  ...fieldHandlers,
  ...statusHandlers,
  ...manufacturerHandlers,
  ...modelHandlers,
  ...vendorHandlers,
  ...tagTemplateHandlers,
  ...assetHandlers,
  searchHandler,
  ...userHandlers,
];
