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
  parseSort,
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
import {
  ASSET_COLUMNS,
  ASSET_FIELDS,
  ASSET_FROM,
  type AssetDto,
  type AssetRow,
  assetConditions,
  assetDto,
  keysetSql,
  loadAsset,
  loadAssetRows,
  orderBySql,
  pickFields,
  sortKeySelect,
  splitCustomFieldParams,
} from './asset-queries.js';
import { AssetTagService, tagExists } from './asset-tags.js';
import { mergeCustomData, missingRequired, validateProvided } from './custom-fields.js';
import { categoryDto, modelDto, vendorDto } from './dto.js';
import { RegistryBase, duplicate, invalidRef, stalePrecondition } from './registry-base.js';
import { inSavepoint } from './savepoint.js';
import {
  type AssetCreate,
  type AssetListQuery,
  type AssetUpdate,
  type BulkUpdateBody,
  CLONE_FIELDS,
  type CloneBody,
  M2_ONLY_ASSET_FILTERS,
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
    auth: AuthContext,
    rawQuery: Record<string, unknown>,
  ): Promise<Page<Record<string, unknown>>> {
    const { rest, cf } = splitCustomFieldParams(rawQuery);
    for (const name of M2_ONLY_ASSET_FILTERS) {
      if (rest[name] !== undefined) {
        throw problem.badRequest(
          `Query parameter "${name}" needs M2 (custody) and is not available yet.`,
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
    return this.listParsed(auth, parsed.data, cf);
  }

  async listParsed(
    auth: AuthContext,
    q: AssetListQuery,
    cfRaw: Array<{ key: string; raw: string }>,
  ): Promise<Page<Record<string, unknown>>> {
    const fields = parseFields(q.fields, ASSET_FIELDS);
    const terms = parseSort(q.sort, {
      sortable: {
        created_at: { kind: 'string' },
        updated_at: { kind: 'string' },
        asset_tag: { kind: 'string' },
        name: { kind: 'string' },
        purchase_date: { kind: 'string' },
        warranty_end: { kind: 'string' },
      },
      defaultSort: '-created_at',
    });
    // The unique tiebreaker follows the direction of the first sort key (newest first stays newest
    // first on ties, matching the asset_created_idx index order).
    const idTerm = terms.at(-1);
    if (idTerm && idTerm.key === 'id' && !/(^|,)[-+]?id(,|$)/.test(q.sort ?? '')) {
      idTerm.direction = terms[0]!.direction;
    }
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

    return this.tx(auth, async (trx) => {
      const cf = await this.customFieldFilters(trx, cfRaw);
      const conditions = assetConditions(q, cf);
      const where = conditions.length > 0 ? Prisma.join(conditions, ' and ') : Prisma.sql`true`;
      const after = values ? keysetSql(terms, values) : Prisma.sql`true`;
      const take = q.limit + 1;

      const rows = await trx.$queryRaw<AssetRow[]>`
        select ${ASSET_COLUMNS} ${sortKeySelect(terms)} ${ASSET_FROM}
         where ${where} and ${after}
         order by ${orderBySql(terms)}
         limit ${take}`;

      const hasMore = rows.length > q.limit;
      const data = hasMore ? rows.slice(0, q.limit) : rows;
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
        const [c] = await trx.$queryRaw<Array<{ n: bigint }>>`
          select count(*) as n ${ASSET_FROM} where ${where}`;
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
    // `location` has no table before M2: nothing to embed.
    return rows.map((r) => ({
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
    const code = rawCode.includes('/')
      ? (rawCode.split('?')[0]!.split('/').filter(Boolean).pop() ?? rawCode)
      : rawCode.trim();
    return this.tx(auth, async (trx) => {
      let matchType: 'label_code' | 'asset_tag' = 'label_code';
      let [row] = await loadAssetRows(trx, Prisma.sql`a.label_code = ${code}`, 1);
      if (!row) {
        matchType = 'asset_tag';
        [row] = await loadAssetRows(trx, Prisma.sql`lower(a.asset_tag) = lower(${code})`, 1);
      }
      if (!row) throw problem.notFound('No asset matches this code.');
      const allowed: string[] = [];
      if (!row.archived_at && permits(auth.permissions, 'asset:update')) allowed.push('update');
      return {
        data: { match_type: matchType, asset: assetDto(row), allowed_actions: allowed },
        version: row.version,
      };
    });
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
          location_id: null,
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
    await this.checkOthers(
      refs,
      {
        vendor_id: body.vendor_id !== current.vendor_id ? body.vendor_id : undefined,
        parent_asset_id:
          body.parent_asset_id !== current.parent_asset_id ? body.parent_asset_id : undefined,
        location_id: body.location_id,
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
    return { asset: assetDto(row), version: row.version };
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
    const result = await trx.asset.updateMany({
      where: { id: current.id, version: current.version },
      data: { archived_at: archive ? new Date() : null, updated_by: auth.userId },
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
    return { asset: assetDto(row), version: row.version };
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
      errors.push({
        pointer: at('/location_id'),
        message: 'Locations become available with M2; location_id must be null for now.',
        code: 'not-supported',
      });
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
