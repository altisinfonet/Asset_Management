import type { components } from '@assettracker/api-client';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { hasPermission } from '@/lib/auth/permissions';
import { problem, requireSession } from './http';
import {
  assetFilter,
  nowIso,
  paginate,
  pushHistory,
  readBody,
  validation,
  type Body,
  type FieldError,
} from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import { checkText, fail, isUuid, notFound, rejectUnknown } from './w2-common';
import {
  NOTIFICATION_EVENTS,
  mutateW2,
  newW2Id,
  seedNotifications,
  w2,
  w2Id,
  type MockExport,
  type MockSavedView,
} from './w2-state';

/**
 * Mock handlers of the rest of M2 wave 2 in docs/engineering/openapi.yaml: label templates and the
 * PDF label sheet, the notifications of the signed-in user with their delivery preferences, saved
 * views (personal and shared) and CSV exports. The notification, saved-view and export operations are
 * the web app's proposals (`[M2-W2 WEB proposal]` in the contract generator).
 */
type S = components['schemas'];

// ==== label templates and PDF sheets =====================================================

const TEMPLATES: S['LabelTemplate'][] = [
  {
    id: w2Id('template', 1),
    key: 'avery-5160',
    name: 'Avery 5160 (US Letter, 30-up)',
    page_size: 'letter',
    page_width_mm: 215.9,
    page_height_mm: 279.4,
    label_width_mm: 66.7,
    label_height_mm: 25.4,
    cols: 3,
    rows: 10,
    code_type: 'qr_and_code128',
    fields: ['tag', 'name'],
    is_system: true,
  },
  {
    id: w2Id('template', 2),
    key: 'a4-21up',
    name: 'A4 sheet, 3 x 7 (21-up)',
    page_size: 'a4',
    page_width_mm: 210,
    page_height_mm: 297,
    label_width_mm: 63.5,
    label_height_mm: 38.1,
    cols: 3,
    rows: 7,
    code_type: 'qr',
    fields: ['tag', 'name', 'location'],
    is_system: true,
  },
  {
    id: w2Id('template', 3),
    key: 'a4-10up',
    name: 'A4 sheet, 2 x 5 (10-up)',
    page_size: 'a4',
    page_width_mm: 210,
    page_height_mm: 297,
    label_width_mm: 99.1,
    label_height_mm: 57,
    cols: 2,
    rows: 5,
    code_type: 'qr_and_code128',
    fields: ['tag', 'name', 'location', 'organisation'],
    is_system: true,
  },
  {
    id: w2Id('template', 4),
    key: 'single-50x25',
    name: 'Single label 50 x 25 mm (roll printer)',
    page_size: 'custom',
    page_width_mm: 50,
    page_height_mm: 25,
    label_width_mm: 50,
    label_height_mm: 25,
    cols: 1,
    rows: 1,
    code_type: 'qr',
    fields: ['tag', 'name'],
    is_system: true,
  },
];

const CODE_TYPES = ['qr', 'code128', 'qr_and_code128'];
const FIELDS = ['tag', 'name', 'location', 'serial', 'organisation'];

/** A small but valid one-page PDF (the mock has no renderer): the sheet's summary as text. */
function tinyPdf(lines: string[]): Uint8Array {
  const escape = (text: string) => text.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    'BT /F1 14 Tf 72 740 Td 18 TL',
    ...lines.map((line, index) => `${index === 0 ? '' : 'T* '}(${escape(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const labelHandlers: HttpHandler[] = [
  http.get('/v1/labels/templates', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    return HttpResponse.json({ data: TEMPLATES });
  }),

  http.post('/v1/labels/render', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors: FieldError[] = [
      ...rejectUnknown(body, [
        'template_key',
        'asset_ids',
        'start_position',
        'code_type',
        'fields',
      ]),
    ];
    const template = TEMPLATES.find((t) => t.key === body.template_key);
    if (!template) {
      errors.push({ pointer: '/template_key', message: 'No such template.', code: 'not-found' });
    }
    const ids = body.asset_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || !ids.every(isUuid)) {
      errors.push({
        pointer: '/asset_ids',
        message: 'Between 1 and 500 asset ids are required.',
        code: 'invalid_value',
      });
    } else if (new Set(ids).size !== ids.length) {
      errors.push({ pointer: '/asset_ids', message: 'Ids must be unique.', code: 'not_unique' });
    }
    const slots = template ? template.cols * template.rows : 1;
    const start = body.start_position;
    if (
      start !== undefined &&
      (typeof start !== 'number' || !Number.isInteger(start) || start < 1)
    ) {
      errors.push({ pointer: '/start_position', message: 'Must be 1 or more.', code: 'too_small' });
    } else if (typeof start === 'number' && start > slots) {
      errors.push({
        pointer: '/start_position',
        message: `This template has only ${slots} positions per sheet.`,
        code: 'too_big',
      });
    }
    if (body.code_type !== undefined && !CODE_TYPES.includes(String(body.code_type))) {
      errors.push({ pointer: '/code_type', message: 'Invalid option', code: 'invalid_value' });
    }
    if (
      body.fields !== undefined &&
      (!Array.isArray(body.fields) || !body.fields.every((f) => FIELDS.includes(String(f))))
    ) {
      errors.push({ pointer: '/fields', message: 'Invalid option', code: 'invalid_value' });
    }
    if (errors.length > 0) return validation(errors);

    const assets = registry().assets.filter(
      (a) => (ids as string[]).includes(a.id) && !a.archived_at,
    );
    if (assets.length !== (ids as string[]).length) return notFound('Asset');
    mutateRegistry((data) => {
      for (const asset of assets) {
        const target = data.assets.find((a) => a.id === asset.id);
        if (target) {
          pushHistory(
            data,
            target,
            'label_printed',
            `Label printed (${template!.name})`,
            guard.user.id,
            {
              template_key: template!.key,
            },
          );
        }
      }
    });
    const perSheet = slots;
    const offset = (((start as number | undefined) ?? 1) - 1) % perSheet;
    const sheets = Math.ceil((offset + assets.length) / perSheet);
    const pdf = tinyPdf([
      `Labels: ${template!.name}`,
      `${assets.length} labels on ${sheets} sheets, starting at position ${offset + 1}`,
      ...assets.slice(0, 20).map((a) => a.asset_tag),
    ]);
    return new HttpResponse(pdf as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="labels-${template!.key}.pdf"`,
        'x-request-id': `mock-${Math.random().toString(16).slice(2, 10)}`,
      },
    });
  }),
];

// ==== notifications ======================================================================

type Delivery = S['NotificationPreference']['delivery'];

/** Gives a user the starting inbox the first time they look. */
function inboxOf(userId: string) {
  const data = w2();
  if (
    !data.notifications.some((n) => n.user_id === userId) &&
    !data.preferences[`seeded:${userId}`]
  ) {
    mutateW2((state) => {
      state.notifications.push(...seedNotifications(userId));
      state.preferences[`seeded:${userId}`] = {};
    });
  }
  return w2().notifications.filter((n) => n.user_id === userId);
}

const publicNotification = ({ user_id: _user, ...rest }: ReturnType<typeof inboxOf>[number]) =>
  rest;

const notificationHandlers: HttpHandler[] = [
  http.get('/v1/notifications', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const mine = inboxOf(guard.user.id);
    const unread = new URL(request.url).searchParams.get('unread') === 'true';
    const rows = mine
      .filter((n) => !unread || !n.read_at)
      .map((n) => ({ ...n, archived_at: null, _v: 1 }));
    const response = paginate(
      request,
      rows,
      { sorts: { created_at: (n) => n.created_at }, defaultSort: '-created_at' },
      (n) => {
        const { archived_at: _archived, _v: _version, ...rest } = n;
        return publicNotification(rest);
      },
    );
    // add `unread_count` to the page
    return response
      .json()
      .then((page: Record<string, unknown>) =>
        HttpResponse.json({ ...page, unread_count: mine.filter((n) => !n.read_at).length }),
      );
  }),

  http.post('/v1/notifications/read-all', ({ request }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const mine = inboxOf(guard.user.id);
    let updated = 0;
    mutateW2(() => {
      for (const n of mine) {
        if (!n.read_at) {
          n.read_at = nowIso();
          updated += 1;
        }
      }
    });
    return HttpResponse.json({ updated });
  }),

  http.post('/v1/notifications/:id/read', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const found = inboxOf(guard.user.id).find((n) => n.id === params.id);
    if (!found) return notFound('Notification');
    mutateW2(() => {
      found.read_at ??= nowIso();
    });
    return HttpResponse.json(publicNotification(found));
  }),

  http.get('/v1/notifications/preferences', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const own = w2().preferences[guard.user.id] ?? {};
    return HttpResponse.json({
      data: NOTIFICATION_EVENTS.map(([event_type, delivery]) => ({
        event_type,
        delivery: own[event_type] ?? delivery,
      })),
    });
  }),

  http.put('/v1/notifications/preferences', async ({ request }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['data']);
    const list = body.data;
    if (!Array.isArray(list) || list.length < 1) {
      errors.push({
        pointer: '/data',
        message: 'At least one entry is required.',
        code: 'too_small',
      });
    } else {
      list.forEach((entry: Body, index) => {
        if (!NOTIFICATION_EVENTS.some(([type]) => type === entry?.event_type)) {
          errors.push({
            pointer: `/data/${index}/event_type`,
            message: 'Unknown event type.',
            code: 'invalid_value',
          });
        }
        if (!['immediate', 'daily_digest', 'off'].includes(String(entry?.delivery))) {
          errors.push({
            pointer: `/data/${index}/delivery`,
            message: 'Invalid option',
            code: 'invalid_value',
          });
        }
      });
    }
    if (errors.length > 0) return validation(errors);
    mutateW2((data) => {
      const own = (data.preferences[guard.user.id] ??= {});
      for (const entry of list as Array<{ event_type: string; delivery: Delivery }>) {
        own[entry.event_type] = entry.delivery;
      }
    });
    const own = w2().preferences[guard.user.id] ?? {};
    return HttpResponse.json({
      data: NOTIFICATION_EVENTS.map(([event_type, delivery]) => ({
        event_type,
        delivery: own[event_type] ?? delivery,
      })),
    });
  }),
];

// ==== saved views ====================================================================

const VIEW_KEYS = ['entity', 'name', 'shared', 'definition'];

function validateDefinition(value: unknown): FieldError[] {
  const def = value as { filters?: unknown; columns?: unknown; sort?: unknown } | null;
  const errors: FieldError[] = [];
  if (typeof def !== 'object' || def === null) {
    return [
      { pointer: '/definition', message: 'Invalid input: expected object', code: 'invalid_type' },
    ];
  }
  if (typeof def.filters !== 'object' || def.filters === null || Array.isArray(def.filters)) {
    errors.push({
      pointer: '/definition/filters',
      message: 'Invalid input: expected object',
      code: 'invalid_type',
    });
  }
  if (!Array.isArray(def.columns) || !def.columns.every((c) => typeof c === 'string')) {
    errors.push({
      pointer: '/definition/columns',
      message: 'Invalid input: expected array of strings',
      code: 'invalid_type',
    });
  }
  if (def.sort !== null && typeof def.sort !== 'string') {
    errors.push({
      pointer: '/definition/sort',
      message: 'Invalid input: expected string or null',
      code: 'invalid_type',
    });
  }
  return errors;
}

const canShare = (permissions: string[]) => hasPermission(permissions, 'view:share');

const viewHandlers: HttpHandler[] = [
  http.get('/v1/saved-views', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const rows = w2()
      .savedViews.filter((v) => v.owner_user_id === guard.user.id || v.shared)
      .map((v) => ({ ...v, archived_at: null, _v: 1 }));
    return paginate(
      request,
      rows,
      {
        sorts: {
          mine: (v) => (v.owner_user_id === guard.user.id ? 0 : 1),
          name: (v) => v.name,
        },
        defaultSort: 'mine,name',
        filter: (v, p) => !p.get('entity') || v.entity === p.get('entity'),
      },
      (v) => {
        const { archived_at: _archived, _v: _version, ...rest } = v;
        return rest;
      },
    );
  }),

  http.post('/v1/saved-views', async ({ request }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, VIEW_KEYS),
      ...checkText(body, 'name', { min: 1, max: 80, required: true }),
      ...validateDefinition(body.definition),
    ];
    if (body.entity !== 'asset') {
      errors.push({ pointer: '/entity', message: 'Invalid option', code: 'invalid_value' });
    }
    if (body.shared !== undefined && typeof body.shared !== 'boolean') {
      errors.push({
        pointer: '/shared',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    if (body.shared === true && !canShare(guard.user.permissions)) {
      return problem(403, 'forbidden', 'You do not have permission to do this', {
        detail: 'Sharing a view needs the view:share permission.',
      });
    }
    const name = String(body.name).trim();
    const taken = w2().savedViews.some(
      (v) => v.owner_user_id === guard.user.id && v.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) {
      return fail('conflict', {
        detail: `You already have a view named "${name}".`,
        errors: [{ pointer: '/name', message: 'is already in use', code: 'duplicate' }],
      });
    }
    const created = mutateW2((data) => {
      const stamp = nowIso();
      const view: MockSavedView = {
        id: newW2Id('view'),
        entity: 'asset',
        name,
        shared: body.shared === true,
        owner_user_id: guard.user.id,
        owner_name: guard.user.display_name,
        definition: body.definition as MockSavedView['definition'],
        created_at: stamp,
        updated_at: stamp,
      };
      data.savedViews.push(view);
      return view;
    });
    return HttpResponse.json(created, {
      status: 201,
      headers: { Location: `/v1/saved-views/${created.id}` },
    });
  }),

  http.patch('/v1/saved-views/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const found = w2().savedViews.find((v) => v.id === params.id);
    if (!found || (found.owner_user_id !== guard.user.id && !found.shared)) return notFound('View');
    if (found.owner_user_id !== guard.user.id && !canShare(guard.user.permissions)) {
      return problem(403, 'forbidden', 'You do not have permission to do this');
    }
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['name', 'shared', 'definition']),
      ...checkText(body, 'name', { min: 1, max: 80 }),
      ...(body.definition !== undefined ? validateDefinition(body.definition) : []),
    ];
    if (body.shared !== undefined && typeof body.shared !== 'boolean') {
      errors.push({
        pointer: '/shared',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    if (body.shared === true && !found.shared && !canShare(guard.user.permissions)) {
      return problem(403, 'forbidden', 'You do not have permission to do this', {
        detail: 'Sharing a view needs the view:share permission.',
      });
    }
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      const taken = w2().savedViews.some(
        (v) =>
          v.id !== found.id &&
          v.owner_user_id === found.owner_user_id &&
          v.name.toLowerCase() === name.toLowerCase(),
      );
      if (taken) {
        return fail('conflict', {
          detail: `A view named "${name}" already exists.`,
          errors: [{ pointer: '/name', message: 'is already in use', code: 'duplicate' }],
        });
      }
    }
    mutateW2(() => {
      if (typeof body.name === 'string') found.name = body.name.trim();
      if (typeof body.shared === 'boolean') found.shared = body.shared;
      if (body.definition !== undefined)
        found.definition = body.definition as MockSavedView['definition'];
      found.updated_at = nowIso();
    });
    return HttpResponse.json(found);
  }),

  http.delete('/v1/saved-views/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const found = w2().savedViews.find((v) => v.id === params.id);
    if (!found || (found.owner_user_id !== guard.user.id && !found.shared)) return notFound('View');
    if (found.owner_user_id !== guard.user.id && !canShare(guard.user.permissions)) {
      return problem(403, 'forbidden', 'You do not have permission to do this');
    }
    mutateW2((data) => {
      data.savedViews = data.savedViews.filter((v) => v.id !== found.id);
    });
    return new HttpResponse(null, { status: 204 });
  }),
];

// ==== CSV exports ====================================================================

/** How long the (simulated) worker takes; tests shorten it. */
let exportDelayMs = 1200;
export function setMockExportDelay(ms: number): void {
  exportDelayMs = ms;
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The CSV of the assets a list query shows (the columns the importer reads back). */
function assetsCsv(query: Record<string, unknown>): { csv: string; rows: number } {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (key === 'cf' && typeof value === 'object') {
      for (const [field, v] of Object.entries(value)) params.set(`cf[${field}]`, String(v));
    } else if (Array.isArray(value)) params.set(key, value.join(','));
    else params.set(key, String(value));
  }
  const data = registry();
  const archived = params.get('archived') ?? 'exclude';
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const rows = data.assets
    .filter((a) =>
      archived === 'exclude' ? !a.archived_at : archived === 'only' ? !!a.archived_at : true,
    )
    .filter((a) => !q || [a.asset_tag, a.name, a.serial].some((v) => v?.toLowerCase().includes(q)))
    .filter((a) => assetFilter(a, params))
    .sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
  const header = [
    'asset_tag',
    'name',
    'serial',
    'category',
    'status',
    'location',
    'purchase_date',
    'warranty_end',
  ];
  const lines = rows.map((a) =>
    [
      a.asset_tag,
      a.name,
      a.serial,
      data.categories.find((c) => c.id === a.category_id)?.name,
      data.statusLabels.find((s) => s.id === a.status_id)?.name,
      data.locations.find((l) => l.id === a.location_id)?.name,
      a.purchase_date,
      a.warranty_end,
    ]
      .map(csvCell)
      .join(','),
  );
  return { csv: `${[header.join(','), ...lines].join('\n')}\n`, rows: rows.length };
}

/** The job as the API shows it, moving it along when its time has come. */
function exportView(job: MockExport, userId: string, advance = true): S['ExportJob'] {
  if (
    advance &&
    (job.status === 'queued' || job.status === 'running') &&
    Date.now() >= job.ready_at
  ) {
    mutateW2(() => {
      if (job.fail) {
        job.status = 'failed';
        job.error = 'The export could not be written.';
      } else {
        job.status = 'ready';
        job.completed_at = nowIso();
        job.expires_at = new Date(Date.now() + 15 * 60_000).toISOString();
        job.download_url = `/mock-storage/exports/${job.id}.csv`;
      }
    });
    if (!job.fail) {
      mutateW2((data) => {
        data.notifications.push({
          id: newW2Id('notification'),
          user_id: userId,
          event_type: 'export.ready',
          title: 'Your export is ready',
          body: `${job.row_count ?? 0} assets exported.`,
          entity_type: null,
          entity_id: null,
          read_at: null,
          created_at: nowIso(),
        });
      });
    }
  } else if (advance && job.status === 'queued' && Date.now() >= job.ready_at - exportDelayMs / 2) {
    mutateW2(() => {
      job.status = 'running';
    });
  }
  const { csv: _csv, ready_at: _ready, fail: _fail, ...rest } = job;
  return rest;
}

const exportHandlers: HttpHandler[] = [
  http.post('/v1/exports', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['entity', 'query', 'columns']);
    if (body.entity !== 'asset') {
      errors.push({ pointer: '/entity', message: 'Invalid option', code: 'invalid_value' });
    }
    if (
      body.query !== undefined &&
      (typeof body.query !== 'object' || body.query === null || Array.isArray(body.query))
    ) {
      errors.push({
        pointer: '/query',
        message: 'Invalid input: expected object',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    const made = assetsCsv((body.query as Record<string, unknown> | undefined) ?? {});
    const job = mutateW2((data) => {
      const row: MockExport = {
        id: newW2Id('export'),
        entity: 'asset',
        status: 'queued',
        row_count: made.rows,
        error: null,
        download_url: null,
        expires_at: null,
        created_at: nowIso(),
        completed_at: null,
        csv: made.csv,
        ready_at: Date.now() + exportDelayMs,
        fail: /fail/i.test(String((body.query as Record<string, unknown> | undefined)?.q ?? '')),
      };
      data.exports.push(row);
      return row;
    });
    return HttpResponse.json(exportView(job, guard.user.id, false), {
      status: 202,
      headers: { Location: `/v1/exports/${job.id}`, 'Retry-After': '1' },
    });
  }),

  http.get('/v1/exports/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:read' });
    if (!guard.ok) return guard.response;
    const found = w2().exports.find((e) => e.id === params.id);
    if (!found) return notFound('Export');
    return HttpResponse.json(exportView(found, guard.user.id));
  }),

  // The "storage" the download link points at (not part of the contract).
  http.get('/mock-storage/exports/:name', ({ params }) => {
    const id = String(params.name).replace(/\.csv$/, '');
    const found = w2().exports.find((e) => e.id === id && e.status === 'ready');
    if (!found?.csv) return new HttpResponse(null, { status: 404 });
    return new HttpResponse(found.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="assets-${id.slice(-6)}.csv"`,
      },
    });
  }),
];

export const miscHandlers: HttpHandler[] = [
  ...labelHandlers,
  ...notificationHandlers,
  ...viewHandlers,
  ...exportHandlers,
];
