import type { components } from '@assettracker/api-client';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { hasPermission } from '@/lib/auth/permissions';
import { checkIfMatch, etagOf, problem, requireSession } from './http';
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
import type { MockAsset } from './registry-fixtures';
import { checkText, fail, idempotent, isUuid, notFound, rejectUnknown } from './w2-common';
import {
  NOTIFICATION_TYPES,
  mutateW2,
  newW2Id,
  notify,
  seedNotifications,
  w2,
  w2Id,
  type MockExport,
  type MockLabelBatch,
  type MockSavedView,
} from './w2-state';

/**
 * Mock handlers of the rest of M2 wave 2 in docs/engineering/openapi.yaml, mirroring the API: label
 * templates and asynchronous PDF batches (`/v1/labels/*`), the notifications of the signed-in user
 * with their preferences and the organisation's rules (`/v1/notifications*`,
 * `/v1/notification-preferences*`, `/v1/notification-rules*`), saved views with their sharing
 * (`/v1/saved-views*`) and CSV exports (`/v1/exports*`).
 */
type S = components['schemas'];

// ==== label templates ================================================================

const FIELDS = ['asset_tag', 'name', 'serial', 'location', 'model', 'organisation'];
const CODES = ['qr', 'code128'];

type TemplateSeed = Omit<
  S['LabelTemplate'],
  'id' | 'slots' | 'offset_x_mm' | 'offset_y_mm' | 'is_system'
>;

/** The six fixed templates the API seeds for every organisation (`apps/api/src/tagging/templates.ts`). */
const TEMPLATE_SEEDS: TemplateSeed[] = [
  {
    key: 'letter-30up-qr',
    name: 'US Letter 30-up (Avery 5160 layout), QR',
    page_size: 'letter',
    page_width_mm: 215.9,
    page_height_mm: 279.4,
    label_width_mm: 66.68,
    label_height_mm: 25.4,
    cols: 3,
    rows: 10,
    margin_top_mm: 12.7,
    margin_left_mm: 4.76,
    gap_x_mm: 3.18,
    gap_y_mm: 0,
    code_type: 'qr',
    fields: ['asset_tag', 'name'],
  },
  {
    key: 'a4-21up-qr',
    name: 'A4 21-up (Avery L7160 layout), QR',
    page_size: 'a4',
    page_width_mm: 210,
    page_height_mm: 297,
    label_width_mm: 63.5,
    label_height_mm: 38.1,
    cols: 3,
    rows: 7,
    margin_top_mm: 15.15,
    margin_left_mm: 7.21,
    gap_x_mm: 2.54,
    gap_y_mm: 0,
    code_type: 'qr',
    fields: ['asset_tag', 'name'],
  },
  {
    key: 'a4-24up-qr',
    name: 'A4 24-up, 3 x 8 (Avery L7159 layout), QR',
    page_size: 'a4',
    page_width_mm: 210,
    page_height_mm: 297,
    label_width_mm: 63.5,
    label_height_mm: 33.9,
    cols: 3,
    rows: 8,
    margin_top_mm: 12.9,
    margin_left_mm: 7.21,
    gap_x_mm: 2.54,
    gap_y_mm: 0,
    code_type: 'qr',
    fields: ['asset_tag', 'name'],
  },
  {
    key: 'letter-10up-qr',
    name: 'US Letter 10-up (Avery 5163 layout), QR and Code128',
    page_size: 'letter',
    page_width_mm: 215.9,
    page_height_mm: 279.4,
    label_width_mm: 101.6,
    label_height_mm: 50.8,
    cols: 2,
    rows: 5,
    margin_top_mm: 12.7,
    margin_left_mm: 3.97,
    gap_x_mm: 4.76,
    gap_y_mm: 0,
    code_type: 'qr_and_code128',
    fields: ['asset_tag', 'name', 'serial'],
  },
  {
    key: 'single-50x25-qr',
    name: 'Single label 50 x 25 mm, QR (one per page)',
    page_size: 'custom',
    page_width_mm: 50,
    page_height_mm: 25,
    label_width_mm: 50,
    label_height_mm: 25,
    cols: 1,
    rows: 1,
    margin_top_mm: 0,
    margin_left_mm: 0,
    gap_x_mm: 0,
    gap_y_mm: 0,
    code_type: 'qr',
    fields: ['asset_tag'],
  },
  {
    key: 'thermal-2x1in-qr',
    name: 'Single label 2 x 1 inch for thermal / roll printers, QR and Code128',
    page_size: 'custom',
    page_width_mm: 50.8,
    page_height_mm: 25.4,
    label_width_mm: 50.8,
    label_height_mm: 25.4,
    cols: 1,
    rows: 1,
    margin_top_mm: 0,
    margin_left_mm: 0,
    gap_x_mm: 0,
    gap_y_mm: 0,
    code_type: 'qr_and_code128',
    fields: ['asset_tag', 'name'],
  },
];

const TEMPLATES: S['LabelTemplate'][] = TEMPLATE_SEEDS.map((seed, index) => ({
  id: w2Id('template', index + 1),
  ...seed,
  slots: seed.cols * seed.rows,
  offset_x_mm: 0,
  offset_y_mm: 0,
  is_system: true,
}));

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

// ==== assets a filter matches (labels and exports) =========================================

/** The flat filters of an export or a label batch as the query string of `GET /v1/assets` has them. */
function filterParams(filters: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}

/** The assets the list endpoint would show for these filters (no paging), in the list's order. */
function matchAssets(filters: Record<string, unknown>): MockAsset[] {
  const params = filterParams(filters);
  const data = registry();
  const archived = params.get('archived') ?? 'exclude';
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const sort = (params.get('sort') ?? 'asset_tag').split(',')[0]!;
  const key = sort.replace(/^-/, '') as keyof MockAsset;
  const direction = sort.startsWith('-') ? -1 : 1;
  return data.assets
    .filter((a) =>
      archived === 'exclude' ? !a.archived_at : archived === 'only' ? !!a.archived_at : true,
    )
    .filter((a) => !q || [a.asset_tag, a.name, a.serial].some((v) => v?.toLowerCase().includes(q)))
    .filter((a) => assetFilter(a, params))
    .sort((a, b) => direction * String(a[key] ?? '').localeCompare(String(b[key] ?? '')));
}

// ==== label batches =============================================================================

/** How long the (simulated) worker takes to render a sheet; tests shorten it. */
let labelDelayMs = 1200;
export function setMockLabelDelay(ms: number): void {
  labelDelayMs = ms;
}

/** Ask the mock worker to fail the batches made from now on (`undefined`: succeed again). */
let labelFailure: MockLabelBatch['fail'];
export function setMockLabelFailure(reason: MockLabelBatch['fail']): void {
  labelFailure = reason;
}

const BATCH_KEYS = [
  'template_key',
  'asset_ids',
  'filter',
  'start_position',
  'copies',
  'codes',
  'fields',
  'logo_attachment_id',
  'outlines',
];
const FILTER_KEYS = [
  'q',
  'archived',
  'tag',
  'serial',
  'status_id',
  'state_type',
  'category_id',
  'model_id',
  'manufacturer_id',
  'location_id',
  'include_sublocations',
  'assigned',
  'assigned_person_id',
  'overdue',
  'company_id',
  'vendor_id',
  'parent_asset_id',
  'warranty_end_before',
  'warranty_end_after',
  'purchase_date_from',
  'purchase_date_to',
  'updated_since',
  'sort',
];
const MAX_BATCH = 2000;

const pagesNeeded = (cols: number, rows: number, labels: number, start: number) =>
  Math.ceil((start - 1 + labels) / (cols * rows));

function uniqueStrings(value: unknown, allowed: readonly string[], max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((v) => typeof v === 'string' && allowed.includes(v)) &&
    new Set(value).size === value.length
  );
}

/** The batch as the API shows it, rendering the sheet when the worker's time has come. */
function batchView(batch: MockLabelBatch, advance = true) {
  if (advance && batch.status === 'queued' && Date.now() >= batch.ready_at) {
    const template = TEMPLATES.find((t) => t.key === batch.template_key)!;
    if (batch.fail) {
      mutateW2(() => {
        batch.status = 'failed';
        batch.error = {
          code: batch.fail!,
          detail:
            batch.fail === 'logo-invalid'
              ? 'The logo is not a clean PNG or JPEG.'
              : 'The PDF could not be rendered.',
        };
      });
    } else {
      const pages = pagesNeeded(
        template.cols,
        template.rows,
        batch.label_count,
        batch.start_position,
      );
      const pdf = tinyPdf([
        `Labels: ${template.name}`,
        `${batch.label_count} labels on ${pages} sheets, starting at position ${batch.start_position}`,
      ]);
      mutateW2((data) => {
        batch.status = 'ready';
        batch.rendered_at = nowIso();
        batch.page_count = pages;
        batch.filename = `labels-${template.key}-${batch.id.slice(-6)}.pdf`;
        batch.size_bytes = pdf.length;
        notify(data, batch.user_id, {
          type: 'label.batch.ready',
          title: 'Your labels are ready',
          body: 'Your batch of labels is ready to print.',
          entity_type: 'label_batch',
          entity_id: batch.id,
        });
      });
      // "label_printed" in the history of every asset on the sheet
      mutateRegistry((data) => {
        for (const id of batch.asset_ids) {
          const asset = data.assets.find((a) => a.id === id);
          if (asset) {
            pushHistory(
              data,
              asset,
              'label_printed',
              `Label printed (${template.name})`,
              batch.user_id,
              {
                template_key: template.key,
                batch_id: batch.id,
              },
            );
          }
        }
      });
    }
  }
  const { user_id: _user, asset_ids: _ids, ready_at: _ready, fail: _fail, ...rest } = batch;
  const ready = rest.status === 'ready';
  return {
    ...rest,
    download_url: ready ? `/mock-storage/labels/${batch.id}.pdf` : null,
    download_expires_at: ready ? new Date(Date.now() + 2 * 60_000).toISOString() : null,
  };
}

const labelHandlers: HttpHandler[] = [
  http.get('/v1/labels/templates', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    return HttpResponse.json({ data: TEMPLATES });
  }),

  http.get('/v1/labels/templates/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    const found = TEMPLATES.find((t) => t.id === params.id);
    if (!found) return notFound('Template');
    return HttpResponse.json(found, { headers: { ETag: etagOf(1) } });
  }),

  http.post('/v1/labels/batches', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    const text = await request.clone().text();
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors: FieldError[] = rejectUnknown(body, BATCH_KEYS);
    const template = TEMPLATES.find((t) => t.key === body.template_key);
    if (!template) {
      errors.push({ pointer: '/template_key', message: 'No such template.', code: 'not-found' });
    }
    const hasIds = body.asset_ids !== undefined;
    const hasFilter = body.filter !== undefined;
    let assets: MockAsset[] = [];
    if (hasIds === hasFilter) {
      errors.push({
        pointer: '/',
        message: 'Send exactly one of asset_ids and filter.',
        code: 'invalid',
      });
    } else if (hasIds) {
      const ids = body.asset_ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_BATCH || !ids.every(isUuid)) {
        errors.push({
          pointer: '/asset_ids',
          message: `Between 1 and ${MAX_BATCH} asset ids are required.`,
          code: 'invalid_value',
        });
      } else if (new Set(ids).size !== ids.length) {
        errors.push({ pointer: '/asset_ids', message: 'Ids must be unique.', code: 'not_unique' });
      } else {
        const known = new Map(registry().assets.map((a) => [a.id, a]));
        (ids as string[]).forEach((id, index) => {
          const asset = known.get(id);
          if (!asset || asset.archived_at) {
            errors.push({
              pointer: `/asset_ids/${index}`,
              message: 'No such asset.',
              code: 'not-found',
            });
          } else assets.push(asset);
        });
      }
    } else {
      const filter = body.filter;
      if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
        errors.push({
          pointer: '/filter',
          message: 'Invalid input: expected object',
          code: 'invalid_type',
        });
      } else {
        const unknown = Object.keys(filter).filter((key) => !FILTER_KEYS.includes(key));
        for (const key of unknown) {
          errors.push({
            pointer: '/filter',
            message: `Unrecognized key: "${key}"`,
            code: 'unrecognized_keys',
          });
        }
        if (unknown.length === 0) {
          assets = matchAssets(filter as Record<string, unknown>);
          if (assets.length === 0) {
            errors.push({
              pointer: '/filter',
              message: 'The filter matches no asset.',
              code: 'empty',
            });
          } else if (assets.length > MAX_BATCH) {
            errors.push({
              pointer: '/filter',
              message: `The filter matches more than ${MAX_BATCH} assets.`,
              code: 'too-many',
            });
          }
        }
      }
    }
    const start = body.start_position ?? 1;
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 1 || start > 1000) {
      errors.push({
        pointer: '/start_position',
        message: 'Must be a whole number from 1 to 1000.',
        code: 'too_small',
      });
    } else if (template && start > template.slots) {
      errors.push({
        pointer: '/start_position',
        message: `This template has only ${template.slots} positions per sheet.`,
        code: 'too_big',
      });
    }
    const copies = body.copies ?? 1;
    if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1 || copies > 10) {
      errors.push({
        pointer: '/copies',
        message: 'Must be a whole number from 1 to 10.',
        code: 'too_big',
      });
    } else if (assets.length * copies > MAX_BATCH) {
      errors.push({
        pointer: '/copies',
        message: `A batch holds at most ${MAX_BATCH} labels.`,
        code: 'too-many',
      });
    }
    if (body.codes !== undefined && !uniqueStrings(body.codes, CODES, 2)) {
      errors.push({ pointer: '/codes', message: 'Invalid option', code: 'invalid_value' });
    }
    if (body.fields !== undefined && !uniqueStrings(body.fields, FIELDS, 6)) {
      errors.push({ pointer: '/fields', message: 'Invalid option', code: 'invalid_value' });
    }
    if (body.outlines !== undefined && typeof body.outlines !== 'boolean') {
      errors.push({
        pointer: '/outlines',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0 || !template) return validation(errors);

    return idempotent(request, w2(), `${request.method} ${text}`, () => {
      const labels = assets.length * (copies as number);
      const codes =
        (body.codes as MockLabelBatch['codes'] | undefined) ??
        (template.code_type === 'qr_and_code128'
          ? (['qr', 'code128'] as const)
          : ([template.code_type] as const));
      const batch = mutateW2((data) => {
        const created: MockLabelBatch = {
          id: newW2Id('batch'),
          user_id: guard.user.id,
          asset_ids: assets.map((a) => a.id),
          status: 'queued',
          template_key: template.key,
          source: hasIds ? 'asset_ids' : 'filter',
          asset_count: assets.length,
          copies: copies as number,
          label_count: labels,
          start_position: start as number,
          codes: [...codes],
          fields: (body.fields as MockLabelBatch['fields'] | undefined) ?? [...template.fields],
          outlines: body.outlines === true,
          logo_attachment_id: null,
          page_count: null,
          filename: null,
          size_bytes: null,
          created_at: nowIso(),
          rendered_at: null,
          expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
          download_url: null,
          download_expires_at: null,
          error: null,
          ready_at: Date.now() + labelDelayMs,
          ...(labelFailure ? { fail: labelFailure } : {}),
        };
        data.labelBatches.push(created);
        return created;
      });
      return {
        status: 202,
        body: batchView(batch, false),
        headers: { Location: `/v1/labels/batches/${batch.id}` },
      };
    });
  }),

  http.get('/v1/labels/batches', ({ request }) => {
    const guard = requireSession(request, { permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    const statuses = (new URL(request.url).searchParams.get('status') ?? '')
      .split(',')
      .filter(Boolean);
    const mine = w2()
      .labelBatches.filter((b) => b.user_id === guard.user.id)
      .filter((b) => statuses.length === 0 || statuses.includes(b.status))
      .map((b) => ({ ...b, archived_at: null, _v: 1 }));
    return paginate(
      request,
      mine,
      { sorts: { created_at: (b) => b.created_at }, defaultSort: '-created_at' },
      (b) => batchView(w2().labelBatches.find((x) => x.id === b.id)!),
    );
  }),

  http.get('/v1/labels/batches/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'asset:label' });
    if (!guard.ok) return guard.response;
    const found = w2().labelBatches.find((b) => b.id === params.id && b.user_id === guard.user.id);
    if (!found) return notFound('Label batch');
    return HttpResponse.json(batchView(found));
  }),

  // The "storage" the download link points at (not part of the contract).
  http.get('/mock-storage/labels/:name', ({ params }) => {
    const id = String(params.name).replace(/\.pdf$/, '');
    const found = w2().labelBatches.find((b) => b.id === id && b.status === 'ready');
    if (!found) return new HttpResponse(null, { status: 404 });
    const pdf = tinyPdf([`Labels: ${found.template_key}`, `${found.label_count} labels`]);
    return new HttpResponse(pdf as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${found.filename ?? 'labels.pdf'}"`,
      },
    });
  }),
];

// ==== notifications ======================================================================

/** Gives a user the starting inbox the first time they look. */
function inboxOf(userId: string) {
  if (!w2().seeded.includes(userId)) {
    mutateW2((state) => {
      state.notifications.push(...seedNotifications(userId));
      state.seeded.push(userId);
    });
  }
  return w2().notifications.filter((n) => n.user_id === userId);
}

const publicNotification = ({ user_id: _user, ...rest }: ReturnType<typeof inboxOf>[number]) =>
  rest;

/** The preference of one user and type: what they chose, else the type's defaults. */
function preferenceOf(userId: string, type: (typeof NOTIFICATION_TYPES)[number]) {
  const chosen = w2().preferences[userId]?.[type.type];
  return {
    type: type.type,
    label: type.label,
    description: type.description,
    in_app: chosen?.in_app ?? type.defaults.in_app,
    email: chosen?.email ?? type.defaults.email,
    is_default: chosen === undefined,
  };
}

const TYPE_PATH = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const notificationHandlers: HttpHandler[] = [
  http.get('/v1/notifications', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const unread = new URL(request.url).searchParams.get('unread') === 'true';
    const rows = inboxOf(guard.user.id)
      .filter((n) => !unread || !n.read_at)
      .map((n) => ({ ...n, archived_at: null, _v: 1 }));
    return paginate(
      request,
      rows,
      { sorts: { created_at: (n) => n.created_at }, defaultSort: '-created_at' },
      (n) => {
        const { archived_at: _archived, _v: _version, ...rest } = n;
        return publicNotification(rest);
      },
    );
  }),

  http.get('/v1/notifications/unread-count', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    return HttpResponse.json({ count: inboxOf(guard.user.id).filter((n) => !n.read_at).length });
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

  http.get('/v1/notification-preferences', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    return HttpResponse.json({
      data: NOTIFICATION_TYPES.map((type) => preferenceOf(guard.user.id, type)),
    });
  }),

  http.put('/v1/notification-preferences/:type', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const type = String(params.type);
    if (!TYPE_PATH.test(type)) return fail('bad-request', { detail: 'Not a notification type.' });
    const def = NOTIFICATION_TYPES.find((t) => t.type === type);
    if (!def) return notFound('Notification type');
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['in_app', 'email']);
    if (body.in_app !== undefined && typeof body.in_app !== 'boolean') {
      errors.push({
        pointer: '/in_app',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    if (body.email !== undefined && !['immediate', 'digest', 'off'].includes(String(body.email))) {
      errors.push({ pointer: '/email', message: 'Invalid option', code: 'invalid_value' });
    }
    if (body.in_app === undefined && body.email === undefined && errors.length === 0) {
      errors.push({ pointer: '/', message: 'Send at least one field.', code: 'too_small' });
    }
    if (errors.length > 0) return validation(errors);
    mutateW2((data) => {
      const own = (data.preferences[guard.user.id] ??= {});
      own[type] = {
        ...own[type],
        ...(typeof body.in_app === 'boolean' ? { in_app: body.in_app } : {}),
        ...(body.email ? { email: body.email as 'immediate' | 'digest' | 'off' } : {}),
      };
    });
    return HttpResponse.json(preferenceOf(guard.user.id, def));
  }),

  http.get('/v1/notification-rules', ({ request }) => {
    const guard = requireSession(request, { permission: 'notification:manage' });
    if (!guard.ok) return guard.response;
    return HttpResponse.json({ data: NOTIFICATION_TYPES.map((type) => ruleOf(type)) });
  }),

  http.put('/v1/notification-rules/:type', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'notification:manage' });
    if (!guard.ok) return guard.response;
    const type = String(params.type);
    if (!TYPE_PATH.test(type)) return fail('bad-request', { detail: 'Not a notification type.' });
    const def = NOTIFICATION_TYPES.find((t) => t.type === type);
    if (!def) return notFound('Notification type');
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['enabled', 'recipient_roles']);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      errors.push({
        pointer: '/enabled',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    const roles = body.recipient_roles;
    if (
      roles !== undefined &&
      roles !== null &&
      (!Array.isArray(roles) ||
        roles.length > 20 ||
        !roles.every((r) => typeof r === 'string' && /^[a-z][a-z0-9_]{1,62}$/.test(r)))
    ) {
      errors.push({
        pointer: '/recipient_roles',
        message: 'Invalid input: expected role keys',
        code: 'invalid_type',
      });
    } else if (Array.isArray(roles) && !def.role_configurable) {
      errors.push({
        pointer: '/recipient_roles',
        message: 'This notification goes to one specific user: its recipients cannot be changed.',
        code: 'invalid',
      });
    }
    if (body.enabled === undefined && roles === undefined && errors.length === 0) {
      errors.push({ pointer: '/', message: 'Send at least one field.', code: 'too_small' });
    }
    if (errors.length > 0) return validation(errors);
    mutateW2((data) => {
      const current = data.rules[type] ?? { enabled: true, recipient_roles: null, updated_at: '' };
      data.rules[type] = {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
        recipient_roles: roles === undefined ? current.recipient_roles : (roles as string[] | null),
        updated_at: nowIso(),
      };
    });
    return HttpResponse.json(ruleOf(def));
  }),
];

function ruleOf(type: (typeof NOTIFICATION_TYPES)[number]) {
  const rule = w2().rules[type.type];
  return {
    type: type.type,
    label: type.label,
    description: type.description,
    enabled: rule?.enabled ?? true,
    recipients: type.recipients,
    role_configurable: type.role_configurable,
    recipient_roles: rule?.recipient_roles ?? null,
    updated_at: rule?.updated_at ?? null,
  };
}

// ==== saved views ====================================================================

const MAX_VIEWS = 50;
const VIEW_RESOURCES = ['assets'];

/** Which filter keys carry ids of which catalogue (the API checks them for `warnings`). */
const REFERENCES: Record<
  string,
  'status' | 'category' | 'location' | 'model' | 'vendor' | 'manufacturer' | 'person'
> = {
  status_id: 'status',
  category_id: 'category',
  location_id: 'location',
  model_id: 'model',
  vendor_id: 'vendor',
  manufacturer_id: 'manufacturer',
  person_id: 'person',
  assigned_person_id: 'person',
};
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id references of a view's filters that no longer resolve (or were archived). */
function warningsOf(filters: Record<string, unknown>): S['SavedView']['warnings'] {
  const data = registry();
  const lookup: Record<string, Array<{ id: string; archived_at?: string | null }>> = {
    status: data.statusLabels,
    category: data.categories,
    location: data.locations,
    model: data.models,
    vendor: data.vendors,
    manufacturer: data.manufacturers,
    person: data.people,
  };
  const out: S['SavedView']['warnings'] = [];
  for (const [field, value] of Object.entries(filters)) {
    const table = REFERENCES[field];
    if (!table) continue;
    for (const id of Array.isArray(value) ? value : [value]) {
      if (typeof id !== 'string' || !UUID_TEXT.test(id)) continue;
      const found = lookup[table]!.find((row) => row.id === id.toLowerCase());
      if (!found) out.push({ field, id, reason: 'not-found' });
      else if (found.archived_at) out.push({ field, id, reason: 'archived' });
    }
  }
  return out;
}

const viewOf = (view: MockSavedView, userId: string): S['SavedView'] => {
  const { _v: _version, ...rest } = view;
  return { ...rest, is_owner: view.owner.id === userId, warnings: warningsOf(view.filters) };
};

const canSee = (view: MockSavedView, userId: string) => view.owner.id === userId || view.is_shared;

const lowerName = (name: string) => name.toLowerCase();

function checkViewFields(body: Body, creating: boolean): FieldError[] {
  const errors = [
    ...rejectUnknown(
      body,
      creating
        ? ['resource', 'name', 'filters', 'columns', 'sort']
        : ['name', 'filters', 'columns', 'sort'],
    ),
    ...checkText(body, 'name', { min: 1, max: 100, required: creating }),
  ];
  if (creating && body.resource !== undefined && !VIEW_RESOURCES.includes(String(body.resource))) {
    errors.push({ pointer: '/resource', message: 'Invalid option', code: 'invalid_value' });
  }
  if (
    body.filters !== undefined &&
    (typeof body.filters !== 'object' || body.filters === null || Array.isArray(body.filters))
  ) {
    errors.push({
      pointer: '/filters',
      message: 'Invalid input: expected object',
      code: 'invalid_type',
    });
  } else if (body.filters !== undefined && JSON.stringify(body.filters).length > 12_000) {
    errors.push({ pointer: '/filters', message: 'must be at most 12 KB of JSON', code: 'too_big' });
  }
  if (
    body.columns !== undefined &&
    (!Array.isArray(body.columns) ||
      body.columns.length > 40 ||
      !body.columns.every((c) => typeof c === 'string' && c.length >= 1 && c.length <= 64))
  ) {
    errors.push({
      pointer: '/columns',
      message: 'Invalid input: expected up to 40 column ids',
      code: 'invalid_type',
    });
  }
  if (
    body.sort !== undefined &&
    body.sort !== null &&
    (typeof body.sort !== 'string' || body.sort.length < 1 || body.sort.length > 64)
  ) {
    errors.push({
      pointer: '/sort',
      message: 'Invalid input: expected string or null',
      code: 'invalid_type',
    });
  }
  return errors;
}

const duplicateView = (name: string) =>
  fail('conflict', {
    detail: `A saved view named "${name}" already exists.`,
    errors: [{ pointer: '/name', message: 'is already in use', code: 'duplicate' }],
  });

const viewHandlers: HttpHandler[] = [
  http.get('/v1/saved-views', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const params = new URL(request.url).searchParams;
    const resource = params.get('resource') ?? 'assets';
    const scope = params.get('scope') ?? 'all';
    if (!VIEW_RESOURCES.includes(resource) || !['all', 'mine', 'shared'].includes(scope)) {
      return fail('bad-request', { detail: 'Unsupported resource or scope.' });
    }
    const rows = w2()
      .savedViews.filter((v) => v.resource === resource)
      .filter((v) =>
        scope === 'mine'
          ? v.owner.id === guard.user.id
          : scope === 'shared'
            ? v.is_shared
            : canSee(v, guard.user.id),
      )
      .map((v) => ({ ...v, archived_at: null }));
    return paginate(
      request,
      rows,
      { sorts: { name_key: (v) => lowerName(v.name) }, defaultSort: 'name_key' },
      (v) =>
        viewOf(
          w2().savedViews.find((x) => x.id === v.id)!,
          guard.user.id,
        ),
    );
  }),

  http.post('/v1/saved-views', async ({ request }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = checkViewFields(body, true);
    if (errors.length > 0) return validation(errors);
    const name = String(body.name).trim();
    const mine = w2().savedViews.filter((v) => v.owner.id === guard.user.id);
    if (mine.length >= MAX_VIEWS) {
      return fail('conflict', {
        detail: `You already have ${MAX_VIEWS} saved views for this list. Delete one first.`,
      });
    }
    if (mine.some((v) => lowerName(v.name) === lowerName(name))) return duplicateView(name);
    const created = mutateW2((data) => {
      const stamp = nowIso();
      const view: MockSavedView = {
        id: newW2Id('view'),
        resource: 'assets',
        name,
        filters: (body.filters as Record<string, unknown> | undefined) ?? {},
        columns: (body.columns as string[] | undefined) ?? [],
        sort: (body.sort as string | null | undefined) ?? null,
        is_shared: false,
        owner: { id: guard.user.id, display_name: guard.user.display_name },
        created_at: stamp,
        updated_at: stamp,
        _v: 1,
      };
      data.savedViews.push(view);
      return view;
    });
    return HttpResponse.json(viewOf(created, guard.user.id), {
      status: 201,
      headers: { ETag: etagOf(created._v), Location: `/v1/saved-views/${created.id}` },
    });
  }),

  http.get('/v1/saved-views/:id', ({ request, params }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const found = w2().savedViews.find((v) => v.id === params.id);
    if (!found || !canSee(found, guard.user.id)) return notFound('View');
    return HttpResponse.json(viewOf(found, guard.user.id), { headers: { ETag: etagOf(found._v) } });
  }),

  http.patch('/v1/saved-views/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    // only the owner changes a view: anybody else (also for a shared one) gets a 404
    const found = w2().savedViews.find((v) => v.id === params.id && v.owner.id === guard.user.id);
    if (!found) return notFound('View');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = checkViewFields(body, false);
    if (errors.length > 0) return validation(errors);
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      const taken = w2().savedViews.some(
        (v) =>
          v.id !== found.id &&
          v.owner.id === found.owner.id &&
          lowerName(v.name) === lowerName(name),
      );
      if (taken) return duplicateView(name);
    }
    mutateW2(() => {
      if (typeof body.name === 'string') found.name = body.name.trim();
      if (body.filters !== undefined) found.filters = body.filters as Record<string, unknown>;
      if (body.columns !== undefined) found.columns = body.columns as string[];
      if (body.sort !== undefined) found.sort = body.sort as string | null;
      found.updated_at = nowIso();
      found._v += 1;
    });
    return HttpResponse.json(viewOf(found, guard.user.id), { headers: { ETag: etagOf(found._v) } });
  }),

  http.delete('/v1/saved-views/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const found = w2().savedViews.find((v) => v.id === params.id && v.owner.id === guard.user.id);
    if (!found) return notFound('View');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    mutateW2((data) => {
      data.savedViews = data.savedViews.filter((v) => v.id !== found.id);
    });
    return new HttpResponse(null, { status: 204 });
  }),

  http.put('/v1/saved-views/:id/sharing', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'view:share' });
    if (!guard.ok) return guard.response;
    const found = w2().savedViews.find((v) => v.id === params.id && v.owner.id === guard.user.id);
    if (!found) return notFound('View');
    const stale = checkIfMatch(request, found._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['shared']);
    if (typeof body.shared !== 'boolean') {
      errors.push({
        pointer: '/shared',
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
    if (errors.length > 0) return validation(errors);
    if (found.is_shared !== body.shared) {
      if (
        body.shared === true &&
        w2().savedViews.some(
          (v) => v.is_shared && v.id !== found.id && lowerName(v.name) === lowerName(found.name),
        )
      ) {
        return fail('conflict', {
          detail: 'A shared view with this name already exists. Rename the view first.',
        });
      }
      mutateW2(() => {
        found.is_shared = body.shared as boolean;
        found.updated_at = nowIso();
        found._v += 1;
      });
    }
    return HttpResponse.json(viewOf(found, guard.user.id), { headers: { ETag: etagOf(found._v) } });
  }),
];

// ==== CSV exports ====================================================================

/** How long the (simulated) worker takes; tests shorten it. */
let exportDelayMs = 1200;
export function setMockExportDelay(ms: number): void {
  exportDelayMs = ms;
}

const MAX_PENDING_EXPORTS = 5;
const FORBIDDEN_FILTERS = ['limit', 'cursor', 'include_total', 'fields', 'expand'];
const READ_PERMISSION: Record<string, string> = {
  assets: 'asset:read',
  people: 'person:read',
  locations: 'location:read',
};

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** Like the API: UTF-8 byte order mark, CRLF line ends, formula-looking cells get an apostrophe. */
const csvCell = (value: unknown): string => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvOf = (header: string[], rows: unknown[][]) =>
  `${BYTE_ORDER_MARK}${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** The CSV of what a list shows for these filters, and how many rows it has. */
function exportCsv(
  resource: string,
  filters: Record<string, unknown>,
): { csv: string; rows: number } {
  const data = registry();
  const params = filterParams(filters);
  const q = (params.get('q') ?? '').trim().toLowerCase();
  if (resource === 'people') {
    const rows = data.people
      .filter((p) => (params.get('archived') === 'include' ? true : !p.archived_at))
      .filter((p) => !q || [p.display_name, p.email].some((v) => v?.toLowerCase().includes(q)))
      .filter((p) => !params.get('status') || p.status === params.get('status'))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return {
      csv: csvOf(
        ['display_name', 'email', 'kind', 'status'],
        rows.map((p) => [p.display_name, p.email, p.kind, p.status]),
      ),
      rows: rows.length,
    };
  }
  if (resource === 'locations') {
    const rows = data.locations
      .filter((l) => (params.get('archived') === 'include' ? true : !l.archived_at))
      .filter((l) => !q || l.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      csv: csvOf(
        ['name', 'kind'],
        rows.map((l) => [l.name, l.kind]),
      ),
      rows: rows.length,
    };
  }
  const rows = matchAssets(filters);
  return {
    csv: csvOf(
      [
        'asset_tag',
        'name',
        'serial',
        'category',
        'status',
        'location',
        'purchase_date',
        'warranty_end',
      ],
      rows.map((a) => [
        a.asset_tag,
        a.name,
        a.serial,
        data.categories.find((c) => c.id === a.category_id)?.name,
        data.statusLabels.find((s) => s.id === a.status_id)?.name,
        data.locations.find((l) => l.id === a.location_id)?.name,
        a.purchase_date,
        a.warranty_end,
      ]),
    ),
    rows: rows.length,
  };
}

/** The job as the API shows it (a link only to `GET /v1/exports/{id}`), moving it along when its time has come. */
function exportView(job: MockExport, withLink: boolean, advance = true) {
  if (advance && job.status === 'queued' && Date.now() >= job.ready_at - exportDelayMs / 2) {
    mutateW2(() => {
      job.status = 'running';
      job.started_at = nowIso();
    });
  }
  if (
    advance &&
    (job.status === 'queued' || job.status === 'running') &&
    Date.now() >= job.ready_at
  ) {
    mutateW2((data) => {
      if (job.fail) {
        job.status = 'failed';
        job.error = 'The export could not be written.';
      } else {
        job.status = 'succeeded';
        job.completed_at = nowIso();
        job.row_count = job.rows ?? 0;
        job.expires_at = new Date(Date.now() + 24 * 3_600_000).toISOString();
        job.filename = `${job.resource}-${job.id.slice(-6)}.csv`;
        job.size_bytes = job.csv?.length ?? 0;
        notify(data, job.requested_by, {
          type: 'export.completed',
          title: 'Your export is ready',
          body: `${job.filename} (${job.row_count ?? 0} rows) is ready to download. The file is removed after 24 hours.`,
          entity_type: 'export',
          entity_id: job.id,
        });
      }
    });
  }
  const { csv: _csv, rows: _rows, ready_at: _ready, fail: _fail, ...rest } = job;
  const live = withLink && rest.status === 'succeeded';
  return {
    ...rest,
    status:
      rest.status === 'succeeded' && rest.expires_at && Date.parse(rest.expires_at) <= Date.now()
        ? ('expired' as const)
        : rest.status,
    download_url: live ? `/mock-storage/exports/${job.id}.csv` : null,
    download_expires_at: live ? new Date(Date.now() + 5 * 60_000).toISOString() : null,
  };
}

const exportHandlers: HttpHandler[] = [
  http.post('/v1/exports', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'export:run' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = rejectUnknown(body, ['resource', 'format', 'filters']);
    const resource = String(body.resource);
    if (!(resource in READ_PERMISSION)) {
      errors.push({ pointer: '/resource', message: 'Invalid option', code: 'invalid_value' });
    }
    if (body.format !== undefined && body.format !== 'csv') {
      errors.push({ pointer: '/format', message: 'Invalid option', code: 'invalid_value' });
    }
    const filters = body.filters ?? {};
    if (typeof filters !== 'object' || filters === null || Array.isArray(filters)) {
      errors.push({
        pointer: '/filters',
        message: 'Invalid input: expected object',
        code: 'invalid_type',
      });
    } else {
      for (const [key, value] of Object.entries(filters)) {
        const ok =
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          (Array.isArray(value) && value.every((v) => typeof v === 'string'));
        if (!ok) {
          errors.push({
            pointer: `/filters/${key}`,
            message: 'Invalid input',
            code: 'invalid_type',
          });
        }
      }
    }
    if (errors.length > 0) return validation(errors);
    if (!hasPermission(guard.user.permissions, READ_PERMISSION[resource]!)) {
      return problem(403, 'forbidden', 'You do not have permission to do this', {
        detail: `Exporting ${resource} needs the ${READ_PERMISSION[resource]} permission as well.`,
      });
    }
    const flat = filters as Record<string, unknown>;
    const forbidden = FORBIDDEN_FILTERS.filter((key) => flat[key] !== undefined);
    if (forbidden.length > 0) {
      return validation(
        forbidden.map((key) => ({
          pointer: `/filters/${key}`,
          message: 'paging and presentation parameters do not apply to an export',
          code: 'invalid',
        })),
      );
    }
    const pending = w2().exports.filter(
      (e) => e.requested_by === guard.user.id && (e.status === 'queued' || e.status === 'running'),
    ).length;
    if (pending >= MAX_PENDING_EXPORTS) {
      return fail('conflict', {
        detail: `You already have ${MAX_PENDING_EXPORTS} exports waiting. Wait for one to finish.`,
      });
    }
    const made = exportCsv(resource, flat);
    const job = mutateW2((data) => {
      const row: MockExport = {
        id: newW2Id('export'),
        resource: resource as MockExport['resource'],
        format: 'csv',
        status: 'queued',
        // normalised to query-string form, like the API stores them
        filters: Object.fromEntries(
          Object.entries(flat).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]),
        ),
        row_count: null,
        size_bytes: null,
        filename: null,
        error: null,
        requested_by: guard.user.id,
        created_at: nowIso(),
        started_at: null,
        completed_at: null,
        expires_at: null,
        download_url: null,
        download_expires_at: null,
        csv: made.csv,
        rows: made.rows,
        ready_at: Date.now() + exportDelayMs,
        fail: /fail/i.test(String(flat.q ?? '')),
      };
      data.exports.push(row);
      return row;
    });
    return HttpResponse.json(exportView(job, false, false), {
      status: 202,
      headers: { Location: `/v1/exports/${job.id}`, 'Retry-After': '2' },
    });
  }),

  http.get('/v1/exports', ({ request }) => {
    const guard = requireSession(request, { permission: 'export:run' });
    if (!guard.ok) return guard.response;
    const statuses = (new URL(request.url).searchParams.get('status') ?? '')
      .split(',')
      .filter(Boolean);
    const mine = w2()
      .exports.filter((e) => e.requested_by === guard.user.id)
      .filter((e) => statuses.length === 0 || statuses.includes(e.status))
      .map((e) => ({ ...e, archived_at: null, _v: 1 }));
    return paginate(
      request,
      mine,
      { sorts: { created_at: (e) => e.created_at }, defaultSort: '-created_at' },
      (e) =>
        exportView(
          w2().exports.find((x) => x.id === e.id)!,
          false,
        ),
    );
  }),

  http.get('/v1/exports/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'export:run' });
    if (!guard.ok) return guard.response;
    const found = w2().exports.find((e) => e.id === params.id && e.requested_by === guard.user.id);
    if (!found) return notFound('Export');
    return HttpResponse.json(exportView(found, true));
  }),

  // The "storage" the download link points at (not part of the contract).
  http.get('/mock-storage/exports/:name', ({ params }) => {
    const id = String(params.name).replace(/\.csv$/, '');
    const found = w2().exports.find((e) => e.id === id && e.status === 'succeeded');
    if (!found?.csv) return new HttpResponse(null, { status: 404 });
    return new HttpResponse(found.csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${found.filename ?? 'export.csv'}"`,
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
