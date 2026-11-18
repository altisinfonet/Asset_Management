import { Inject, Injectable } from '@nestjs/common';
import { ApiProblem, type ListSpec, problem } from '../platform/index.js';
import { Prisma, type Tx, TenancyService } from '../tenancy/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import {
  CatalogService,
  type CatalogConfig,
  type CatalogRow,
  type Delegate,
} from './catalog-service.js';
import { validateDefinition } from './custom-fields.js';
import {
  categoryDto,
  customFieldDto,
  manufacturerDto,
  modelDto,
  statusLabelDto,
  vendorDto,
} from './dto.js';
import { duplicate, inUse, invalidRef } from './registry-base.js';
import type {
  CategoryCreate,
  CategoryUpdate,
  CustomFieldCreate,
  CustomFieldUpdate,
  ManufacturerCreate,
  ManufacturerUpdate,
  ModelCreate,
  ModelUpdate,
  StatusLabelCreate,
  StatusLabelUpdate,
  VendorCreate,
  VendorUpdate,
} from './schemas.js';

// -------------------------------------------------------------------------------- shared bits

/** Changes between a row and a patch: omitted fields are untouched, equal values are not changes. */
function changed(
  row: object,
  patch: Record<string, unknown>,
  convert: Record<string, (v: unknown) => unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const current = row as Record<string, unknown>;
  for (const [key, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const value = convert[key] ? convert[key]!(raw) : raw;
    const before = current[key];
    const same =
      value instanceof Date && before instanceof Date
        ? value.getTime() === before.getTime()
        : JSON.stringify(value) === JSON.stringify(before);
    if (!same) out[key] = value;
  }
  return out;
}

/** A nullable JSONB column: Prisma needs DbNull to store SQL NULL (a bare null would be JSON null). */
const dbJson = (v: unknown) =>
  v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
const toDate = (v: unknown): Date | null =>
  v === null ? null : new Date(`${String(v)}T00:00:00Z`);
const contains = (q: unknown) => ({ contains: String(q), mode: 'insensitive' as const });
const immutable = (pointer: string, what: string) =>
  problem.validation([
    { pointer, message: `${what} cannot be changed after creation`, code: 'immutable' },
  ]);

// -------------------------------------------------------------------------------- categories

interface CategoryRow extends CatalogRow {
  name: string;
  kind: string;
  tag_prefix: string | null;
  description: string | null;
}

const nameSpec = (extra: ListSpec['sortable'] = {}): ListSpec => ({
  sortable: { name: { kind: 'string' }, created_at: { kind: 'date' }, ...extra },
  defaultSort: 'name',
});

@Injectable()
export class CategoriesService extends CatalogService<CategoryRow, CategoryCreate, CategoryUpdate> {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  protected readonly cfg: CatalogConfig<CategoryRow, CategoryCreate, CategoryUpdate> = {
    entity: 'category',
    label: 'Category',
    delegate: (trx) => trx.category as unknown as Delegate<CategoryRow>,
    dto: categoryDto,
    listSpec: nameSpec(),
    filter: (q) => ({
      ...(q.q ? { name: contains(q.q) } : {}),
      ...(q.kind ? { kind: q.kind as string } : {}),
    }),
    cursorFilters: (q) => ({ q: q.q, kind: q.kind }),
    prepareCreate: async (_trx, _auth, body) => ({
      name: body.name,
      kind: body.kind ?? 'asset',
      tag_prefix: body.tag_prefix ?? null,
      description: body.description ?? null,
    }),
    prepareUpdate: async (_trx, _auth, row, body) => {
      if (body.kind !== undefined && body.kind !== row.kind) throw immutable('/kind', 'The kind');
      return changed(row, {
        name: body.name,
        tag_prefix: body.tag_prefix,
        description: body.description,
      });
    },
    assertArchivable: async (trx, row) => {
      const [assets, models, customFields] = await Promise.all([
        trx.asset.count({ where: { category_id: row.id } }),
        trx.asset_model.count({ where: { category_id: row.id, archived_at: null } }),
        trx.custom_field_def.count({ where: { category_id: row.id, archived_at: null } }),
      ]);
      if (assets + models + customFields > 0) {
        throw inUse('Category', { assets, models, custom_fields: customFields });
      }
    },
    onUnique: (b) =>
      duplicate('A category named', '/name', String((b as { name?: string }).name ?? '')),
  };
}

// ----------------------------------------------------------------------------- manufacturers

interface ManufacturerRow extends CatalogRow {
  name: string;
  url: string | null;
  support_url: string | null;
  support_email: string | null;
  support_phone: string | null;
  notes: string | null;
}

@Injectable()
export class ManufacturersService extends CatalogService<
  ManufacturerRow,
  ManufacturerCreate,
  ManufacturerUpdate
> {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  protected readonly cfg: CatalogConfig<ManufacturerRow, ManufacturerCreate, ManufacturerUpdate> = {
    entity: 'manufacturer',
    label: 'Manufacturer',
    delegate: (trx) => trx.manufacturer as unknown as Delegate<ManufacturerRow>,
    dto: manufacturerDto,
    listSpec: nameSpec(),
    filter: (q) => (q.q ? { name: contains(q.q) } : {}),
    cursorFilters: (q) => ({ q: q.q }),
    prepareCreate: async (_trx, _auth, b) => ({
      name: b.name,
      url: b.url ?? null,
      support_url: b.support_url ?? null,
      support_email: b.support_email ?? null,
      support_phone: b.support_phone ?? null,
      notes: b.notes ?? null,
    }),
    prepareUpdate: async (_trx, _auth, row, b) => changed(row, { ...b }),
    assertArchivable: async (trx, row) => {
      const models = await trx.asset_model.count({
        where: { manufacturer_id: row.id, archived_at: null },
      });
      if (models > 0) throw inUse('Manufacturer', { models });
    },
    onUnique: (b) =>
      duplicate('A manufacturer named', '/name', String((b as { name?: string }).name ?? '')),
  };
}

// -------------------------------------------------------------------------------------- vendors

interface VendorRow extends CatalogRow {
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  url: string | null;
  address: string | null;
  notes: string | null;
}

@Injectable()
export class VendorsService extends CatalogService<VendorRow, VendorCreate, VendorUpdate> {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  protected readonly cfg: CatalogConfig<VendorRow, VendorCreate, VendorUpdate> = {
    entity: 'vendor',
    label: 'Vendor',
    delegate: (trx) => trx.vendor as unknown as Delegate<VendorRow>,
    dto: vendorDto,
    listSpec: nameSpec(),
    filter: (q) => (q.q ? { name: contains(q.q) } : {}),
    cursorFilters: (q) => ({ q: q.q }),
    prepareCreate: async (_trx, _auth, b) => ({
      name: b.name,
      contact_name: b.contact_name ?? null,
      contact_email: b.contact_email ?? null,
      phone: b.phone ?? null,
      url: b.url ?? null,
      address: b.address ?? null,
      notes: b.notes ?? null,
    }),
    prepareUpdate: async (_trx, _auth, row, b) => changed(row, { ...b }),
    assertArchivable: async (trx, row) => {
      const assets = await trx.asset.count({ where: { vendor_id: row.id } });
      if (assets > 0) throw inUse('Vendor', { assets });
    },
    onUnique: (b) =>
      duplicate('A vendor named', '/name', String((b as { name?: string }).name ?? '')),
  };
}

// --------------------------------------------------------------------------------------- models

interface ModelRow extends CatalogRow {
  category_id: string;
  manufacturer_id: string | null;
  name: string;
  model_number: string | null;
  default_depreciation_months: number | null;
  eol_date: Date | null;
  notes: string | null;
}

@Injectable()
export class ModelsService extends CatalogService<ModelRow, ModelCreate, ModelUpdate> {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  private async checkRefs(
    trx: Tx,
    refs: { category_id?: string; manufacturer_id?: string | null },
  ): Promise<void> {
    const errors = [];
    if (refs.category_id !== undefined) {
      const c = await trx.category.findUnique({ where: { id: refs.category_id } });
      if (!c || c.archived_at) errors.push(invalidRef('/category_id', 'No such category.'));
      else if (c.kind !== 'asset') {
        errors.push({
          pointer: '/category_id',
          message: 'Models belong to asset categories.',
          code: 'invalid',
        });
      }
    }
    if (refs.manufacturer_id) {
      const m = await trx.manufacturer.findUnique({ where: { id: refs.manufacturer_id } });
      if (!m || m.archived_at) errors.push(invalidRef('/manufacturer_id', 'No such manufacturer.'));
    }
    if (errors.length > 0) throw problem.validation(errors);
  }

  protected readonly cfg: CatalogConfig<ModelRow, ModelCreate, ModelUpdate> = {
    entity: 'model',
    label: 'Model',
    delegate: (trx) => trx.asset_model as unknown as Delegate<ModelRow>,
    dto: modelDto,
    listSpec: nameSpec(),
    filter: (q) => ({
      ...(q.q ? { OR: [{ name: contains(q.q) }, { model_number: contains(q.q) }] } : {}),
      ...(q.category_id ? { category_id: q.category_id as string } : {}),
      ...(q.manufacturer_id ? { manufacturer_id: q.manufacturer_id as string } : {}),
    }),
    cursorFilters: (q) => ({ q: q.q, c: q.category_id, m: q.manufacturer_id }),
    prepareCreate: async (trx, _auth, b) => {
      await this.checkRefs(trx, { category_id: b.category_id, manufacturer_id: b.manufacturer_id });
      return {
        category_id: b.category_id,
        manufacturer_id: b.manufacturer_id ?? null,
        name: b.name,
        model_number: b.model_number ?? null,
        default_depreciation_months: b.default_depreciation_months ?? null,
        eol_date: b.eol_date ? toDate(b.eol_date) : null,
        notes: b.notes ?? null,
      };
    },
    prepareUpdate: async (trx, _auth, row, b) => {
      const refs: { category_id?: string; manufacturer_id?: string | null } = {};
      if (b.category_id !== undefined && b.category_id !== row.category_id) {
        refs.category_id = b.category_id;
        const assets = await trx.asset.count({ where: { model_id: row.id } });
        if (assets > 0) {
          throw new ApiProblem({
            code: 'conflict',
            detail: `The category of a model used by ${assets} asset${assets === 1 ? '' : 's'} cannot be changed.`,
            extensions: { usage: { assets } },
          });
        }
      }
      if (b.manufacturer_id !== undefined && b.manufacturer_id !== row.manufacturer_id) {
        refs.manufacturer_id = b.manufacturer_id;
      }
      await this.checkRefs(trx, refs);
      return changed(row, { ...b }, { eol_date: toDate });
    },
    assertArchivable: async (trx, row) => {
      const assets = await trx.asset.count({ where: { model_id: row.id } });
      if (assets > 0) throw inUse('Model', { assets });
    },
    onUnique: (b) => {
      const body = b as { name?: string; model_number?: string | null };
      return duplicate(
        'A model named',
        '/name',
        `${body.name ?? ''}${body.model_number ? ` (${body.model_number})` : ''}`,
      );
    },
  };
}

// ------------------------------------------------------------------------------ status labels

interface StatusLabelRow extends CatalogRow {
  name: string;
  state_type: string;
  color: string | null;
  description: string | null;
  position: number;
  is_default: boolean;
}

@Injectable()
export class StatusLabelsService extends CatalogService<
  StatusLabelRow,
  StatusLabelCreate,
  StatusLabelUpdate
> {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  /** The label given to new assets: it must be usable (not a final state). */
  private assertDefaultable(stateType: string) {
    if (stateType === 'archived' || stateType === 'lost') {
      throw problem.validation([
        {
          pointer: '/is_default',
          message: 'The default status of new assets cannot be an archived or lost state.',
          code: 'invalid',
        },
      ]);
    }
  }

  private async clearDefault(trx: Tx, exceptId?: string): Promise<void> {
    await trx.status_label.updateMany({
      where: {
        is_default: true,
        archived_at: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { is_default: false },
    });
  }

  private async others(trx: Tx, row: StatusLabelRow, stateType: string): Promise<number> {
    return trx.status_label.count({
      where: { state_type: stateType, archived_at: null, id: { not: row.id } },
    });
  }

  protected readonly cfg: CatalogConfig<StatusLabelRow, StatusLabelCreate, StatusLabelUpdate> = {
    entity: 'status_label',
    label: 'Status label',
    delegate: (trx) => trx.status_label as unknown as Delegate<StatusLabelRow>,
    dto: statusLabelDto,
    listSpec: {
      sortable: { position: { kind: 'number' }, name: { kind: 'string' } },
      defaultSort: 'position',
    },
    filter: (q) =>
      q.state_type && (q.state_type as string[]).length > 0
        ? { state_type: { in: q.state_type as string[] } }
        : {},
    cursorFilters: (q) => ({ s: q.state_type }),
    prepareCreate: async (trx, _auth, b) => {
      if (b.is_default) {
        this.assertDefaultable(b.state_type);
        await this.clearDefault(trx);
      }
      let position = b.position;
      if (position === undefined) {
        const last = await trx.status_label.findFirst({
          where: { archived_at: null },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        position = (last?.position ?? 0) + 10;
      }
      return {
        name: b.name,
        state_type: b.state_type,
        color: b.color ?? null,
        description: b.description ?? null,
        position,
        is_default: b.is_default ?? false,
      };
    },
    prepareUpdate: async (trx, _auth, row, b) => {
      const targetType = b.state_type ?? row.state_type;
      if (b.state_type !== undefined && b.state_type !== row.state_type) {
        const [assets, others] = await Promise.all([
          trx.asset.count({ where: { status_id: row.id } }),
          this.others(trx, row, row.state_type),
        ]);
        if (assets > 0) {
          throw problem.conflict(
            `The state type of a label used by ${assets} asset${assets === 1 ? '' : 's'} cannot be changed.`,
          );
        }
        if (others === 0) {
          throw problem.conflict(
            `"${row.name}" is the only ${row.state_type} label: create another one first.`,
          );
        }
      }
      if (b.is_default === true) {
        this.assertDefaultable(targetType);
        await this.clearDefault(trx, row.id);
      }
      if (b.is_default === false && row.is_default) {
        throw problem.conflict(
          'Make another label the default instead: exactly one label is the default for new assets.',
        );
      }
      if (row.is_default && b.state_type) this.assertDefaultable(b.state_type);
      return changed(row, { ...b });
    },
    assertArchivable: async (trx, row) => {
      if (row.is_default) {
        throw problem.conflict(
          `"${row.name}" is the default status of new assets: make another label the default first.`,
        );
      }
      if ((await this.others(trx, row, row.state_type)) === 0) {
        throw problem.conflict(
          `"${row.name}" is the only ${row.state_type} label: every state type keeps at least one label.`,
        );
      }
      const assets = await trx.asset.count({ where: { status_id: row.id } });
      if (assets > 0) throw inUse('Status label', { assets });
    },
    onUnique: (b) =>
      duplicate('A status label named', '/name', String((b as { name?: string }).name ?? '')),
  };
}

// ----------------------------------------------------------------------------- custom fields

interface CustomFieldRow extends CatalogRow {
  category_id: string | null;
  key: string;
  label: string;
  data_type: string;
  required: boolean;
  options: unknown;
  validation: unknown;
  help_text: string | null;
  position: number;
  show_in_list: boolean;
}

@Injectable()
export class CustomFieldsService extends CatalogService<
  CustomFieldRow,
  CustomFieldCreate,
  CustomFieldUpdate
> {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  /** Number of assets that currently hold a value for the definition's key. */
  private async valueCount(trx: Tx, row: CustomFieldRow): Promise<number> {
    const [r] = row.category_id
      ? await trx.$queryRaw<Array<{ n: bigint }>>`
          select count(*) as n from app.asset
           where category_id = ${row.category_id}::uuid and jsonb_exists(custom_data, ${row.key})`
      : await trx.$queryRaw<Array<{ n: bigint }>>`
          select count(*) as n from app.asset where jsonb_exists(custom_data, ${row.key})`;
    return Number(r?.n ?? 0);
  }

  private async checkScope(
    trx: Tx,
    categoryId: string | null | undefined,
    key: string,
    selfId?: string,
  ) {
    if (categoryId) {
      const c = await trx.category.findUnique({ where: { id: categoryId } });
      if (!c || c.archived_at)
        throw problem.validation([invalidRef('/category_id', 'No such category.')]);
      if (c.kind !== 'asset') {
        throw problem.validation([
          {
            pointer: '/category_id',
            message: 'Custom fields apply to asset categories.',
            code: 'invalid',
          },
        ]);
      }
    }
    // A key may not exist twice for the same asset: a global field and a category field would collide.
    const clash = await trx.custom_field_def.findFirst({
      where: {
        key,
        archived_at: null,
        ...(selfId ? { id: { not: selfId } } : {}),
        ...(categoryId ? { OR: [{ category_id: null }, { category_id: categoryId }] } : {}),
      },
    });
    if (clash) {
      throw duplicate('A custom field with the key', '/key', key);
    }
  }

  protected readonly cfg: CatalogConfig<CustomFieldRow, CustomFieldCreate, CustomFieldUpdate> = {
    entity: 'custom_field',
    label: 'Custom field',
    delegate: (trx) => trx.custom_field_def as unknown as Delegate<CustomFieldRow>,
    dto: customFieldDto,
    listSpec: {
      sortable: {
        position: { kind: 'number' },
        key: { kind: 'string' },
        created_at: { kind: 'date' },
      },
      defaultSort: 'position',
    },
    filter: (q) => ({
      AND: [
        q.q ? { OR: [{ key: contains(q.q) }, { label: contains(q.q) }] } : {},
        // A category's fields are its own plus the global ones.
        q.category_id
          ? { OR: [{ category_id: q.category_id as string }, { category_id: null }] }
          : {},
      ],
    }),
    cursorFilters: (q) => ({ q: q.q, c: q.category_id }),
    prepareCreate: async (trx, _auth, b) => {
      const errors = validateDefinition({
        dataType: b.data_type,
        options: b.options ?? null,
        validation: b.validation ?? null,
      });
      if (errors.length > 0) throw problem.validation(errors);
      await this.checkScope(trx, b.category_id, b.key);
      return {
        category_id: b.category_id ?? null,
        key: b.key,
        label: b.label,
        data_type: b.data_type,
        required: b.required ?? false,
        options: dbJson(b.options),
        validation: dbJson(b.validation),
        help_text: b.help_text ?? null,
        position: b.position ?? 0,
        show_in_list: b.show_in_list ?? false,
      };
    },
    prepareUpdate: async (trx, _auth, row, b) => {
      if (b.key !== undefined && b.key !== row.key) throw immutable('/key', 'The key');
      const next = {
        dataType: (b.data_type ?? row.data_type) as CustomFieldCreate['data_type'],
        options: b.options !== undefined ? b.options : (customFieldDto(row).options ?? null),
        validation:
          b.validation !== undefined
            ? b.validation
            : ((row.validation as Record<string, unknown>) ?? null),
      };
      const errors = validateDefinition(next);
      if (errors.length > 0) throw problem.validation(errors);

      const typeChange = b.data_type !== undefined && b.data_type !== row.data_type;
      const scopeChange = b.category_id !== undefined && b.category_id !== row.category_id;
      if (typeChange || scopeChange) {
        const values = await this.valueCount(trx, row);
        if (values > 0) {
          throw new ApiProblem({
            code: 'conflict',
            detail: `The ${typeChange ? 'type' : 'category'} of a custom field cannot be changed while ${values} asset${values === 1 ? ' holds' : 's hold'} a value for it.`,
            extensions: { usage: { assets_with_values: values } },
          });
        }
      }
      if (scopeChange) await this.checkScope(trx, b.category_id, row.key, row.id);
      const out = changed(row, { ...b });
      if ('options' in out) out.options = dbJson(out.options);
      if ('validation' in out) out.validation = dbJson(out.validation);
      return out;
    },
    // Archiving a definition keeps the stored values readable; nothing blocks it.
    assertArchivable: async () => undefined,
    onUnique: (b) =>
      duplicate('A custom field with the key', '/key', String((b as { key?: string }).key ?? '')),
  };
}
