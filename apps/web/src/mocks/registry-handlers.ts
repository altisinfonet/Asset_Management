import type { components } from '@assettracker/api-client';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, problem, requireSession } from './http';
import {
  MOCK_ROLES,
  formatTag,
  newResourceId,
  roleIdFor,
  type MockAsset,
  type MockUserRecord,
  type Rec,
  type RegistryData,
} from './registry-fixtures';
import { mutateRegistry, registry } from './registry-state';

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
type FieldError = { pointer: string; message: string; code?: string };
type Body = Record<string, unknown>;

const strip = <T extends { _v: number }>(record: T): Omit<T, '_v'> => {
  const { _v: _ignored, ...rest } = record;
  return rest;
};
const nowIso = () => new Date().toISOString();

function one<T extends { _v: number }>(
  record: T,
  status = 200,
  extra: Record<string, string> = {},
) {
  return HttpResponse.json(strip(record), {
    status,
    headers: { ETag: etagOf(record._v), ...extra },
  });
}

async function readBody(request: Request): Promise<Body | null> {
  const body = (await request.json().catch(() => null)) as unknown;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Body) : null;
}

function validation(errors: FieldError[]) {
  return problem(422, 'validation', 'Validation failed', { errors });
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// ---- listing: filters, sort, cursor ------------------------------------------------------------

interface ListConfig<T> {
  sorts: Record<string, (item: T) => string | number | null | undefined>;
  defaultSort: string;
  /** Free-text match for `q`. */
  haystack?: (item: T) => Array<string | null | undefined>;
  filter?: (item: T, params: URLSearchParams) => boolean;
}

const csv = (params: URLSearchParams, name: string): string[] =>
  (params.get(name) ?? '').split(',').filter(Boolean);

function paginate<T extends { id: string; archived_at?: string | null; _v: number }>(
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
      return problem(400, 'bad-request', 'Invalid cursor');
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
        const get = config.sorts[key.replace(/^-/, '')]!;
        const av = get(a) ?? '';
        const bv = get(b) ?? '';
        if (av === bv) continue;
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
  inUse?: (record: Rec<T>, data: RegistryData) => string | undefined;
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
      if (reason) return problem(409, 'conflict', 'The record is in use', { detail: reason });
      mutateRegistry((data) => {
        const target = config.collection(data).find((r) => r.id === existing.id)!;
        target.archived_at = nowIso();
        target._v += 1;
      });
      return new HttpResponse(null, { status: 204 });
    }),
  ];
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
    if (typeof body.tag_prefix === 'string' && !/^[A-Za-z0-9_-]{0,12}$/.test(body.tag_prefix)) {
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
    const assets = activeAssets(data).filter((a) => a.category_id === category.id).length;
    const models = data.models.filter(
      (m) => !m.archived_at && m.category_id === category.id,
    ).length;
    return assets + models > 0
      ? `Used by ${plural(assets, 'asset', 'assets')} and ${plural(models, 'model', 'models')}.`
      : undefined;
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
    return models > 0 ? `Used by ${plural(models, 'model', 'models')}.` : undefined;
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
    const assets = activeAssets(data).filter((a) => a.vendor_id === v.id).length;
    return assets > 0 ? `Used by ${plural(assets, 'asset', 'assets')}.` : undefined;
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
    const assets = activeAssets(data).filter((a) => a.model_id === m.id).length;
    return assets > 0 ? `Used by ${plural(assets, 'asset', 'assets')}.` : undefined;
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
    if (s.is_default) return 'This is the default label for new assets.';
    const assets = activeAssets(data).filter((a) => a.status_id === s.id).length;
    return assets > 0 ? `Used by ${plural(assets, 'asset', 'assets')}.` : undefined;
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

const locationHandlers: HttpHandler[] = [
  http.get('/v1/locations', ({ request }) => {
    const guard = requireSession(request, { permission: 'location:read' });
    if (!guard.ok) return guard.response;
    return paginate(request, registry().locations, {
      sorts: { name: (l) => l.name, depth: (l) => l.depth, created_at: (l) => l.created_at },
      defaultSort: 'depth,name',
      haystack: (l) => [l.name, l.code],
      filter: (l, p) =>
        (!p.get('parent_id') || l.parent_id === p.get('parent_id')) &&
        (p.get('root') !== 'true' || !l.parent_id),
    });
  }),
  http.get('/v1/locations/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'location:read' });
    if (!guard.ok) return guard.response;
    const found = registry().locations.find((l) => l.id === params.id);
    return found ? one(found) : problem(404, 'not-found', 'Not found');
  }),
];

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

function pushHistory(
  data: RegistryData,
  asset: MockAsset,
  event_type: S['HistoryEvent']['event_type'],
  summary: string,
  actorId?: string,
) {
  data.history.push({
    id: newResourceId('history'),
    asset_id: asset.id,
    at: nowIso(),
    event_type,
    actor_type: 'user',
    ...(actorId ? { actor_id: actorId } : {}),
    summary,
  });
}

function expandAsset(asset: MockAsset, expand: string[]): Record<string, unknown> {
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
  if (expand.includes('vendor') && asset.vendor_id) {
    const v = data.vendors.find((x) => x.id === asset.vendor_id);
    if (v) expanded.vendor = strip(v);
  }
  return {
    ...pub,
    status: status
      ? { id: status.id, name: status.name, state_type: status.state_type }
      : undefined,
    ...(expand.length > 0 ? { expanded } : {}),
  };
}

function oneAsset(
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
};

function assetFilter(a: MockAsset, p: URLSearchParams): boolean {
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
  if (p.get('location_id') && a.location_id !== p.get('location_id')) return false;
  if (p.get('vendor_id') && a.vendor_id !== p.get('vendor_id')) return false;
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

function allowedActions(asset: MockAsset): string[] {
  return asset.archived_at ? [] : ['update'];
}

const assetHandlers: HttpHandler[] = [
  http.get('/v1/assets', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const expand = csv(new URL(request.url).searchParams, 'expand');
    return paginate(
      request,
      registry().assets,
      {
        sorts: ASSET_SORTS,
        defaultSort: '-created_at',
        haystack: (a) => [a.asset_tag, a.serial, a.name, a.order_number],
        filter: assetFilter,
      },
      (a) => expandAsset(a, expand),
    );
  }),

  http.get('/v1/assets/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset) return problem(404, 'not-found', 'Not found');
    return oneAsset(asset, csv(new URL(request.url).searchParams, 'expand'));
  }),

  http.post('/v1/assets', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:create' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validateAssetBody(body, registry());
    if (Array.isArray(outcome) && outcome.length > 0) return validation(outcome);
    if (!Array.isArray(outcome)) {
      return problem(409, 'conflict', outcome.conflict, {
        errors: [{ pointer: outcome.pointer, message: outcome.conflict, code: 'unique' }],
      });
    }
    const asset = mutateRegistry((data) => {
      const category = data.categories.find((c) => c.id === body.category_id)!;
      let tag = text(body.asset_tag);
      if (!tag) {
        // Auto-numbering from the category prefix; skips numbers already taken.
        let n = data.tagCounters[category.id] ?? 1;
        const taken = new Set(data.assets.map((a) => a.asset_tag.toLowerCase()));
        while (taken.has(formatTag(category.tag_prefix, n).toLowerCase())) n += 1;
        tag = formatTag(category.tag_prefix, n);
        data.tagCounters[category.id] = n + 1;
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
      pushHistory(data, created, 'created', 'Created', guard.user.id);
      return created;
    });
    return oneAsset(asset, [], 201, { Location: `/v1/assets/${asset.id}` });
  }),

  http.patch('/v1/assets/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:update' });
    if (!guard.ok) return guard.response;
    const existing = registry().assets.find((a) => a.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const outcome = validateAssetBody(body, registry(), existing);
    if (Array.isArray(outcome) && outcome.length > 0) return validation(outcome);
    if (!Array.isArray(outcome)) {
      return problem(409, 'conflict', outcome.conflict, {
        errors: [{ pointer: outcome.pointer, message: outcome.conflict, code: 'unique' }],
      });
    }
    const asset = mutateRegistry((data) => {
      const target = data.assets.find((a) => a.id === existing.id)!;
      const before = { status: target.status_id, location: target.location_id };
      const simple = [
        'name',
        'serial',
        'order_number',
        'notes',
        'purchase_date',
        'warranty_end',
      ] as const;
      for (const key of simple)
        if (body[key] !== undefined)
          (target as Record<string, unknown>)[key] = text(body[key]) ?? null;
      if (body.asset_tag !== undefined && text(body.asset_tag))
        target.asset_tag = text(body.asset_tag)!;
      if (body.category_id !== undefined) target.category_id = body.category_id as string;
      if (body.model_id !== undefined) target.model_id = body.model_id as string | null;
      if (body.status_id !== undefined) target.status_id = body.status_id as string;
      if (body.location_id !== undefined) target.location_id = body.location_id as string | null;
      if (body.vendor_id !== undefined) target.vendor_id = body.vendor_id as string | null;
      if (body.purchase_cost !== undefined)
        target.purchase_cost = body.purchase_cost as S['Money'] | null;
      if (body.custom_data !== undefined) {
        const merged = { ...target.custom_data } as Record<string, unknown>;
        for (const [k, v] of Object.entries(body.custom_data as Record<string, unknown>)) {
          if (v === null || v === '') delete merged[k];
          else merged[k] = v;
        }
        target.custom_data = merged;
      }
      target.updated_at = nowIso();
      target._v += 1;
      pushHistory(data, target, 'updated', 'Updated', guard.user.id);
      if (target.status_id !== before.status) {
        const from = data.statusLabels.find((s) => s.id === before.status)?.name;
        const to = data.statusLabels.find((s) => s.id === target.status_id)?.name;
        pushHistory(data, target, 'status_changed', `Status ${from} -> ${to}`, guard.user.id);
      }
      if (target.location_id !== before.location) {
        pushHistory(data, target, 'location_changed', 'Location changed', guard.user.id);
      }
      return target;
    });
    return oneAsset(asset);
  }),

  http.delete('/v1/assets/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:delete' });
    if (!guard.ok) return guard.response;
    const existing = registry().assets.find((a) => a.id === params.id);
    if (!existing) return problem(404, 'not-found', 'Not found');
    const stale = checkIfMatch(request, existing._v);
    if (stale) return stale;
    if (existing.archived_at) return problem(409, 'conflict', 'The asset is already archived');
    mutateRegistry((data) => {
      const target = data.assets.find((a) => a.id === existing.id)!;
      target.archived_at = nowIso();
      target._v += 1;
      pushHistory(data, target, 'archived', 'Archived', guard.user.id);
    });
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
    const asset = mutateRegistry((data) => {
      const target = data.assets.find((a) => a.id === existing.id)!;
      target.archived_at = null;
      target._v += 1;
      pushHistory(data, target, 'restored', 'Restored', guard.user.id);
      return target;
    });
    return oneAsset(asset);
  }),

  http.get('/v1/assets/:id/history', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const asset = registry().assets.find((a) => a.id === params.id);
    if (!asset) return problem(404, 'not-found', 'Not found');
    const events = registry()
      .history.filter((e) => e.asset_id === asset.id)
      .map((e) => ({ ...e, _v: 0 }));
    return paginate(
      request,
      events,
      {
        sorts: { at: (e) => e.at },
        defaultSort: '-at',
        filter: (e, p) =>
          csv(p, 'event_type').length === 0 || csv(p, 'event_type').includes(e.event_type),
      },
      (e) => {
        const { _v: _ignored, ...pub } = e;
        return pub;
      },
    );
  }),

  http.get('/v1/scan/resolve', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const code = new URL(request.url).searchParams.get('code')?.trim().toLowerCase();
    const assets = registry().assets;
    const byLabel = assets.find((a) => a.label_code?.toLowerCase() === code);
    const found = byLabel ?? assets.find((a) => a.asset_tag.toLowerCase() === code);
    if (!found || !code) return problem(404, 'not-found', 'Nothing matches this code');
    return HttpResponse.json({
      match_type: byLabel ? 'label_code' : 'asset_tag',
      asset: expandAsset(found, []),
      allowed_actions: allowedActions(found),
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
const isActiveAdmin = (u: MockUserRecord) =>
  !u.archived_at &&
  u.status === 'active' &&
  u.role_assignments.some((r) => r.role_id === adminRoleId);

function validateRoleAssignments(value: unknown): FieldError[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ pointer: '/role_assignments', message: 'choose a role', code: 'required' }];
  }
  return value.flatMap((entry, i) =>
    MOCK_ROLES.some((r) => r.id === (entry as { role_id?: string }).role_id)
      ? []
      : [{ pointer: `/role_assignments/${i}/role_id`, message: 'unknown role', code: 'invalid' }],
  );
}

const publicUser = (u: MockUserRecord) => {
  const { _v: _v1, invitation_expires_at: _expires, ...pub } = u;
  return pub;
};

function oneUser(user: MockUserRecord, status = 200, extra: Record<string, string> = {}) {
  return HttpResponse.json(publicUser(user), {
    status,
    headers: { ETag: etagOf(user._v), ...extra },
  });
}

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
        role_assignments: body.role_assignments as S['RoleAssignment'][],
        mfa_enabled: false,
        last_login_at: null,
        invitation_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        _v: 1,
      } as MockUserRecord;
      data.users.push(created);
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
        ? { role_assignments: body.role_assignments as S['RoleAssignment'][] }
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
      if (body.role_assignments !== undefined)
        target.role_assignments = body.role_assignments as S['RoleAssignment'][];
      if (body.status !== undefined) target.status = body.status as 'active' | 'disabled';
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
  ...locationHandlers,
  ...assetHandlers,
  searchHandler,
  ...userHandlers,
];
