import { http, HttpResponse, type HttpHandler } from 'msw';
import { etagOf, requireSession } from './http';
import { fail, notFound, pushEvent, statusName } from './m2-handlers';
import type { MockAsset, MockStatus, RegistryData } from './registry-fixtures';
import { expandAsset, readBody, text, validation } from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import { inScope, scopedLocationErrors } from './scope';
import { w2 } from './w2-state';

/**
 * The lifecycle actions of M2-LIFE-05 (`POST /v1/assets/{id}/mark-lost`, `mark-found`, `dispose`),
 * following `registry/assets.facade.ts` of the API: the state machine of `asset-actions.ts`, the
 * optional `If-Match`, the custody period that mark-lost closes, and the refusals of dispose (checked
 * out, an open repair, accessory units still checked out to the asset).
 */

type Body = Record<string, unknown>;
type StateType = MockStatus['state_type'];

const REASONS = [
  'sold',
  'donated',
  'recycled',
  'scrapped',
  'stolen',
  'returned_to_vendor',
  'other',
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const stateOf = (asset: MockAsset): StateType =>
  registry().statusLabels.find((s) => s.id === asset.status_id)?.state_type ?? 'deployable';

/** The asset (in the caller's scope) and the optional `If-Match`, or the answer to give instead. */
function load(request: Request, id: string, scope: string[] | null) {
  const asset = registry().assets.find((a) => a.id === id);
  if (!asset || !inScope(scope, asset.location_id)) return { response: notFound('Asset') };
  const ifMatch = request.headers.get('if-match');
  if (ifMatch && ifMatch !== etagOf(asset._v)) {
    return {
      response: fail('precondition-failed', {
        detail: `The resource has changed (current ETag ${etagOf(asset._v)}). Re-read it and retry.`,
      }),
    };
  }
  if (asset.archived_at) {
    return { response: fail('conflict', { detail: 'The asset is archived. Restore it first.' }) };
  }
  return { asset };
}

/** The status the action sets: the chosen one (it must be of the type) or the first of the type. */
function statusFor(
  stateType: StateType,
  chosen: unknown,
  preferDefault = false,
): MockStatus | { response: Response } {
  const labels = registry()
    .statusLabels.filter((s) => s.state_type === stateType && !s.archived_at)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
  if (typeof chosen === 'string') {
    const label = labels.find((s) => s.id === chosen);
    return (
      label ?? {
        response: validation([
          {
            pointer: '/status_id',
            message: `Not an active status label of type "${stateType}".`,
            code: 'invalid',
          },
        ]),
      }
    );
  }
  const label = (preferDefault ? labels.find((s) => s.is_default) : undefined) ?? labels[0];
  return (
    label ?? {
      response: fail('conflict', {
        detail: `The tenant has no active status label of type "${stateType}". Create one in the status labels first.`,
      }),
    }
  );
}

const answer = (asset: MockAsset) =>
  HttpResponse.json(expandAsset(asset, []), { headers: { ETag: etagOf(asset._v) } });

function unknownKeys(body: Body, allowed: string[]) {
  return Object.keys(body)
    .filter((k) => !allowed.includes(k))
    .map((k) => ({ pointer: `/${k}`, message: 'Unrecognized key', code: 'unrecognized_keys' }));
}

function setStatus(data: RegistryData, asset: MockAsset, status: MockStatus) {
  const live = data.assets.find((a) => a.id === asset.id)!;
  const from = { id: live.status_id, name: statusName(live.status_id) };
  live.status_id = status.id;
  live.updated_at = new Date().toISOString();
  live._v += 1;
  return { live, from };
}

export const lifecycleHandlers: HttpHandler[] = [
  http.post('/v1/assets/:id/mark-lost', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:update' });
    if (!guard.ok) return guard.response;
    const body = (await readBody(request)) ?? {};
    const bad = unknownKeys(body, ['note', 'status_id']);
    if (bad.length > 0) return validation(bad);
    const loaded = load(request, String(params.id), guard.user.locationScope);
    if ('response' in loaded) return loaded.response;
    const { asset } = loaded;
    if (stateOf(asset) === 'lost') {
      return fail('conflict', { detail: 'The asset is already marked lost.' });
    }
    const status = statusFor('lost', body.status_id);
    if ('response' in status) return status.response;
    const note = text(body.note);
    const result = mutateRegistry((data) => {
      const { live, from } = setStatus(data, asset, status);
      let assignmentId: string | null = null;
      if (live.current_assignment) {
        const open = data.assignments.find((a) => a.asset_id === live.id && !a.checked_in_at);
        if (open) {
          open.checked_in_at = new Date().toISOString();
          open.checked_in_by = guard.user.id;
          open.quantity_returned = open.quantity;
          open.checkin_note = note ? `Marked lost: ${note}` : 'Marked lost';
          open._v += 1;
          assignmentId = open.id;
        }
        live.current_assignment = null;
      }
      pushEvent(
        data,
        live,
        'status_changed',
        `Marked lost${note ? `: ${note}` : ''}`,
        guard.user.id,
        { assignmentId },
        {
          action: 'lost',
          from: from.id,
          to: status.id,
          from_name: from.name,
          to_name: status.name,
          ...(note ? { note } : {}),
        },
      );
      return live;
    });
    return answer(result);
  }),

  http.post('/v1/assets/:id/mark-found', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:update' });
    if (!guard.ok) return guard.response;
    const body = (await readBody(request)) ?? {};
    const bad = unknownKeys(body, ['note', 'status_id', 'location_id']);
    if (bad.length > 0) return validation(bad);
    const loaded = load(request, String(params.id), guard.user.locationScope);
    if ('response' in loaded) return loaded.response;
    const { asset } = loaded;
    if (stateOf(asset) !== 'lost') {
      return fail('conflict', { detail: 'The asset is not marked lost.' });
    }
    const status = statusFor('deployable', body.status_id, true);
    if ('response' in status) return status.response;
    if (body.location_id !== undefined) {
      const outside = scopedLocationErrors(
        guard.user.locationScope,
        body.location_id,
        '/location_id',
        false,
      );
      if (outside.length > 0) return validation(outside);
      if (
        typeof body.location_id === 'string' &&
        !registry().locations.some((l) => l.id === body.location_id && !l.archived_at)
      ) {
        return validation([
          { pointer: '/location_id', message: 'No such location.', code: 'not-found' },
        ]);
      }
    }
    const note = text(body.note);
    const result = mutateRegistry((data) => {
      const { live, from } = setStatus(data, asset, status);
      if (body.location_id !== undefined) live.location_id = (body.location_id as string) ?? null;
      pushEvent(
        data,
        live,
        'status_changed',
        `Marked found${note ? `: ${note}` : ''}`,
        guard.user.id,
        {},
        {
          action: 'found',
          from: from.id,
          to: status.id,
          from_name: from.name,
          to_name: status.name,
          ...(note ? { note } : {}),
        },
      );
      return live;
    });
    return answer(result);
  }),

  http.post('/v1/assets/:id/dispose', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:delete' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = unknownKeys(body, ['reason', 'note', 'disposed_on', 'status_id']);
    if (!REASONS.includes(String(body.reason))) {
      errors.push({
        pointer: '/reason',
        message: `Invalid option: expected one of ${REASONS.map((r) => `"${r}"`).join('|')}`,
        code: 'invalid_value',
      });
    }
    if (body.disposed_on !== undefined && !ISO_DATE.test(String(body.disposed_on))) {
      errors.push({ pointer: '/disposed_on', message: 'Invalid date', code: 'invalid_format' });
    }
    if (typeof body.note === 'string' && body.note.length > 2000) {
      errors.push({ pointer: '/note', message: 'Too long', code: 'too_big' });
    }
    if (errors.length > 0) return validation(errors);
    const loaded = load(request, String(params.id), guard.user.locationScope);
    if ('response' in loaded) return loaded.response;
    const { asset } = loaded;
    if (asset.current_assignment) {
      return fail('asset-already-checked-out', {
        detail: 'The asset is checked out. Check it in before disposing of it.',
      });
    }
    const stock = w2();
    if (
      stock.repairs.some(
        (r) => r.asset_id === asset.id && (r.status === 'open' || r.status === 'in_progress'),
      )
    ) {
      return fail('conflict', {
        detail: 'The asset has an open repair. Complete or cancel it before disposing of it.',
      });
    }
    const held = stock.handouts.filter((h) => h.target_asset_id === asset.id && !h.checked_in_at);
    if (held.length > 0) {
      const units = held.reduce((sum, h) => sum + (h.quantity - (h.quantity_returned ?? 0)), 0);
      return fail('conflict', {
        detail: `${units} accessory unit(s) in ${held.length} open assignment(s) are checked out to this asset. Check them in before disposing of it.`,
        usage: { accessory_assignments: held.length, units },
      });
    }
    const status = statusFor('archived', body.status_id);
    if ('response' in status) return status.response;
    const disposal = {
      disposed_on:
        (body.disposed_on as string | undefined) ?? new Date().toISOString().slice(0, 10),
      reason: body.reason as NonNullable<MockAsset['disposal']>['reason'],
      note: text(body.note) ?? null,
    };
    const result = mutateRegistry((data) => {
      const { live, from } = setStatus(data, asset, status);
      live.archived_at = new Date().toISOString();
      live.disposal = disposal;
      pushEvent(
        data,
        live,
        'archived',
        `Disposed of (${disposal.reason})`,
        guard.user.id,
        {},
        { disposal, from: from.id, to: status.id, from_name: from.name, to_name: status.name },
      );
      return live;
    });
    return answer(result);
  }),
];
