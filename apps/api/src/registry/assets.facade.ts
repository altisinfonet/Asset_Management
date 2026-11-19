import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { permits } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  ApiProblem,
  type FieldError,
  type BulkResponse,
  type IfMatch,
  type Page,
  assertIfMatch,
  bindingFor,
  decodeCursor,
  encodeCursor,
  parseFields,
  problem,
  runBulk,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import { Prisma, TenancyService, isUniqueViolation, type Tx } from '../tenancy/index.js';
import { AssetRefs } from './asset-refs.js';
import { type AssetAction, assertAssetAction, refuseAssetAction } from './asset-actions.js';
import { listHistory, writeAssetHistory, type HistoryEventDto } from './asset-history.js';
import {
  ASSET_FIELDS,
  type AssetDto,
  type AssetRow,
  type BareAssetRow,
  assertCursorValues,
  assetCountSql,
  assetDto,
  assetListSql,
  assetSortTerms,
  loadAsset,
  loadAssetRows,
  lockAsset,
  pickFields,
  withStatus,
  splitCustomFieldParams,
} from './asset-queries.js';
import { AssetTagService, tagExists } from './asset-tags.js';
import { ScanResolverRegistry } from './scan-resolvers.js';
import { ScanResolveThrottle } from './scan-throttle.js';
import { mergeCustomData, missingRequired, validateProvided } from './custom-fields.js';
import { categoryDto, locationDto, modelDto, vendorDto } from './dto.js';
import {
  RegistryBase,
  type TxScope,
  duplicate,
  invalidRef,
  stalePrecondition,
} from './registry-base.js';
import { inSavepoint } from './savepoint.js';
import {
  type AssetCreate,
  type AssetListQuery,
  type AssetUpdate,
  type BulkMoveBody,
  type BulkUpdateBody,
  CLONE_FIELDS,
  type CloneBody,
  type DisposeBody,
  type HistoryListQuery,
  M2_ONLY_ASSET_FILTERS,
  type MarkFoundBody,
  type MarkLostBody,
  type MoveBody,
  assetListSchema,
} from './schemas.js';

/** Maximum number of assets one bulk request may touch (documented in the contract). */
export const BULK_MAX = 100;

type Expandable = 'model' | 'category' | 'vendor' | 'location';
export interface AssetWithVersion {
  asset: AssetDto;
  version: number;
}

const toDate = (v: string | null | undefined): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`);

/** Fields recorded in the audit trail (the dto without noise). */
const auditView = (a: AssetDto): Record<string, unknown> => {
  const {
    created_at: _c,
    updated_at: _u,
    label_code: _l,
    status: _s,
    current_assignment: _a,
    expanded: _e,
    ...rest
  } = a as AssetDto & { expanded?: unknown };
  return rest;
};

/**
 * The asset registry's write and read model (M1-REG-05..10), the facade other modules (custody,
 * imports, labels in M2) call. Every write runs in ONE tenant transaction together with its audit
 * row and its outbox event, enforces `If-Match` through `UPDATE .. WHERE id AND version`, and
 * validates references and custom fields before touching the row (so a rejected request never
 * writes a thing).
 */
@Injectable()
export class AssetsFacade extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    private readonly tags: AssetTagService,
    private readonly scanThrottle: ScanResolveThrottle,
    private readonly scanResolvers: ScanResolverRegistry,
  ) {
    super(tenancy, audit, outbox);
  }

  // =========================================================================================
  // Reads

  async get(auth: AuthContext, id: string, expand?: Expandable[]): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const row = await loadAsset(trx, id);
      if (!row) throw problem.notFound('Asset not found.');
      const [expanded] = await this.expansions(trx, [row], expand);
      return { asset: assetDto(row, expanded), version: row.version };
    });
  }

  /** `GET /v1/assets`: filters, `cf[key]`, sort, keyset cursor, optional total. */
  async list(
    auth: TxScope,
    rawQuery: Record<string, unknown>,
  ): Promise<Page<Record<string, unknown>>> {
    const { query, cf } = this.parseListQuery(rawQuery);
    return this.listParsed(auth, query, cf);
  }

  /**
   * Validates the query string of the asset list (the same rules as `GET /v1/assets`) and returns the
   * parsed filters and the custom-field filters; throws the `400` problem the endpoint would answer.
   * An export validates its filters with it when it is requested and again when it runs.
   */
  parseListQuery(rawQuery: Record<string, unknown>): {
    query: AssetListQuery;
    cf: Array<{ key: string; raw: string }>;
  } {
    const { rest, cf } = splitCustomFieldParams(rawQuery);
    for (const name of M2_ONLY_ASSET_FILTERS) {
      if (rest[name] !== undefined) {
        throw problem.badRequest(
          `Query parameter "${name}" needs the loaner pools (a later M2 story) and is not available yet.`,
          [{ pointer: `query:${name}`, message: 'not available yet', code: 'not-supported' }],
        );
      }
    }
    const parsed = assetListSchema.safeParse(rest);
    if (!parsed.success) {
      const first = parsed.error.issues[0]!;
      const name = String(first.path[0] ?? '');
      throw new ApiProblem({
        code: 'bad-request',
        detail: `Query parameter "${name}": ${first.message}`,
        errors: parsed.error.issues.map((i) => ({
          pointer: `query:${String(i.path[0] ?? '')}`,
          message: i.message,
          code: i.code,
        })),
      });
    }
    return { query: parsed.data, cf };
  }

  async listParsed(
    auth: TxScope,
    q: AssetListQuery,
    cfRaw: Array<{ key: string; raw: string }>,
  ): Promise<Page<Record<string, unknown>>> {
    const fields = parseFields(q.fields, ASSET_FIELDS);
    const terms = assetSortTerms(q.sort);
    // Every sort key travels in the cursor as the text the row carries (`k0`, `k1`, ...).
    const sortTerms = terms.map((t, i) => ({ ...t, column: `k${i}` }));
    const filters = {
      ...q,
      cursor: undefined,
      limit: undefined,
      include_total: undefined,
      fields: undefined,
      expand: undefined,
      cf: cfRaw,
    };
    const binding = bindingFor(terms, filters);
    const values = q.cursor ? decodeCursor(q.cursor, sortTerms, binding) : undefined;
    if (values) assertCursorValues(terms, values);

    return this.tx(auth, async (trx) => {
      const cf = await this.customFieldFilters(trx, cfRaw);
      const rows = await trx.$queryRaw<BareAssetRow[]>(assetListSql(q, cf, terms, values));

      const hasMore = rows.length > q.limit;
      const data = await withStatus(trx, hasMore ? rows.slice(0, q.limit) : rows);
      const last = data.at(-1);
      const expansions = await this.expansions(trx, data, q.expand);
      const page: Page<Record<string, unknown>>['page'] = {
        next_cursor:
          hasMore && last
            ? encodeCursor(sortTerms, binding, last as unknown as Record<string, unknown>)
            : null,
        has_more: hasMore,
      };
      if (q.include_total) {
        const [c] = await trx.$queryRaw<Array<{ n: bigint }>>(assetCountSql(q, cf));
        page.total = Number(c?.n ?? 0);
      }
      return {
        data: data.map((r, i) =>
          pickFields(
            assetDto(r, expansions[i]) as Record<string, unknown>,
            fields ? Object.keys(fields) : undefined,
          ),
        ),
        page,
      };
    });
  }

  private async customFieldFilters(trx: Tx, raw: Array<{ key: string; raw: string }>) {
    if (raw.length === 0) return [];
    const defs = await trx.custom_field_def.findMany({
      where: { key: { in: raw.map((r) => r.key) } },
      select: { key: true, data_type: true, archived_at: true },
    });
    return raw.map(({ key, raw: value }) => {
      const def =
        defs.find((d) => d.key === key && !d.archived_at) ?? defs.find((d) => d.key === key);
      if (!def) {
        throw problem.badRequest(
          `Query parameter "cf[${key}]": no custom field with the key "${key}".`,
          [{ pointer: `query:cf[${key}]`, message: 'unknown custom field', code: 'invalid_value' }],
        );
      }
      switch (def.data_type) {
        case 'number': {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            throw problem.badRequest(`Query parameter "cf[${key}]" must be a number.`);
          }
          return { key, value: n };
        }
        case 'boolean':
          if (value !== 'true' && value !== 'false') {
            throw problem.badRequest(`Query parameter "cf[${key}]" must be true or false.`);
          }
          return { key, value: value === 'true' };
        case 'multiselect':
          return { key, value: [value] };
        default:
          return { key, value };
      }
    });
  }

  private async expansions(
    trx: Tx,
    rows: AssetRow[],
    expand: Expandable[] | undefined,
  ): Promise<Array<Record<string, unknown> | undefined>> {
    if (!expand || expand.length === 0 || rows.length === 0) return rows.map(() => undefined);
    const ids = (pick: (r: AssetRow) => string | null) => [
      ...new Set(rows.map(pick).filter((v): v is string => v !== null)),
    ];
    const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
    const models = expand.includes('model')
      ? byId(await trx.asset_model.findMany({ where: { id: { in: ids((r) => r.model_id) } } }))
      : null;
    const categories = expand.includes('category')
      ? byId(await trx.category.findMany({ where: { id: { in: ids((r) => r.category_id) } } }))
      : null;
    const vendors = expand.includes('vendor')
      ? byId(await trx.vendor.findMany({ where: { id: { in: ids((r) => r.vendor_id) } } }))
      : null;
    const locations = expand.includes('location')
      ? byId(await trx.location.findMany({ where: { id: { in: ids((r) => r.location_id) } } }))
      : null;
    return rows.map((r) => ({
      ...(locations
        ? {
            location:
              r.location_id && locations.get(r.location_id)
                ? locationDto(locations.get(r.location_id)!)
                : null,
          }
        : {}),
      ...(models
        ? { model: r.model_id && models.get(r.model_id) ? modelDto(models.get(r.model_id)!) : null }
        : {}),
      ...(categories
        ? {
            category: categories.get(r.category_id)
              ? categoryDto(categories.get(r.category_id)!)
              : null,
          }
        : {}),
      ...(vendors
        ? {
            vendor:
              r.vendor_id && vendors.get(r.vendor_id) ? vendorDto(vendors.get(r.vendor_id)!) : null,
          }
        : {}),
    }));
  }

  /** `GET /v1/scan/resolve`: the opaque QR `label_code` or a Code128 `asset_tag`. */
  async resolveScan(auth: AuthContext, rawCode: string) {
    // The whole code first (a tag may contain "/"); a label URL then yields its last path segment.
    const whole = rawCode.trim();
    const candidates = [whole];
    if (/^(https?:\/\/|\/)/i.test(whole)) {
      const last = whole.split(/[?#]/)[0]!.split('/').filter(Boolean).pop();
      if (last && last !== whole) candidates.push(last);
    }
    await this.scanThrottle.assertAllowed(auth);
    const found = await this.tx(auth, async (trx) => {
      let matchType: 'label_code' | 'asset_tag' | 'serial' = 'label_code';
      let row: AssetRow | undefined;
      for (const code of candidates) {
        matchType = 'label_code';
        [row] = await loadAssetRows(trx, Prisma.sql`a.label_code = ${code}`, 1);
        if (!row) {
          matchType = 'asset_tag';
          [row] = await loadAssetRows(trx, Prisma.sql`a.asset_tag_key = lower(${code})`, 1);
        }
        if (!row) {
          // The serial number printed on the device. Not unique per tenant: an ambiguous one is
          // refused rather than guessed (a wrong asset must never be checked out by a scan).
          matchType = 'serial';
          const bySerial = await loadAssetRows(trx, Prisma.sql`a.serial_key = lower(${code})`, 2);
          if (bySerial.length > 1) {
            throw problem.conflict(
              'Several assets share this serial number. Scan the label or enter the asset tag instead.',
            );
          }
          row = bySerial[0];
        }
        if (row) break;
      }
      if (!row) {
        // [M2-W2 ACC] labelled records of other modules (accessories, consumables)
        return this.scanResolvers.resolve(auth, trx, candidates);
      }
      // Actions valid in the asset's current state AND for the caller (contract order).
      const allowed: string[] = [];
      const state = {
        archived: row.archived_at !== null,
        stateType: row.status_state_type,
        hasAssignment: row.assignment !== null && row.assignment !== undefined,
      };
      const may = (action: AssetAction, permission: string) =>
        permits(auth.permissions, permission) && refuseAssetAction(action, state) === null;
      if (may('checkout', 'asset:checkout')) allowed.push('checkout');
      if (may('checkin', 'asset:checkin')) allowed.push('checkin');
      if (may('transfer', 'asset:transfer')) allowed.push('transfer');
      if (may('update', 'asset:update')) allowed.push('update');
      if (may('open_repair', 'repair:manage')) allowed.push('open_repair');
      return {
        data: {
          match_type: matchType,
          entity_type: 'asset' as const,
          asset: assetDto(row),
          allowed_actions: allowed,
        },
        version: row.version,
      };
    });
    if (!found) {
      // Misses (and only misses) are counted: see ScanResolveThrottle.
      await this.scanThrottle.recordMiss(auth);
      throw problem.notFound('No record matches this code.');
    }
    return found;
  }

  // =========================================================================================
  // Writes

  async create(auth: AuthContext, body: AssetCreate): Promise<AssetWithVersion> {
    return this.tx(auth, (trx) => this.createInTx(trx, auth, body));
  }

  /** Create inside an open tenant transaction (also used by clone and, in M2, imports). */
  async createInTx(
    trx: Tx,
    auth: AuthContext,
    body: AssetCreate,
    meta?: Record<string, unknown>,
    pointerBase = '',
  ): Promise<AssetWithVersion> {
    const refs = AssetRefs.for(trx);
    const errors: FieldError[] = [];
    const at = (p: string) => `${pointerBase}${p}`;

    const category = await refs.category(body.category_id);
    if (!category || category.archived_at || category.kind !== 'asset') {
      errors.push(invalidRef(at('/category_id'), 'No such asset category.'));
    }
    await this.checkModel(refs, body.category_id, body.model_id, errors, pointerBase);
    const status = body.status_id ? await refs.status(body.status_id) : await refs.defaultStatus();
    if (!status || status.archived_at) {
      errors.push(
        invalidRef(
          at('/status_id'),
          body.status_id ? 'No such status label.' : 'The tenant has no default status label.',
        ),
      );
    }
    await this.checkOthers(refs, body, errors, undefined, pointerBase);
    const company = body.company_id
      ? await refs.company(body.company_id)
      : await refs.defaultCompany();
    if (!company) errors.push(invalidRef(at('/company_id'), 'No such company.'));

    let customData: Record<string, unknown> = {};
    if (category && !category.archived_at && category.kind === 'asset') {
      const defs = await refs.defs(body.category_id);
      const provided = validateProvided(defs, body.custom_data ?? {}, at('/custom_data'));
      errors.push(...provided.errors);
      customData = mergeCustomData({}, provided.values);
      errors.push(...missingRequired(defs, customData, at('/custom_data')));
    }
    if (errors.length > 0) throw problem.validation(errors);

    const manual = body.asset_tag !== undefined;
    let tag: string;
    if (manual) {
      tag = body.asset_tag!;
      if (await tagExists(trx, tag)) throw this.tagTaken(tag, pointerBase);
    } else {
      tag = await this.tags.allocate(trx, category!.tag_prefix);
    }

    const id = uuidv7();
    try {
      await trx.asset.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          company_id: company!.id,
          asset_tag: tag,
          name: body.name ?? null,
          serial: body.serial ? body.serial : null,
          category_id: body.category_id,
          model_id: body.model_id ?? null,
          status_id: status!.id,
          location_id: body.location_id ?? null,
          vendor_id: body.vendor_id ?? null,
          parent_asset_id: body.parent_asset_id ?? null,
          purchase_date: toDate(body.purchase_date) ?? null,
          purchase_cost_minor: body.purchase_cost ? BigInt(body.purchase_cost.amount_minor) : null,
          currency: body.purchase_cost ? body.purchase_cost.currency : null,
          order_number: body.order_number ?? null,
          warranty_end: toDate(body.warranty_end) ?? null,
          notes: body.notes ?? null,
          custom_data: customData as Prisma.InputJsonObject,
          external_source: body.external_source ?? null,
          external_id: body.external_id ?? null,
          created_by: auth.userId,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw body.external_source
          ? problem.conflict('An asset with this external source and id already exists.')
          : this.tagTaken(tag, pointerBase);
      }
      throw err;
    }
    const row = (await loadAsset(trx, id))!;
    const dto = assetDto(row);
    await this.record(trx, {
      entity: 'asset',
      verb: 'created',
      id,
      version: row.version,
      before: null,
      after: auditView(dto),
      ...(meta ? { meta } : {}),
      refs: { categoryId: row.category_id, statusId: row.status_id },
    });
    await writeAssetHistory(trx, auth, {
      assetId: id,
      eventType: 'created',
      summary: `Asset ${row.asset_tag} created`,
      payload: {
        status_id: row.status_id,
        location_id: row.location_id,
        ...(meta?.cloned_from ? { cloned_from: meta.cloned_from } : {}),
      },
    });
    return { asset: dto, version: row.version };
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: AssetUpdate,
  ): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const current = await loadAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      return this.updateInTx(trx, auth, current, body);
    });
  }

  /** Applies a PATCH to a loaded row (version already checked by the caller). */
  async updateInTx(
    trx: Tx,
    auth: AuthContext,
    current: AssetRow,
    body: AssetUpdate,
    meta?: Record<string, unknown>,
  ): Promise<AssetWithVersion> {
    if (current.archived_at) {
      throw problem.conflict('The asset is archived. Restore it before changing it.');
    }
    const refs = AssetRefs.for(trx);
    const errors: FieldError[] = [];

    if (
      body.asset_tag !== undefined &&
      body.asset_tag.toLowerCase() !== current.asset_tag.toLowerCase()
    ) {
      errors.push({
        pointer: '/asset_tag',
        message:
          'An asset tag is never changed or reused (ED-12); archive the asset and create a new one to re-tag.',
        code: 'immutable',
      });
    }
    if (body.company_id !== undefined && body.company_id !== current.company_id) {
      const company = await refs.company(body.company_id);
      if (!company) errors.push(invalidRef('/company_id', 'No such company.'));
    }

    const categoryId = body.category_id ?? current.category_id;
    const categoryChanged = categoryId !== current.category_id;
    if (categoryChanged) {
      const category = await refs.category(categoryId);
      if (!category || category.archived_at || category.kind !== 'asset') {
        errors.push(invalidRef('/category_id', 'No such asset category.'));
      }
    }
    const modelId = body.model_id !== undefined ? body.model_id : current.model_id;
    if (categoryChanged || body.model_id !== undefined) {
      await this.checkModel(refs, categoryId, modelId, errors);
    }
    if (body.status_id !== undefined && body.status_id !== current.status_id) {
      const status = await refs.status(body.status_id);
      if (!status || status.archived_at)
        errors.push(invalidRef('/status_id', 'No such status label.'));
    }
    if (body.image_attachment_id) {
      const att = await trx.attachment.findFirst({
        where: { id: body.image_attachment_id, archived_at: null },
        select: { entity_type: true, entity_id: true, content_type: true, scan_status: true },
      });
      if (!att || att.entity_type !== 'asset' || att.entity_id !== current.id) {
        errors.push(invalidRef('/image_attachment_id', 'No such image attachment of this asset.'));
      } else if (
        !att.content_type.startsWith('image/') ||
        ['infected', 'error'].includes(att.scan_status)
      ) {
        errors.push({
          pointer: '/image_attachment_id',
          message: 'The attachment is not a usable image.',
          code: 'invalid',
        });
      }
    }
    await this.checkOthers(
      refs,
      {
        vendor_id: body.vendor_id !== current.vendor_id ? body.vendor_id : undefined,
        parent_asset_id:
          body.parent_asset_id !== current.parent_asset_id ? body.parent_asset_id : undefined,
        location_id: body.location_id !== current.location_id ? body.location_id : undefined,
        external_source: body.external_source,
        external_id: body.external_id,
      },
      errors,
      current,
    );

    // Custom data: merge per key (`null` removes); validate what was sent, then what must exist.
    let nextCustom = current.custom_data;
    if (body.custom_data !== undefined || categoryChanged) {
      const defs = await refs.defs(categoryId);
      const provided = validateProvided(defs, body.custom_data ?? {});
      errors.push(...provided.errors);
      nextCustom = mergeCustomData(current.custom_data, provided.values);
      if (categoryChanged) {
        // Values of the OLD category's fields do not carry over silently.
        const known = new Set(defs.map((d) => d.key));
        const active = await refs.activeKeys();
        for (const key of Object.keys(nextCustom)) {
          if (!known.has(key) && active.has(key)) {
            errors.push({
              pointer: `/custom_data/${key}`,
              message: 'belongs to a field of the previous category: set it to null to remove it',
              code: 'unknown-field',
            });
          }
        }
      }
      errors.push(...missingRequired(defs, nextCustom));
    }
    if (errors.length > 0) throw problem.validation(errors);

    const data: Record<string, unknown> = {};
    const set = (column: keyof AssetRow, value: unknown, same?: boolean) => {
      const before = current[column] as unknown;
      const equal = same ?? JSON.stringify(before) === JSON.stringify(value);
      if (!equal) data[column as string] = value;
    };
    if (body.name !== undefined) set('name', body.name);
    if (body.serial !== undefined) set('serial', body.serial === '' ? null : body.serial);
    if (categoryChanged) set('category_id', categoryId);
    if (body.model_id !== undefined) set('model_id', body.model_id);
    if (body.status_id !== undefined) set('status_id', body.status_id);
    if (body.location_id !== undefined) set('location_id', body.location_id);
    if (body.vendor_id !== undefined) set('vendor_id', body.vendor_id);
    if (body.parent_asset_id !== undefined) set('parent_asset_id', body.parent_asset_id);
    if (body.company_id !== undefined) set('company_id', body.company_id);
    if (body.purchase_date !== undefined) {
      const next = toDate(body.purchase_date) ?? null;
      set(
        'purchase_date',
        next,
        (current.purchase_date?.getTime() ?? null) === (next?.getTime() ?? null),
      );
    }
    if (body.warranty_end !== undefined) {
      const next = toDate(body.warranty_end) ?? null;
      set(
        'warranty_end',
        next,
        (current.warranty_end?.getTime() ?? null) === (next?.getTime() ?? null),
      );
    }
    if (body.purchase_cost !== undefined) {
      const minor = body.purchase_cost ? BigInt(body.purchase_cost.amount_minor) : null;
      const currency = body.purchase_cost ? body.purchase_cost.currency : null;
      set('purchase_cost_minor', minor, current.purchase_cost_minor === minor);
      set('currency', currency, current.currency === currency);
    }
    if (body.image_attachment_id !== undefined)
      set('image_attachment_id', body.image_attachment_id);
    if (body.order_number !== undefined) set('order_number', body.order_number);
    if (body.notes !== undefined) set('notes', body.notes);
    if (body.external_source !== undefined) set('external_source', body.external_source);
    if (body.external_id !== undefined) set('external_id', body.external_id);
    if (body.custom_data !== undefined || categoryChanged) set('custom_data', nextCustom);

    if (Object.keys(data).length === 0)
      return { asset: assetDto(current), version: current.version };

    const result = await trx.asset.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...data, updated_by: auth.userId } as Prisma.assetUpdateManyMutationInput,
    });
    if (result.count === 0) {
      return stalePrecondition(() => trx.asset.findUnique({ where: { id: current.id } }), 'Asset');
    }
    const row = (await loadAsset(trx, current.id))!;
    const before = auditView(assetDto(current));
    const after = auditView(assetDto(row));
    await this.record(trx, {
      entity: 'asset',
      verb: 'updated',
      id: current.id,
      version: row.version,
      before,
      after,
      ...(meta ? { meta } : {}),
      refs: { statusId: row.status_id, categoryId: row.category_id },
    });
    await this.historyForUpdate(trx, auth, current, row, Object.keys(data));
    return { asset: assetDto(row), version: row.version };
  }

  /** The timeline entries of a PATCH: status change, location change, and "updated" for the rest. */
  private async historyForUpdate(
    trx: Tx,
    auth: AuthContext,
    before: AssetRow,
    after: AssetRow,
    changed: string[],
  ): Promise<void> {
    if (changed.includes('status_id')) {
      await writeAssetHistory(trx, auth, {
        assetId: after.id,
        eventType: 'status_changed',
        summary: `Status changed from ${before.status_name} to ${after.status_name}`,
        payload: {
          from: before.status_id,
          to: after.status_id,
          from_name: before.status_name,
          to_name: after.status_name,
        },
      });
    }
    if (changed.includes('location_id')) await this.writeLocationChange(trx, auth, before, after);
    const other = changed.filter((c) => c !== 'status_id' && c !== 'location_id');
    if (other.length > 0) {
      await writeAssetHistory(trx, auth, {
        assetId: after.id,
        eventType: 'updated',
        summary: `Updated ${other.join(', ')}`,
        payload: { fields: other },
      });
    }
  }

  /** `location_changed` history entry with the names of both places (for a readable timeline). */
  private async writeLocationChange(
    trx: Tx,
    auth: AuthContext,
    before: Pick<AssetRow, 'id' | 'location_id'>,
    after: Pick<AssetRow, 'id' | 'location_id'>,
    note?: string,
  ): Promise<void> {
    const ids = [before.location_id, after.location_id].filter((v): v is string => v !== null);
    const names = new Map(
      (
        await trx.location.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((l) => [l.id, l.name]),
    );
    const name = (id: string | null) => (id ? (names.get(id) ?? 'unknown') : 'no location');
    await writeAssetHistory(trx, auth, {
      assetId: after.id,
      eventType: 'location_changed',
      summary: `Moved from ${name(before.location_id)} to ${name(after.location_id)}`,
      payload: {
        from: before.location_id,
        to: after.location_id,
        from_name: before.location_id ? name(before.location_id) : null,
        to_name: after.location_id ? name(after.location_id) : null,
        ...(note ? { note } : {}),
      },
    });
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const current = await loadAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      await this.setArchived(trx, auth, current, true);
    });
  }

  async restore(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const current = await loadAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      return this.setArchived(trx, auth, current, false);
    });
  }

  /** Soft delete / restore. M2 adds the "not while checked out or in repair" rule here. */
  private async setArchived(
    trx: Tx,
    auth: AuthContext,
    current: AssetRow,
    archive: boolean,
    meta?: Record<string, unknown>,
  ): Promise<AssetWithVersion> {
    if (archive && current.archived_at) throw problem.conflict('The asset is already archived.');
    if (!archive && !current.archived_at) throw problem.conflict('The asset is not archived.');
    if (archive) {
      // M2-LIFE-02: an asset in somebody's custody cannot be archived (check it in first).
      const [open] = await trx.$queryRaw<Array<{ n: bigint }>>`
        select count(*) as n from app.assignment
         where asset_id = ${current.id}::uuid and checked_in_at is null`;
      if (open && open.n > 0n) {
        throw problem.conflict('The asset is checked out. Check it in before archiving it.');
      }
      await this.assertNoOpenRepair(trx, current.id, 'archiving it');
    }
    // Restoring a DISPOSED asset takes it back for real: the disposal record is cleared and an
    // archived-type status moves to the tenant default (so it is not "retired" yet active).
    const wasDisposed = !archive && current.disposed_on !== null;
    let statusId: string | undefined;
    if (wasDisposed && current.status_state_type === 'archived') {
      statusId = (await AssetRefs.for(trx).defaultStatus())?.id;
    }
    const result = await trx.asset.updateMany({
      where: { id: current.id, version: current.version },
      data: {
        archived_at: archive ? new Date() : null,
        updated_by: auth.userId,
        ...(wasDisposed ? { disposed_on: null, disposal_reason: null, disposal_note: null } : {}),
        ...(statusId ? { status_id: statusId } : {}),
      },
    });
    if (result.count === 0) {
      return stalePrecondition(() => trx.asset.findUnique({ where: { id: current.id } }), 'Asset');
    }
    const row = (await loadAsset(trx, current.id))!;
    await this.record(trx, {
      entity: 'asset',
      verb: archive ? 'archived' : 'restored',
      id: current.id,
      version: row.version,
      before: { archived_at: current.archived_at ? current.archived_at.toISOString() : null },
      after: { archived_at: row.archived_at ? row.archived_at.toISOString() : null },
      ...(meta ? { meta } : {}),
      refs: { statusId: row.status_id, categoryId: row.category_id },
    });
    await writeAssetHistory(trx, auth, {
      assetId: row.id,
      eventType: archive ? 'archived' : 'restored',
      summary: archive ? 'Asset archived' : 'Asset restored',
      payload: wasDisposed ? { was_disposed: true } : {},
    });
    return { asset: assetDto(row), version: row.version };
  }

  // =========================================================================================
  // Moves, disposal, lost and found, history (M2-LOC-02, M2-LIFE-05, M2-LIFE-06)

  /** `POST /v1/assets/{id}/move`: the asset row is locked, so concurrent moves apply one after the other. */
  async move(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: MoveBody,
  ): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const current = await lockAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      return this.moveInTx(trx, auth, current, body);
    });
  }

  private async moveInTx(
    trx: Tx,
    auth: AuthContext,
    current: AssetRow,
    body: MoveBody,
    meta?: Record<string, unknown>,
  ): Promise<AssetWithVersion> {
    assertAssetAction('move', this.stateOf(current));
    if (body.location_id) {
      const location = await AssetRefs.for(trx).location(body.location_id);
      if (!location || location.archived_at) {
        throw problem.validation([invalidRef('/location_id', 'No such location.')]);
      }
    }
    if (body.location_id === current.location_id) {
      return { asset: assetDto(current), version: current.version };
    }
    const result = await trx.asset.updateMany({
      where: { id: current.id, version: current.version },
      data: { location_id: body.location_id, updated_by: auth.userId },
    });
    if (result.count === 0) {
      return stalePrecondition(() => trx.asset.findUnique({ where: { id: current.id } }), 'Asset');
    }
    const row = (await loadAsset(trx, current.id))!;
    await this.record(trx, {
      entity: 'asset',
      verb: 'moved',
      id: current.id,
      version: row.version,
      before: { location_id: current.location_id },
      after: { location_id: row.location_id },
      meta: { ...(meta ?? {}), ...(body.note ? { note: body.note } : {}) },
      refs: { fromLocationId: current.location_id, toLocationId: row.location_id },
    });
    await this.writeLocationChange(trx, auth, current, row, body.note);
    return { asset: assetDto(row), version: row.version };
  }

  /** `POST /v1/assets/bulk-move`: one result per id; a failing item does not touch the others. */
  async bulkMove(auth: AuthContext, body: BulkMoveBody): Promise<BulkResponse<AssetDto>> {
    const unique = [...new Set(body.ids)];
    return this.tx(auth, async (trx) => {
      const bulkId = uuidv7();
      const response = await runBulk(
        unique,
        (id) =>
          inSavepoint(trx, async () => {
            const current = await lockAsset(trx, id);
            if (!current) throw problem.notFound('Asset not found.');
            return (
              await this.moveInTx(
                trx,
                auth,
                current,
                { location_id: body.location_id, note: body.note },
                { bulk_operation_id: bulkId },
              )
            ).asset;
          }),
        { max: BULK_MAX, pointer: '/ids' },
      );
      await this.audit.write(trx, {
        action: 'asset.bulk_move',
        entityType: 'bulk_operation',
        entityId: bulkId,
        meta: {
          operation: 'move',
          requested: unique.length,
          succeeded: response.summary.succeeded,
          failed: response.summary.failed,
          location_id: body.location_id,
          asset_ids: response.results.filter((r) => !r.error).map((r) => (r.data as AssetDto).id),
        },
      });
      await this.outbox.publish(trx, {
        type: 'bulk_operation.completed',
        aggregateType: 'bulk_operation',
        aggregateId: bulkId,
        payload: { operation: 'move', total: unique.length, failed: response.summary.failed },
      });
      return response;
    });
  }

  private stateOf(row: AssetRow) {
    return {
      archived: row.archived_at !== null,
      stateType: row.status_state_type,
      hasAssignment: row.assignment !== null && row.assignment !== undefined,
    };
  }

  /** `POST /v1/assets/{id}/dispose` (M2-LIFE-05): archived-type status + archive + disposal record. */
  /** M2-MNT-01: an asset with an open repair cannot be archived or disposed of (complete or cancel it first). */
  private async assertNoOpenRepair(trx: Tx, assetId: string, doing: string): Promise<void> {
    const [repairs] = await trx.$queryRaw<Array<{ n: bigint }>>`
      select count(*) as n from app.maintenance_record
       where asset_id = ${assetId}::uuid and status in ('open', 'in_progress') and archived_at is null`;
    if (repairs && repairs.n > 0n) {
      throw problem.conflict(
        `The asset has an open repair. Complete or cancel it before ${doing}.`,
      );
    }
  }

  async dispose(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: DisposeBody,
  ): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const current = await lockAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      assertAssetAction('dispose', this.stateOf(current));
      await this.assertNoOpenRepair(trx, current.id, 'disposing of it');
      const status = await this.statusOfType(trx, 'archived', body.status_id);
      const disposedOn = body.disposed_on
        ? new Date(`${body.disposed_on}T00:00:00Z`)
        : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      const result = await trx.asset.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          status_id: status.id,
          archived_at: new Date(),
          disposed_on: disposedOn,
          disposal_reason: body.reason,
          disposal_note: body.note ?? null,
          updated_by: auth.userId,
        },
      });
      if (result.count === 0) {
        return stalePrecondition(
          () => trx.asset.findUnique({ where: { id: current.id } }),
          'Asset',
        );
      }
      const row = (await loadAsset(trx, current.id))!;
      await this.record(trx, {
        entity: 'asset',
        verb: 'disposed',
        id: current.id,
        version: row.version,
        before: { status_id: current.status_id, archived_at: null },
        after: {
          status_id: row.status_id,
          archived_at: row.archived_at?.toISOString() ?? null,
          disposal: assetDto(row).disposal,
        },
        refs: { statusId: row.status_id, categoryId: row.category_id },
      });
      await writeAssetHistory(trx, auth, {
        assetId: row.id,
        eventType: 'archived',
        summary: `Disposed of (${body.reason})`,
        payload: {
          disposal: assetDto(row).disposal,
          from: current.status_id,
          to: row.status_id,
          from_name: current.status_name,
          to_name: row.status_name,
        },
      });
      return { asset: assetDto(row), version: row.version };
    });
  }

  /**
   * `POST /v1/assets/{id}/mark-lost` (M2-LIFE-05): lost status; an open custody period is closed
   * (the holder is no longer holding it) in the same transaction.
   */
  async markLost(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: MarkLostBody,
  ): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const current = await lockAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      assertAssetAction('mark_lost', this.stateOf(current));
      const status = await this.statusOfType(trx, 'lost', body.status_id);
      let closed: string | null = null;
      if (current.assignment) {
        closed = current.assignment.assignment_id;
        await trx.$executeRaw`
          update app.assignment
             set checked_in_at = now(), quantity_returned = quantity,
                 checked_in_by = ${auth.userId}::uuid,
                 checkin_note = ${body.note ? `Marked lost: ${body.note}` : 'Marked lost'}
           where id = ${closed}::uuid and checked_in_at is null`;
      }
      return this.finishStatusAction(
        trx,
        auth,
        current,
        { status_id: status.id },
        {
          verb: 'marked_lost',
          action: 'lost',
          summary: `Marked lost${body.note ? `: ${body.note}` : ''}`,
          note: body.note,
          assignmentId: closed,
        },
      );
    });
  }

  /** `POST /v1/assets/{id}/mark-found` (M2-LIFE-05): back to a deployable status (and place). */
  async markFound(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: MarkFoundBody,
  ): Promise<AssetWithVersion> {
    return this.tx(auth, async (trx) => {
      const current = await lockAsset(trx, id);
      if (!current) throw problem.notFound('Asset not found.');
      assertIfMatch(ifMatch, current.version);
      assertAssetAction('mark_found', this.stateOf(current));
      const status = await this.statusOfType(trx, 'deployable', body.status_id, true);
      if (body.location_id) {
        const location = await AssetRefs.for(trx).location(body.location_id);
        if (!location || location.archived_at) {
          throw problem.validation([invalidRef('/location_id', 'No such location.')]);
        }
      }
      return this.finishStatusAction(
        trx,
        auth,
        current,
        {
          status_id: status.id,
          ...(body.location_id !== undefined ? { location_id: body.location_id } : {}),
        },
        {
          verb: 'marked_found',
          action: 'found',
          summary: `Marked found${body.note ? `: ${body.note}` : ''}`,
          note: body.note,
          assignmentId: null,
        },
      );
    });
  }

  /** Writes a status (and maybe location) change with its audit, outbox and history rows. */
  private async finishStatusAction(
    trx: Tx,
    auth: AuthContext,
    current: AssetRow,
    data: { status_id: string; location_id?: string | null },
    what: {
      verb: string;
      action: 'lost' | 'found';
      summary: string;
      note?: string | undefined;
      assignmentId: string | null;
    },
  ): Promise<AssetWithVersion> {
    const result = await trx.asset.updateMany({
      where: { id: current.id, version: current.version },
      data: { ...data, updated_by: auth.userId },
    });
    if (result.count === 0) {
      return stalePrecondition(() => trx.asset.findUnique({ where: { id: current.id } }), 'Asset');
    }
    const row = (await loadAsset(trx, current.id))!;
    await this.record(trx, {
      entity: 'asset',
      verb: what.verb,
      id: current.id,
      version: row.version,
      before: { status_id: current.status_id, location_id: current.location_id },
      after: { status_id: row.status_id, location_id: row.location_id },
      ...(what.note ? { meta: { note: what.note } } : {}),
      refs: { statusId: row.status_id, categoryId: row.category_id },
    });
    await writeAssetHistory(trx, auth, {
      assetId: row.id,
      eventType: 'status_changed',
      summary: what.summary,
      assignmentId: what.assignmentId,
      payload: {
        action: what.action,
        from: current.status_id,
        to: row.status_id,
        from_name: current.status_name,
        to_name: row.status_name,
        ...(what.note ? { note: what.note } : {}),
      },
    });
    if (row.location_id !== current.location_id) {
      await this.writeLocationChange(trx, auth, current, row, what.note);
    }
    return { asset: assetDto(row), version: row.version };
  }

  /**
   * A status label of the given state type: the explicit `statusId` (which must be of that type),
   * else the tenant default when it has the type, else the first label of the type by position.
   */
  private async statusOfType(
    trx: Tx,
    stateType: string,
    statusId: string | undefined,
    preferDefault = false,
  ): Promise<{ id: string }> {
    if (statusId) {
      const status = await AssetRefs.for(trx).status(statusId);
      if (!status || status.archived_at || status.state_type !== stateType) {
        throw problem.validation([
          {
            pointer: '/status_id',
            message: `must be an active status label of type "${stateType}"`,
            code: 'invalid',
          },
        ]);
      }
      return status;
    }
    if (preferDefault) {
      const def = await AssetRefs.for(trx).defaultStatus();
      if (def && def.state_type === stateType) return def;
    }
    const first = await trx.status_label.findFirst({
      where: { state_type: stateType, archived_at: null },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    if (!first) {
      throw problem.validation([
        {
          pointer: '/status_id',
          message: `the tenant has no active status label of type "${stateType}"; create one first`,
          code: 'not-found',
        },
      ]);
    }
    return first;
  }

  /** `GET /v1/assets/{id}/history`: the unified timeline (M2-LIFE-06). */
  async history(
    auth: AuthContext,
    id: string,
    query: HistoryListQuery,
  ): Promise<{ data: HistoryEventDto[]; page: Page<HistoryEventDto>['page'] }> {
    return this.tx(auth, async (trx) => {
      const exists = await trx.asset.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw problem.notFound('Asset not found.');
      return listHistory(
        trx,
        {
          assetId: id,
          ...(query.event_type ? { eventTypes: query.event_type } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
        },
        { ...(query.cursor ? { cursor: query.cursor } : {}), limit: query.limit },
      );
    });
  }

  // =========================================================================================
  // Clone and bulk

  /** `POST /v1/assets/{id}/clone`: N copies with fresh tags and no serial, all or nothing. */
  async clone(auth: AuthContext, id: string, body: CloneBody): Promise<{ data: AssetDto[] }> {
    return this.tx(auth, async (trx) => {
      const source = await loadAsset(trx, id);
      if (!source) throw problem.notFound('Asset not found.');
      const tags = body.asset_tags;
      if (tags && tags.length !== body.count) {
        throw problem.validation([
          {
            pointer: '/asset_tags',
            message: `needs exactly ${body.count} tags (one per copy)`,
            code: tags.length < body.count ? 'too_small' : 'too_big',
          },
        ]);
      }
      const copy = new Set<string>(body.copy_fields ?? CLONE_FIELDS);
      const base = this.cloneBase(source, copy);
      const created: AssetDto[] = [];
      for (let i = 0; i < body.count; i++) {
        const out = await this.createInTx(
          trx,
          auth,
          { ...base, ...(tags ? { asset_tag: tags[i]! } : {}) },
          { cloned_from: source.id },
        ).catch((err: unknown) => {
          if (err instanceof ApiProblem && err.code === 'conflict' && tags) {
            throw new ApiProblem({
              code: 'conflict',
              detail: err.detail,
              errors: [
                { pointer: `/asset_tags/${i}`, message: 'is already in use', code: 'duplicate' },
              ],
            });
          }
          throw err;
        });
        created.push(out.asset);
      }
      await this.audit.write(trx, {
        action: 'asset.cloned',
        entityType: 'asset',
        entityId: source.id,
        meta: { copies: created.map((c) => c.id), count: created.length },
      });
      return { data: created };
    });
  }

  private cloneBase(source: AssetRow, copy: Set<string>): AssetCreate {
    const cost =
      source.purchase_cost_minor !== null && source.currency
        ? { amount_minor: Number(source.purchase_cost_minor), currency: source.currency }
        : null;
    const date = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    return {
      category_id: source.category_id,
      ...(copy.has('name') ? { name: source.name } : {}),
      ...(copy.has('model_id') ? { model_id: source.model_id } : {}),
      ...(copy.has('status_id') ? { status_id: source.status_id } : {}),
      ...(copy.has('vendor_id') ? { vendor_id: source.vendor_id } : {}),
      ...(copy.has('parent_asset_id') ? { parent_asset_id: source.parent_asset_id } : {}),
      ...(copy.has('purchase_date') ? { purchase_date: date(source.purchase_date) } : {}),
      ...(copy.has('purchase_cost') ? { purchase_cost: cost } : {}),
      ...(copy.has('order_number') ? { order_number: source.order_number } : {}),
      ...(copy.has('warranty_end') ? { warranty_end: date(source.warranty_end) } : {}),
      ...(copy.has('notes') ? { notes: source.notes } : {}),
      ...(copy.has('custom_data') ? { custom_data: { ...source.custom_data } } : {}),
    };
  }

  /**
   * Bulk edit / archive / restore: the same operation over up to {@link BULK_MAX} assets, one
   * result per id. Items run in order, each inside a savepoint: a failing item (not found, stale,
   * validation, conflict) is rolled back and reported without touching the others. Every item
   * writes its own audit row and outbox event; one extra audit row (`bulk_operation`) and event
   * describe the whole request.
   */
  async bulk(
    auth: AuthContext,
    operation: 'update' | 'archive' | 'restore',
    ids: string[],
    changes?: BulkUpdateBody['changes'],
  ): Promise<BulkResponse<AssetDto>> {
    const unique = [...new Set(ids)];
    return this.tx(auth, async (trx) => {
      const bulkId = uuidv7();
      const response = await runBulk(
        unique,
        (id) =>
          inSavepoint(trx, async () => {
            const current = await loadAsset(trx, id);
            if (!current) throw problem.notFound('Asset not found.');
            const meta = { bulk_operation_id: bulkId };
            try {
              if (operation === 'update') {
                return (await this.updateInTx(trx, auth, current, changes as AssetUpdate, meta))
                  .asset;
              }
              return (await this.setArchived(trx, auth, current, operation === 'archive', meta))
                .asset;
            } catch (err) {
              if (isUniqueViolation(err))
                throw problem.conflict('The change conflicts with an existing asset.');
              throw err;
            }
          }),
        { max: BULK_MAX, pointer: '/ids' },
      );
      await this.audit.write(trx, {
        action: `asset.bulk_${operation}`,
        entityType: 'bulk_operation',
        entityId: bulkId,
        meta: {
          operation,
          requested: unique.length,
          succeeded: response.summary.succeeded,
          failed: response.summary.failed,
          asset_ids: response.results.filter((r) => !r.error).map((r) => (r.data as AssetDto).id),
          ...(changes ? { changes } : {}),
        },
      });
      await this.outbox.publish(trx, {
        type: 'bulk_operation.completed',
        aggregateType: 'bulk_operation',
        aggregateId: bulkId,
        payload: {
          operation,
          total: unique.length,
          failed: response.summary.failed,
        },
      });
      return response;
    });
  }

  // =========================================================================================
  // Validation helpers

  private tagTaken(tag: string, pointerBase = ''): ApiProblem {
    const err = duplicate('An asset with the tag', `${pointerBase}/asset_tag`, tag);
    return err;
  }

  private async checkModel(
    refs: AssetRefs,
    categoryId: string,
    modelId: string | null | undefined,
    errors: FieldError[],
    pointerBase = '',
  ): Promise<void> {
    if (!modelId) return;
    const model = await refs.model(modelId);
    if (!model || model.archived_at) {
      errors.push(invalidRef(`${pointerBase}/model_id`, 'No such model.'));
    } else if (model.category_id !== categoryId) {
      errors.push({
        pointer: `${pointerBase}/model_id`,
        message: "the model belongs to a different category than the asset's category_id",
        code: 'invalid',
      });
    }
  }

  /** Vendor, parent, location and external id checks shared by create and update. */
  private async checkOthers(
    refs: AssetRefs,
    v: Pick<
      AssetUpdate,
      'vendor_id' | 'parent_asset_id' | 'location_id' | 'external_source' | 'external_id'
    >,
    errors: FieldError[],
    current?: AssetRow,
    pointerBase = '',
  ): Promise<void> {
    const at = (p: string) => `${pointerBase}${p}`;
    if (v.vendor_id) {
      const vendor = await refs.vendor(v.vendor_id);
      if (!vendor || vendor.archived_at)
        errors.push(invalidRef(at('/vendor_id'), 'No such vendor.'));
    }
    if (v.parent_asset_id) {
      if (current && v.parent_asset_id === current.id) {
        errors.push({
          pointer: at('/parent_asset_id'),
          message: 'an asset cannot be its own parent',
          code: 'invalid',
        });
      } else {
        const parent = await refs.asset(v.parent_asset_id);
        if (!parent) errors.push(invalidRef(at('/parent_asset_id'), 'No such asset.'));
        else if (current) {
          // Walk up: the new parent must not be a descendant of this asset.
          let cursor: string | null = parent.parent_asset_id;
          for (let depth = 0; cursor && depth < 50; depth++) {
            if (cursor === current.id) {
              errors.push({
                pointer: at('/parent_asset_id'),
                message: 'would create a cycle',
                code: 'invalid',
              });
              break;
            }
            cursor = (await refs.asset(cursor))?.parent_asset_id ?? null;
          }
        }
      }
    }
    if (v.location_id) {
      const location = await refs.location(v.location_id);
      if (!location || location.archived_at) {
        errors.push(invalidRef(at('/location_id'), 'No such location.'));
      }
    }
    const source = v.external_source !== undefined ? v.external_source : current?.external_source;
    const extId = v.external_id !== undefined ? v.external_id : current?.external_id;
    if ((source === null || source === undefined) !== (extId === null || extId === undefined)) {
      errors.push({
        pointer: at('/external_id'),
        message: 'external_source and external_id are set together',
        code: 'invalid',
      });
    }
  }
}
