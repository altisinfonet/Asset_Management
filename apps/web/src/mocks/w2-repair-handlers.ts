import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, requireSession } from './http';
import {
  csv,
  nowIso,
  paginate,
  pushHistory,
  readBody,
  strip,
  validation,
  type Body,
  type FieldError,
  type ListConfig,
} from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import {
  checkMoney,
  checkText,
  checkUuids,
  fail,
  isUuid,
  missing,
  notFound,
  rejectUnknown,
  trimmed,
} from './w2-common';
import { mutateW2, newW2Id, w2, type MockRepair } from './w2-state';

/**
 * Mock handlers of the repair log of docs/engineering/openapi.yaml (`/v1/repairs`): list with the
 * filters, create (optionally moving the asset to an in-repair status and refusing a checked-out
 * asset), update, close (`/complete`, restoring the asset status) and archive. Opening and closing
 * write the asset's history (`repair_opened`, `repair_completed`) like the API does.
 */
const KINDS = ['repair', 'maintenance', 'inspection', 'upgrade'];
const STATUSES = ['open', 'in_progress', 'completed', 'cancelled'];

const CREATE_KEYS = [
  'asset_id',
  'kind',
  'title',
  'description',
  'reported_at',
  'started_at',
  'vendor_id',
  'performed_by_person_id',
  'ticket_ref',
  'cost',
  'restore_status_id',
  'status',
  'set_status_id',
] as const;
const UPDATE_KEYS = CREATE_KEYS.filter((k) => k !== 'set_status_id' && k !== 'asset_id');

const SORTS: ListConfig<MockRepair>['sorts'] = {
  reported_at: (r) => r.reported_at,
  completed_at: (r) => r.completed_at,
  created_at: (r) => r.created_at,
};

/** The repair with the tag and name of its asset (`asset_tag`, `asset_name`). */
function repairView(repair: MockRepair) {
  const asset = registry().assets.find((a) => a.id === repair.asset_id);
  return { ...strip(repair), asset_tag: asset?.asset_tag ?? null, asset_name: asset?.name ?? null };
}

const isInstant = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function checkInstant(body: Body, key: string, nullable: boolean): FieldError[] {
  const value = body[key];
  if (value === undefined || (value === null && nullable)) return [];
  return isInstant(value)
    ? []
    : [{ pointer: `/${key}`, message: 'Invalid date-time', code: 'invalid_format' }];
}

function validateBody(body: Body, creating: boolean): FieldError[] {
  const errors = [
    ...rejectUnknown(body, creating ? CREATE_KEYS : UPDATE_KEYS),
    ...checkText(body, 'title', { min: 1, max: 200, required: creating }),
    ...checkText(body, 'description', { max: 4000, nullable: true }),
    ...checkText(body, 'ticket_ref', { max: 100, nullable: true }),
    ...checkUuids(
      body,
      ['asset_id', 'vendor_id', 'performed_by_person_id', 'restore_status_id', 'set_status_id'],
      ['vendor_id', 'performed_by_person_id', 'restore_status_id'],
    ),
    ...checkInstant(body, 'reported_at', false),
    ...checkInstant(body, 'started_at', true),
    ...checkMoney(body, 'cost'),
  ];
  if (creating && body.asset_id === undefined) {
    errors.push({ pointer: '/asset_id', message: 'Invalid input: expected string', code: 'invalid_type' });
  }
  if (body.kind !== undefined && !KINDS.includes(String(body.kind))) {
    errors.push({ pointer: '/kind', message: 'Invalid option', code: 'invalid_value' });
  }
  if (body.status !== undefined && !['open', 'in_progress', 'cancelled'].includes(String(body.status))) {
    errors.push({ pointer: '/status', message: 'Invalid option', code: 'invalid_value' });
  }
  const data = registry();
  if (isUuid(body.vendor_id) && !data.vendors.some((v) => v.id === body.vendor_id)) {
    errors.push(missing('/vendor_id', 'No such vendor.'));
  }
  for (const key of ['restore_status_id', 'set_status_id']) {
    if (isUuid(body[key]) && !data.statusLabels.some((s) => s.id === body[key] && !s.archived_at)) {
      errors.push(missing(`/${key}`, 'No such status.'));
    }
  }
  return errors;
}

/** Puts the asset in `statusId` (inside `mutateRegistry`); returns the previous status. */
function setAssetStatus(assetId: string, statusId: string): string | null {
  return mutateRegistry((data) => {
    const asset = data.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    const previous = asset.status_id;
    asset.status_id = statusId;
    asset._v += 1;
    asset.updated_at = nowIso();
    return previous;
  });
}

function repairHistory(
  assetId: string,
  type: 'repair_opened' | 'repair_completed',
  summary: string,
  actorId: string,
  payload: Record<string, unknown>,
) {
  mutateRegistry((data) => {
    const asset = data.assets.find((a) => a.id === assetId);
    if (asset) pushHistory(data, asset, type, summary, actorId, payload);
  });
}

export const repairHandlers: HttpHandler[] = [
  http.get('/v1/repairs', ({ request }) => {
    const guard = requireSession(request, { permission: 'repair:read' });
    if (!guard.ok) return guard.response;
    const params = new URL(request.url).searchParams;
    const statuses = csv(params, 'status');
    const kinds = csv(params, 'kind');
    if (statuses.some((s) => !STATUSES.includes(s)) || kinds.some((k) => !KINDS.includes(k))) {
      return fail('bad-request', { detail: 'Unsupported status or kind filter' });
    }
    return paginate(
      request,
      w2().repairs,
      {
        sorts: SORTS,
        defaultSort: '-reported_at',
        filter: (r, p) => {
          if (p.get('asset_id') && r.asset_id !== p.get('asset_id')) return false;
          if (statuses.length > 0 && !statuses.includes(r.status ?? '')) return false;
          if (kinds.length > 0 && !kinds.includes(r.kind ?? 'repair')) return false;
          if (p.get('vendor_id') && r.vendor_id !== p.get('vendor_id')) return false;
          const from = p.get('reported_from');
          if (from && (r.reported_at ?? '') < from) return false;
          const to = p.get('reported_to');
          if (to && (r.reported_at ?? '') >= to) return false;
          return true;
        },
      },
      repairView,
    );
  }),

  http.post('/v1/repairs', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'repair:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateBody(body, true);
    if (errors.length > 0) return validation(errors);
    const asset = registry().assets.find((a) => a.id === body.asset_id && !a.archived_at);
    if (!asset) return validation([missing('/asset_id', 'No such asset.')]);
    if (asset.current_assignment) {
      return fail('conflict', {
        detail: `${asset.asset_tag} is checked out. Check it in before opening a repair.`,
        errors: [{ pointer: '/asset_id', message: 'The asset is checked out.', code: 'checked-out' }],
      });
    }
    const setStatus = body.set_status_id as string | undefined;
    const created = mutateW2((data) => {
      const stamp = nowIso();
      const repair: MockRepair = {
        id: newW2Id('repair'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        asset_id: asset.id,
        kind: (body.kind as MockRepair['kind']) ?? 'repair',
        title: String(body.title).trim(),
        description: trimmed(body.description),
        reported_at: (body.reported_at as string | undefined) ?? stamp,
        started_at: (body.started_at as string | null | undefined) ?? null,
        vendor_id: (body.vendor_id as string | null | undefined) ?? null,
        performed_by_person_id: (body.performed_by_person_id as string | null | undefined) ?? null,
        ticket_ref: trimmed(body.ticket_ref),
        cost: (body.cost as MockRepair['cost']) ?? null,
        // the status the asset had before, unless the caller said where it goes afterwards
        restore_status_id: (body.restore_status_id as string | null | undefined) ?? asset.status_id,
        status: (body.status as MockRepair['status']) ?? 'open',
        completed_at: null,
        resolution_notes: null,
        _v: 1,
      };
      data.repairs.push(repair);
      return repair;
    });
    if (setStatus) setAssetStatus(asset.id, setStatus);
    repairHistory(asset.id, 'repair_opened', `Repair opened: ${created.title}`, guard.user.id, {
      repair_id: created.id,
    });
    return HttpResponse.json(repairView(created), {
      status: 201,
      headers: { ETag: etagOf(created._v), Location: `/v1/repairs/${created.id}` },
    });
  }),

  http.get('/v1/repairs/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'repair:read' });
    if (!guard.ok) return guard.response;
    const found = w2().repairs.find((r) => r.id === params.id);
    if (!found) return notFound('Repair');
    return HttpResponse.json(repairView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.patch('/v1/repairs/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'repair:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().repairs.find((r) => r.id === params.id && !r.archived_at);
    if (!found) return notFound('Repair');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateBody(body, false);
    if (errors.length > 0) return validation(errors);
    if ((found.status === 'completed' || found.status === 'cancelled') && body.status !== undefined) {
      return fail('conflict', { detail: 'A closed repair cannot be reopened.' });
    }
    const cancelling = body.status === 'cancelled' && found.status !== 'cancelled';
    mutateW2(() => {
      for (const key of UPDATE_KEYS) {
        if (body[key] === undefined) continue;
        const value = typeof body[key] === 'string' ? (body[key] as string).trim() || null : body[key];
        (found as Record<string, unknown>)[key] = key === 'title' ? String(body[key]).trim() : value;
      }
      if (body.status === 'in_progress' && !found.started_at) found.started_at = nowIso();
      if (cancelling) found.completed_at = nowIso();
      found.updated_at = nowIso();
      found._v += 1;
    });
    if (cancelling && found.restore_status_id) setAssetStatus(found.asset_id, found.restore_status_id);
    return HttpResponse.json(repairView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.post('/v1/repairs/:id/complete', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'repair:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().repairs.find((r) => r.id === params.id && !r.archived_at);
    if (!found) return notFound('Repair');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const raw = await request.text();
    let body: Body = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
        body = parsed as Body;
      } catch {
        return fail('bad-request', { detail: 'Malformed JSON body' });
      }
    }
    const errors = [
      ...rejectUnknown(body, ['completed_at', 'resolution_notes', 'cost', 'restore_status_id']),
      ...checkInstant(body, 'completed_at', false),
      ...checkText(body, 'resolution_notes', { max: 4000 }),
      ...checkMoney(body, 'cost'),
      ...checkUuids(body, ['restore_status_id'], ['restore_status_id']),
    ];
    if (isUuid(body.restore_status_id) && !registry().statusLabels.some((s) => s.id === body.restore_status_id)) {
      errors.push(missing('/restore_status_id', 'No such status.'));
    }
    if (errors.length > 0) return validation(errors);
    if (found.status === 'completed' || found.status === 'cancelled') {
      return fail('conflict', { detail: 'This repair is already closed.' });
    }
    const restore = (body.restore_status_id as string | null | undefined) ?? found.restore_status_id;
    mutateW2(() => {
      found.status = 'completed';
      found.completed_at = (body.completed_at as string | undefined) ?? nowIso();
      if (body.resolution_notes !== undefined) found.resolution_notes = trimmed(body.resolution_notes);
      if (body.cost !== undefined) found.cost = body.cost as MockRepair['cost'];
      if (restore) found.restore_status_id = restore;
      found.updated_at = nowIso();
      found._v += 1;
    });
    if (restore) setAssetStatus(found.asset_id, restore);
    repairHistory(found.asset_id, 'repair_completed', `Repair completed: ${found.title}`, guard.user.id, {
      repair_id: found.id,
    });
    return HttpResponse.json(repairView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.delete('/v1/repairs/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'repair:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().repairs.find((r) => r.id === params.id && !r.archived_at);
    if (!found) return notFound('Repair');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    mutateW2(() => {
      found.archived_at = nowIso();
      found._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
