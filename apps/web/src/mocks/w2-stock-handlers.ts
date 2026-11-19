import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, requireSession } from './http';
import {
  nowIso,
  paginate,
  readBody,
  strip,
  validation,
  type Body,
  type FieldError,
  type ListConfig,
} from './registry-handlers';
import { registry } from './registry-state';
import {
  checkDate,
  checkInt,
  checkText,
  checkUuids,
  fail,
  idempotent,
  isUuid,
  missing,
  notFound,
  rejectUnknown,
  trimmed,
} from './w2-common';
import {
  labelCode,
  mutateW2,
  newW2Id,
  notify,
  w2,
  type MockAccessory,
  type MockConsumable,
  type MockHandout,
  type MockStockMovement,
  type W2Data,
} from './w2-state';

/**
 * Mock handlers of accessories (quantity hand-outs with partial returns) and consumables (an
 * append-only stock ledger) of docs/engineering/openapi.yaml: lists with the low-stock filter,
 * create / update / archive with `If-Match`, check-out and check-in with `Idempotency-Key`, and the
 * movements. Stock never goes negative and a hand-out never exceeds what is available.
 */

// ---- derived quantities ----------------------------------------------------------------------------

const outstanding = (h: MockHandout) => h.quantity - h.quantity_returned;
const openHandouts = (data: W2Data, accessoryId: string) =>
  data.handouts.filter((h) => h.accessory_id === accessoryId && !h.checked_in_at);

function accessoryView(a: MockAccessory) {
  const out = openHandouts(w2(), a.id).reduce((sum, h) => sum + outstanding(h), 0);
  const available = a.qty_total - out;
  return {
    ...strip(a),
    qty_checked_out: out,
    qty_available: available,
    low_stock: isLow(available, a.min_qty ?? 0),
  };
}

/** The consumable as the API shows it: `low_stock` is derived from the stock and the minimum. */
function consumableView(c: MockConsumable) {
  return { ...strip(c), low_stock: isLow(c.qty_on_hand, c.min_qty ?? 0) };
}

/** Low stock: a minimum is set (> 0) and the quantity is at or below it. */
const isLow = (available: number, min: number) => min > 0 && available <= min;

/** An assignment of an accessory with the names the API adds to its lists. */
function assignmentView(h: MockHandout, accessoryName: string) {
  const data = registry();
  const target = h.person_id
    ? data.people.find((p) => p.id === h.person_id)?.display_name
    : h.location_id
      ? data.locations.find((l) => l.id === h.location_id)?.name
      : (() => {
          const asset = data.assets.find((a) => a.id === h.target_asset_id);
          return asset
            ? asset.name
              ? `${asset.asset_tag} ${asset.name}`
              : asset.asset_tag
            : undefined;
        })();
  return { ...strip(h), accessory_name: accessoryName, target_name: target ?? null };
}

// ---- accessories --------------------------------------------------------------------------------------

const ACCESSORY_KEYS = [
  'category_id',
  'name',
  'manufacturer_id',
  'vendor_id',
  'location_id',
  'company_id',
  'model_number',
  'qty_total',
  'min_qty',
  'purchase_date',
  'purchase_cost',
  'notes',
] as const;

const ACCESSORY_SORTS: ListConfig<MockAccessory>['sorts'] = {
  name: (a) => a.name,
  qty_total: (a) => a.qty_total,
  qty_available: (a) => accessoryView(a).qty_available,
  created_at: (a) => a.created_at,
};

function validateRefs(body: Body, kind: 'accessory' | 'consumable'): FieldError[] {
  const data = registry();
  const errors = checkUuids(
    body,
    ['category_id', 'manufacturer_id', 'vendor_id', 'location_id'],
    ['manufacturer_id', 'vendor_id', 'location_id'],
  );
  if (errors.length > 0) return errors;
  if (body.category_id !== undefined) {
    const category = data.categories.find((c) => c.id === body.category_id);
    if (!category) errors.push(missing('/category_id', 'No such category.'));
    else if (category.kind !== kind) {
      errors.push({
        pointer: '/category_id',
        message: `Choose a category of kind "${kind}".`,
        code: 'wrong-kind',
      });
    }
  }
  if (body.manufacturer_id && !data.manufacturers.some((m) => m.id === body.manufacturer_id)) {
    errors.push(missing('/manufacturer_id', 'No such manufacturer.'));
  }
  if (body.vendor_id && !data.vendors.some((v) => v.id === body.vendor_id)) {
    errors.push(missing('/vendor_id', 'No such vendor.'));
  }
  if (body.location_id && !data.locations.some((l) => l.id === body.location_id)) {
    errors.push(missing('/location_id', 'No such location.'));
  }
  return errors;
}

function validateAccessory(body: Body, creating: boolean): FieldError[] {
  const errors = [
    ...rejectUnknown(body, ACCESSORY_KEYS),
    ...checkText(body, 'name', { min: 1, max: 200, required: creating }),
    ...checkText(body, 'model_number', { max: 200, nullable: true }),
    ...checkText(body, 'notes', { max: 4000, nullable: true }),
    ...checkInt(body, 'qty_total', { min: 0, required: creating }),
    ...checkInt(body, 'min_qty', { min: 0 }),
    ...checkDate(body, 'purchase_date'),
  ];
  if (creating && body.category_id === undefined) {
    errors.push({
      pointer: '/category_id',
      message: 'Invalid input: expected string',
      code: 'invalid_type',
    });
  }
  return [...errors, ...validateRefs(body, 'accessory')];
}

const accessoryHandlers: HttpHandler[] = [
  http.get('/v1/accessories', ({ request }) => {
    const guard = requireSession(request, { permission: 'accessory:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      w2().accessories,
      {
        sorts: ACCESSORY_SORTS,
        defaultSort: 'name',
        haystack: (a) => [a.name, a.model_number],
        filter: (a, p) => {
          if (p.get('category_id') && a.category_id !== p.get('category_id')) return false;
          if (p.get('location_id') && a.location_id !== p.get('location_id')) return false;
          if (p.get('low_stock') === 'true') {
            if (!isLow(accessoryView(a).qty_available, a.min_qty ?? 0)) return false;
          }
          return true;
        },
      },
      (a) => accessoryView(a),
    );
  }),

  http.post('/v1/accessories', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'accessory:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateAccessory(body, true);
    if (errors.length > 0) return validation(errors);
    const created = mutateW2((data) => {
      const stamp = nowIso();
      const accessory: MockAccessory = {
        id: newW2Id('accessory'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        category_id: String(body.category_id),
        name: String(body.name).trim(),
        manufacturer_id: (body.manufacturer_id as string | null | undefined) ?? null,
        vendor_id: (body.vendor_id as string | null | undefined) ?? null,
        location_id: (body.location_id as string | null | undefined) ?? null,
        model_number: trimmed(body.model_number),
        qty_total: body.qty_total as number,
        min_qty: (body.min_qty as number | undefined) ?? 0,
        purchase_date: (body.purchase_date as string | null | undefined) ?? null,
        purchase_cost: (body.purchase_cost as MockAccessory['purchase_cost']) ?? null,
        notes: trimmed(body.notes),
        label_code: '',
        _v: 1,
      };
      accessory.label_code = labelCode('accessory', accessory.id);
      data.accessories.push(accessory);
      return accessory;
    });
    return HttpResponse.json(accessoryView(created), {
      status: 201,
      headers: { ETag: etagOf(created._v), Location: `/v1/accessories/${created.id}` },
    });
  }),

  http.get('/v1/accessories/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'accessory:read' });
    if (!guard.ok) return guard.response;
    const found = w2().accessories.find((a) => a.id === params.id);
    if (!found) return notFound('Accessory');
    return HttpResponse.json(accessoryView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.patch('/v1/accessories/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'accessory:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().accessories.find((a) => a.id === params.id && !a.archived_at);
    if (!found) return notFound('Accessory');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateAccessory(body, false);
    const out = accessoryView(found).qty_checked_out;
    if (typeof body.qty_total === 'number' && body.qty_total < out) {
      errors.push({
        pointer: '/qty_total',
        message: `Cannot be lower than the ${out} units that are checked out.`,
        code: 'below-checked-out',
      });
    }
    if (errors.length > 0) return validation(errors);
    mutateW2(() => {
      for (const key of ACCESSORY_KEYS) {
        if (body[key] === undefined) continue;
        const value =
          typeof body[key] === 'string' ? (body[key] as string).trim() || null : body[key];
        (found as Record<string, unknown>)[key] = key === 'name' ? String(body[key]).trim() : value;
      }
      found.updated_at = nowIso();
      found._v += 1;
    });
    return HttpResponse.json(accessoryView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.delete('/v1/accessories/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'accessory:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().accessories.find((a) => a.id === params.id && !a.archived_at);
    if (!found) return notFound('Accessory');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const open = openHandouts(w2(), found.id).length;
    if (open > 0) {
      return fail('conflict', {
        detail: `${found.name} is in use (open_assignments: ${open}) and cannot be deleted.`,
        usage: { open_assignments: open },
      });
    }
    mutateW2(() => {
      found.archived_at = nowIso();
      found._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('/v1/accessories/:id/checkout', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'accessory:checkout' });
    if (!guard.ok) return guard.response;
    const found = w2().accessories.find((a) => a.id === params.id && !a.archived_at);
    if (!found) return notFound('Accessory');
    const text = await request.clone().text();
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, [
        'person_id',
        'location_id',
        'target_asset_id',
        'quantity',
        'expected_return',
        'note',
      ]),
      ...checkUuids(body, ['person_id', 'location_id', 'target_asset_id']),
      ...checkInt(body, 'quantity', { min: 1 }),
      ...checkDate(body, 'expected_return', false),
      ...checkText(body, 'note', { max: 2000 }),
    ];
    const targets = ['person_id', 'location_id', 'target_asset_id'].filter(
      (k) => body[k] !== undefined,
    );
    if (targets.length !== 1) {
      errors.push({
        pointer: '/',
        message: 'Choose exactly one of person_id, location_id or target_asset_id.',
        code: 'one-target',
      });
    }
    const data = registry();
    if (
      isUuid(body.person_id) &&
      !data.people.some((p) => p.id === body.person_id && p.status !== 'inactive')
    ) {
      errors.push(missing('/person_id', 'No such active person.'));
    }
    if (isUuid(body.location_id) && !data.locations.some((l) => l.id === body.location_id)) {
      errors.push(missing('/location_id', 'No such location.'));
    }
    if (isUuid(body.target_asset_id) && !data.assets.some((a) => a.id === body.target_asset_id)) {
      errors.push(missing('/target_asset_id', 'No such asset.'));
    }
    if (errors.length > 0) return validation(errors);

    return idempotent(request, w2(), `${request.method} ${text}`, () => {
      const quantity = (body.quantity as number | undefined) ?? 1;
      const available = accessoryView(found).qty_available;
      if (quantity > available) {
        return fail('insufficient-stock', {
          detail: `Only ${available} of ${found.name} are available; ${quantity} were requested.`,
        });
      }
      const handout = mutateW2((state) => {
        const row: MockHandout = {
          id: newW2Id('handout'),
          asset_id: null,
          accessory_id: found.id,
          person_id: (body.person_id as string | undefined) ?? null,
          location_id: (body.location_id as string | undefined) ?? null,
          target_asset_id: (body.target_asset_id as string | undefined) ?? null,
          quantity,
          quantity_returned: 0,
          loaner_pool_id: null,
          checked_out_at: nowIso(),
          checked_out_by: guard.user.id,
          expected_return: (body.expected_return as string | undefined) ?? null,
          checked_in_at: null,
          checked_in_by: null,
          checkin_location_id: null,
          acceptance_state: 'not_required',
          note: trimmed(body.note),
          checkin_note: null,
          checkin_condition: null,
          attachment_ids: [],
          checkin_attachment_ids: [],
          overdue: false,
          _v: 1,
        };
        state.handouts.push(row);
        return row;
      });
      return {
        status: 201,
        body: assignmentView(handout, found.name),
        headers: { Location: `/v1/accessories/${found.id}/assignments` },
      };
    });
  }),

  http.post('/v1/accessories/:id/checkin', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'accessory:checkout' });
    if (!guard.ok) return guard.response;
    const found = w2().accessories.find((a) => a.id === params.id && !a.archived_at);
    if (!found) return notFound('Accessory');
    const text = await request.clone().text();
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['assignment_id', 'quantity', 'note']),
      ...checkUuids(body, ['assignment_id']),
      ...checkInt(body, 'quantity', { min: 1 }),
      ...checkText(body, 'note', { max: 2000 }),
    ];
    if (body.assignment_id === undefined) {
      errors.push({
        pointer: '/assignment_id',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    const handout = w2().handouts.find(
      (h) => h.id === body.assignment_id && h.accessory_id === found.id,
    );
    if (!handout) return notFound('Assignment');
    return idempotent(request, w2(), `${request.method} ${text}`, () => {
      const left = outstanding(handout);
      if (left < 1) {
        return fail('conflict', { detail: 'This assignment has already been returned in full.' });
      }
      const quantity = (body.quantity as number | undefined) ?? left;
      if (quantity > left) {
        return validation([
          {
            pointer: '/quantity',
            message: `Only ${left} units are still out.`,
            code: 'too-many',
          },
        ]);
      }
      mutateW2(() => {
        handout.quantity_returned += quantity;
        handout.checkin_note = trimmed(body.note) ?? handout.checkin_note;
        if (handout.quantity_returned >= handout.quantity) {
          handout.checked_in_at = nowIso();
          handout.checked_in_by = guard.user.id;
        }
        handout._v += 1;
      });
      return { status: 200, body: assignmentView(handout, found.name) };
    });
  }),

  http.get('/v1/accessories/:id/assignments', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'accessory:read' });
    if (!guard.ok) return guard.response;
    const found = w2().accessories.find((a) => a.id === params.id);
    if (!found) return notFound('Accessory');
    const state = new URL(request.url).searchParams.get('state') ?? 'open';
    if (!['open', 'closed', 'all'].includes(state)) {
      return fail('bad-request', { detail: 'state must be open, closed or all' });
    }
    const rows = w2()
      .handouts.filter((h) => h.accessory_id === found.id)
      .filter((h) => state === 'all' || (state === 'open') === !h.checked_in_at)
      .map((h) => ({ ...h, archived_at: null }));
    return paginate(
      request,
      rows,
      {
        sorts: { checked_out_at: (h) => h.checked_out_at },
        defaultSort: '-checked_out_at',
      },
      (h) => {
        const { archived_at: _archived, ...rest } = h;
        return assignmentView(rest, found.name);
      },
    );
  }),
];

// ---- consumables ------------------------------------------------------------------------------------------

const CONSUMABLE_KEYS = [
  'category_id',
  'name',
  'manufacturer_id',
  'vendor_id',
  'location_id',
  'company_id',
  'model_number',
  'unit',
  'min_qty',
  'unit_cost',
  'notes',
] as const;

const CONSUMABLE_SORTS: ListConfig<MockConsumable>['sorts'] = {
  name: (c) => c.name,
  qty_on_hand: (c) => c.qty_on_hand,
  created_at: (c) => c.created_at,
};

function validateConsumable(body: Body, creating: boolean): FieldError[] {
  const errors = [
    ...rejectUnknown(body, creating ? [...CONSUMABLE_KEYS, 'initial_qty'] : CONSUMABLE_KEYS),
    ...checkText(body, 'name', { min: 1, max: 200, required: creating }),
    ...checkText(body, 'unit', { min: 1, max: 40 }),
    ...checkText(body, 'model_number', { max: 200, nullable: true }),
    ...checkText(body, 'notes', { max: 4000, nullable: true }),
    ...checkInt(body, 'min_qty', { min: 0 }),
    ...(creating ? checkInt(body, 'initial_qty', { min: 0 }) : []),
  ];
  if (creating && body.category_id === undefined) {
    errors.push({
      pointer: '/category_id',
      message: 'Invalid input: expected string',
      code: 'invalid_type',
    });
  }
  return [...errors, ...validateRefs(body, 'consumable')];
}

function appendMovement(
  data: W2Data,
  consumable: MockConsumable,
  input: {
    qty_delta: number;
    reason: MockStockMovement['reason'];
    person_id?: string | null;
    note?: string | null;
    by: string;
  },
): MockStockMovement {
  consumable.qty_on_hand += input.qty_delta;
  consumable._v += 1;
  consumable.updated_at = nowIso();
  const movement: MockStockMovement = {
    id: newW2Id('movement'),
    consumable_id: consumable.id,
    qty_delta: input.qty_delta,
    reason: input.reason,
    person_id: input.person_id ?? null,
    note: input.note ?? null,
    balance_after: consumable.qty_on_hand,
    by_user_id: input.by,
    at: nowIso(),
  };
  data.movements.push(movement);
  return movement;
}

/** `consumable.low_stock` once per crossing: when the stock goes from above the minimum to at or below it. */
function maybeAlertLow(
  data: W2Data,
  consumable: MockConsumable,
  before: number,
  userId: string,
): void {
  const min = consumable.min_qty ?? 0;
  if (min > 0 && before > min && consumable.qty_on_hand <= min) {
    notify(data, userId, {
      type: 'consumable.low_stock',
      title: `Low stock: ${consumable.name}`,
      body: `${consumable.name} is at or below its reorder level. ${consumable.qty_on_hand} left (reorder level ${min}).`,
      // the API's link: the consumables list
      link: '/consumables',
      entity_type: 'consumable',
      entity_id: consumable.id,
    });
  }
}

const REASONS = ['receive', 'issue', 'return', 'adjust', 'correction'];

const consumableHandlers: HttpHandler[] = [
  http.get('/v1/consumables', ({ request }) => {
    const guard = requireSession(request, { permission: 'consumable:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      w2().consumables,
      {
        sorts: CONSUMABLE_SORTS,
        defaultSort: 'name',
        haystack: (c) => [c.name, c.model_number],
        filter: (c, p) => {
          if (p.get('category_id') && c.category_id !== p.get('category_id')) return false;
          if (p.get('location_id') && c.location_id !== p.get('location_id')) return false;
          if (p.get('low_stock') === 'true' && !isLow(c.qty_on_hand, c.min_qty ?? 0)) return false;
          return true;
        },
      },
      (c) => consumableView(c),
    );
  }),

  http.post('/v1/consumables', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'consumable:manage' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateConsumable(body, true);
    if (errors.length > 0) return validation(errors);
    const created = mutateW2((data) => {
      const stamp = nowIso();
      const consumable: MockConsumable = {
        id: newW2Id('consumable'),
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        category_id: String(body.category_id),
        name: String(body.name).trim(),
        manufacturer_id: (body.manufacturer_id as string | null | undefined) ?? null,
        vendor_id: (body.vendor_id as string | null | undefined) ?? null,
        location_id: (body.location_id as string | null | undefined) ?? null,
        model_number: trimmed(body.model_number),
        unit: trimmed(body.unit) ?? 'each',
        min_qty: (body.min_qty as number | undefined) ?? 0,
        unit_cost: (body.unit_cost as MockConsumable['unit_cost']) ?? null,
        notes: trimmed(body.notes),
        qty_on_hand: 0,
        label_code: '',
        _v: 1,
      };
      consumable.label_code = labelCode('consumable', consumable.id);
      data.consumables.push(consumable);
      const initial = (body.initial_qty as number | undefined) ?? 0;
      if (initial > 0) {
        appendMovement(data, consumable, {
          qty_delta: initial,
          reason: 'receive',
          note: 'Initial quantity',
          by: guard.user.id,
        });
      }
      return consumable;
    });
    return HttpResponse.json(consumableView(created), {
      status: 201,
      headers: { ETag: etagOf(created._v), Location: `/v1/consumables/${created.id}` },
    });
  }),

  http.get('/v1/consumables/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'consumable:read' });
    if (!guard.ok) return guard.response;
    const found = w2().consumables.find((c) => c.id === params.id);
    if (!found) return notFound('Consumable');
    return HttpResponse.json(consumableView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.patch('/v1/consumables/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'consumable:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().consumables.find((c) => c.id === params.id && !c.archived_at);
    if (!found) return notFound('Consumable');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = validateConsumable(body, false);
    if (errors.length > 0) return validation(errors);
    mutateW2(() => {
      for (const key of CONSUMABLE_KEYS) {
        if (body[key] === undefined) continue;
        const value =
          typeof body[key] === 'string' ? (body[key] as string).trim() || null : body[key];
        (found as Record<string, unknown>)[key] = key === 'name' ? String(body[key]).trim() : value;
      }
      found.updated_at = nowIso();
      found._v += 1;
    });
    return HttpResponse.json(consumableView(found), { headers: { ETag: etagOf(found._v) } });
  }),

  http.delete('/v1/consumables/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'consumable:manage' });
    if (!guard.ok) return guard.response;
    const found = w2().consumables.find((c) => c.id === params.id && !c.archived_at);
    if (!found) return notFound('Consumable');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    mutateW2(() => {
      found.archived_at = nowIso();
      found._v += 1;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('/v1/consumables/:id/movements', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'consumable:read' });
    if (!guard.ok) return guard.response;
    const found = w2().consumables.find((c) => c.id === params.id);
    if (!found) return notFound('Consumable');
    const reasons = (new URL(request.url).searchParams.get('reason') ?? '')
      .split(',')
      .filter(Boolean);
    if (reasons.some((r) => !REASONS.includes(r))) {
      return fail('bad-request', { detail: 'Unsupported reason filter' });
    }
    const people = registry().people;
    const rows = w2()
      .movements.filter((m) => m.consumable_id === found.id)
      .filter((m) => reasons.length === 0 || reasons.includes(m.reason))
      .map((m) => ({
        ...m,
        consumable_name: found.name,
        person_name: m.person_id
          ? (people.find((p) => p.id === m.person_id)?.display_name ?? null)
          : null,
        archived_at: null,
        _v: 1,
      }));
    return paginate(request, rows, { sorts: { at: (m) => m.at }, defaultSort: '-at' }, (m) => {
      const { archived_at: _archived, _v: _version, ...rest } = m;
      return rest;
    });
  }),

  http.post('/v1/consumables/:id/movements', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'consumable:adjust' });
    if (!guard.ok) return guard.response;
    const found = w2().consumables.find((c) => c.id === params.id && !c.archived_at);
    if (!found) return notFound('Consumable');
    const text = await request.clone().text();
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['qty_delta', 'reason', 'person_id', 'note']),
      ...checkUuids(body, ['person_id'], ['person_id']),
      ...checkText(body, 'note', { max: 2000 }),
    ];
    if (
      typeof body.qty_delta !== 'number' ||
      !Number.isInteger(body.qty_delta) ||
      body.qty_delta === 0
    ) {
      errors.push({
        pointer: '/qty_delta',
        message: 'Must be a whole number other than 0.',
        code: 'invalid_value',
      });
    }
    if (!REASONS.includes(String(body.reason))) {
      errors.push({ pointer: '/reason', message: 'Invalid option', code: 'invalid_value' });
    } else {
      const reason = String(body.reason);
      if (typeof body.qty_delta === 'number' && body.qty_delta !== 0) {
        if ((reason === 'receive' || reason === 'return') && body.qty_delta < 0) {
          errors.push({
            pointer: '/qty_delta',
            message: `a ${reason} adds stock: use a positive quantity`,
            code: 'custom',
          });
        } else if (reason === 'issue' && body.qty_delta > 0) {
          errors.push({
            pointer: '/qty_delta',
            message: 'an issue takes stock out: use a negative quantity',
            code: 'custom',
          });
        }
      }
      if ((reason === 'adjust' || reason === 'correction') && !trimmed(body.note)) {
        errors.push({
          pointer: '/note',
          message: `a ${reason} needs a note saying why`,
          code: 'custom',
        });
      }
    }
    if (isUuid(body.person_id) && !registry().people.some((p) => p.id === body.person_id)) {
      errors.push(missing('/person_id', 'No such person.'));
    }
    if (errors.length > 0) return validation(errors);

    return idempotent(request, w2(), `${request.method} ${text}`, () => {
      const delta = body.qty_delta as number;
      if (found.qty_on_hand + delta < 0) {
        return fail('insufficient-stock', {
          detail: `Only ${found.qty_on_hand} of ${found.name} are on hand; stock cannot go negative.`,
        });
      }
      const movement = mutateW2((data) => {
        const before = found.qty_on_hand;
        const made = appendMovement(data, found, {
          qty_delta: delta,
          reason: body.reason as MockStockMovement['reason'],
          person_id: (body.person_id as string | null | undefined) ?? null,
          note: trimmed(body.note),
          by: guard.user.id,
        });
        maybeAlertLow(data, found, before, guard.user.id);
        return made;
      });
      return {
        status: 201,
        body: movement,
        headers: { Location: `/v1/consumables/${found.id}/movements` },
      };
    });
  }),
];

export const stockHandlers: HttpHandler[] = [...accessoryHandlers, ...consumableHandlers];
