import type { operations } from '@assettracker/api-client';
import { getApi } from '@/lib/api';
import type {
  Asset,
  AssetCreate,
  AssetModel,
  AssetUpdate,
  Category,
  CategoryCreate,
  CategoryUpdate,
  CustomFieldDef,
  CustomFieldDefCreate,
  CustomFieldDefUpdate,
  HistoryEvent,
  Location,
  Manufacturer,
  Page,
  RegistryUser,
  Role,
  SearchResult,
  SessionInfo,
  StatusLabel,
  Vendor,
  Versioned,
} from './types';

/**
 * Registry calls (assets, catalogue, users) over the generated client. Reads of a single resource
 * return the value together with its ETag; writes take that ETag as `If-Match` (a stale one gives
 * `412`). Everything is typed against docs/engineering/openapi.yaml.
 */
const http = () => getApi().http;
const etagFor = (path: string) => getApi().etags.etagFor(path);

type Query<K extends keyof operations> = operations[K]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;

const versioned = <T>(value: T, path: string): Versioned<T> => ({ value, etag: etagFor(path) });

async function freshEtag(etag: string | undefined, load: () => Promise<Versioned<unknown>>) {
  return etag ?? (await load()).etag ?? '';
}

// ---- assets -------------------------------------------------------------------------------------

export type AssetListQuery = Query<'listAssets'>;
export type AssetExpand = NonNullable<Query<'getAsset'>>['expand'];

export const assetsApi = {
  async list(query: AssetListQuery): Promise<Page<Asset>> {
    const { data } = await http().GET('/v1/assets', { params: { query } });
    return data as Page<Asset>;
  },
  async get(id: string, expand?: AssetExpand): Promise<Versioned<Asset>> {
    const { data } = await http().GET('/v1/assets/{id}', {
      params: { path: { id }, query: { expand } },
    });
    return versioned(data as Asset, `/v1/assets/${id}`);
  },
  /** Resolve a scanned QR code or tag to an asset (`GET /v1/scan/resolve`). */
  async resolve(code: string): Promise<Asset> {
    const { data } = await http().GET('/v1/scan/resolve', { params: { query: { code } } });
    return (data as { asset: Asset }).asset;
  },
  async create(body: AssetCreate): Promise<Versioned<Asset>> {
    const { data } = await http().POST('/v1/assets', { body });
    const asset = data as Asset;
    return versioned(asset, `/v1/assets/${asset.id}`);
  },
  async update(id: string, body: AssetUpdate, etag?: string): Promise<Versioned<Asset>> {
    const ifMatch = await freshEtag(etag, () => assetsApi.get(id));
    const { data } = await http().PATCH('/v1/assets/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return versioned(data as Asset, `/v1/assets/${id}`);
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => assetsApi.get(id));
    await http().DELETE('/v1/assets/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
  async restore(id: string, etag?: string): Promise<Versioned<Asset>> {
    const ifMatch = await freshEtag(etag, () => assetsApi.get(id));
    const { data } = await http().POST('/v1/assets/{id}/restore', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
    return versioned(data as Asset, `/v1/assets/${id}`);
  },
  async history(
    id: string,
    query: { cursor?: string; limit?: number },
  ): Promise<Page<HistoryEvent>> {
    const { data } = await http().GET('/v1/assets/{id}/history', {
      params: { path: { id }, query },
    });
    return data as Page<HistoryEvent>;
  },
};

export async function search(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const { data } = await http().GET('/v1/search', {
    params: { query: { q, limit: 5, types: ['asset', 'model', 'category'] } },
    signal,
  });
  return (data as { data: SearchResult[] }).data;
}

// ---- categories ---------------------------------------------------------------------------------

export const categoriesApi = {
  async list(query: Query<'listCategories'> = {}): Promise<Page<Category>> {
    const { data } = await http().GET('/v1/categories', { params: { query } });
    return data as Page<Category>;
  },
  async get(id: string): Promise<Versioned<Category>> {
    const { data } = await http().GET('/v1/categories/{id}', { params: { path: { id } } });
    return versioned(data as Category, `/v1/categories/${id}`);
  },
  async create(body: CategoryCreate): Promise<Category> {
    const { data } = await http().POST('/v1/categories', { body });
    return data as Category;
  },
  async update(id: string, body: CategoryUpdate, etag?: string): Promise<Category> {
    const ifMatch = await freshEtag(etag, () => categoriesApi.get(id));
    const { data } = await http().PATCH('/v1/categories/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as Category;
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => categoriesApi.get(id));
    await http().DELETE('/v1/categories/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

// ---- custom fields -----------------------------------------------------------------------------

export const fieldsApi = {
  async list(query: Query<'listCustomFields'> = {}): Promise<Page<CustomFieldDef>> {
    const { data } = await http().GET('/v1/custom-fields', { params: { query } });
    return data as Page<CustomFieldDef>;
  },
  async get(id: string): Promise<Versioned<CustomFieldDef>> {
    const { data } = await http().GET('/v1/custom-fields/{id}', { params: { path: { id } } });
    return versioned(data as CustomFieldDef, `/v1/custom-fields/${id}`);
  },
  async create(body: CustomFieldDefCreate): Promise<CustomFieldDef> {
    const { data } = await http().POST('/v1/custom-fields', { body });
    return data as CustomFieldDef;
  },
  async update(id: string, body: CustomFieldDefUpdate, etag?: string): Promise<CustomFieldDef> {
    const ifMatch = await freshEtag(etag, () => fieldsApi.get(id));
    const { data } = await http().PATCH('/v1/custom-fields/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as CustomFieldDef;
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => fieldsApi.get(id));
    await http().DELETE('/v1/custom-fields/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

// ---- status labels ------------------------------------------------------------------------------

type StatusBody = {
  name?: string;
  state_type?: StatusLabel['state_type'];
  description?: string | null;
  position?: number;
  is_default?: boolean;
};

export const statusApi = {
  async list(query: Query<'listStatusLabels'> = {}): Promise<Page<StatusLabel>> {
    const { data } = await http().GET('/v1/status-labels', { params: { query } });
    return data as Page<StatusLabel>;
  },
  async get(id: string): Promise<Versioned<StatusLabel>> {
    const { data } = await http().GET('/v1/status-labels/{id}', { params: { path: { id } } });
    return versioned(data as StatusLabel, `/v1/status-labels/${id}`);
  },
  async create(
    body: StatusBody & { name: string; state_type: StatusLabel['state_type'] },
  ): Promise<StatusLabel> {
    const { data } = await http().POST('/v1/status-labels', { body });
    return data as StatusLabel;
  },
  async update(id: string, body: StatusBody, etag?: string): Promise<StatusLabel> {
    const ifMatch = await freshEtag(etag, () => statusApi.get(id));
    const { data } = await http().PATCH('/v1/status-labels/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as StatusLabel;
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => statusApi.get(id));
    await http().DELETE('/v1/status-labels/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

// ---- manufacturers, models, vendors ---------------------------------------------------------------

type ManufacturerBody = Partial<
  Omit<Manufacturer, 'id' | 'created_at' | 'updated_at' | 'archived_at'>
>;
type ModelBody = Partial<Omit<AssetModel, 'id' | 'created_at' | 'updated_at' | 'archived_at'>>;
type VendorBody = Partial<Omit<Vendor, 'id' | 'created_at' | 'updated_at' | 'archived_at'>>;

export const manufacturersApi = {
  async list(query: Query<'listManufacturers'> = {}): Promise<Page<Manufacturer>> {
    const { data } = await http().GET('/v1/manufacturers', { params: { query } });
    return data as Page<Manufacturer>;
  },
  async get(id: string): Promise<Versioned<Manufacturer>> {
    const { data } = await http().GET('/v1/manufacturers/{id}', { params: { path: { id } } });
    return versioned(data as Manufacturer, `/v1/manufacturers/${id}`);
  },
  async create(body: ManufacturerBody & { name: string }): Promise<Manufacturer> {
    const { data } = await http().POST('/v1/manufacturers', { body });
    return data as Manufacturer;
  },
  async update(id: string, body: ManufacturerBody, etag?: string): Promise<Manufacturer> {
    const ifMatch = await freshEtag(etag, () => manufacturersApi.get(id));
    const { data } = await http().PATCH('/v1/manufacturers/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as Manufacturer;
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => manufacturersApi.get(id));
    await http().DELETE('/v1/manufacturers/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

export const modelsApi = {
  async list(query: Query<'listModels'> = {}): Promise<Page<AssetModel>> {
    const { data } = await http().GET('/v1/models', { params: { query } });
    return data as Page<AssetModel>;
  },
  async get(id: string): Promise<Versioned<AssetModel>> {
    const { data } = await http().GET('/v1/models/{id}', { params: { path: { id } } });
    return versioned(data as AssetModel, `/v1/models/${id}`);
  },
  async create(body: ModelBody & { name: string; category_id: string }): Promise<AssetModel> {
    const { data } = await http().POST('/v1/models', { body });
    return data as AssetModel;
  },
  async update(id: string, body: ModelBody, etag?: string): Promise<AssetModel> {
    const ifMatch = await freshEtag(etag, () => modelsApi.get(id));
    const { data } = await http().PATCH('/v1/models/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as AssetModel;
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => modelsApi.get(id));
    await http().DELETE('/v1/models/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

export const vendorsApi = {
  async list(query: Query<'listVendors'> = {}): Promise<Page<Vendor>> {
    const { data } = await http().GET('/v1/vendors', { params: { query } });
    return data as Page<Vendor>;
  },
  async get(id: string): Promise<Versioned<Vendor>> {
    const { data } = await http().GET('/v1/vendors/{id}', { params: { path: { id } } });
    return versioned(data as Vendor, `/v1/vendors/${id}`);
  },
  async create(body: VendorBody & { name: string }): Promise<Vendor> {
    const { data } = await http().POST('/v1/vendors', { body });
    return data as Vendor;
  },
  async update(id: string, body: VendorBody, etag?: string): Promise<Vendor> {
    const ifMatch = await freshEtag(etag, () => vendorsApi.get(id));
    const { data } = await http().PATCH('/v1/vendors/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as Vendor;
  },
  async archive(id: string, etag?: string): Promise<void> {
    const ifMatch = await freshEtag(etag, () => vendorsApi.get(id));
    await http().DELETE('/v1/vendors/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
    });
  },
};

export const locationsApi = {
  async list(query: Query<'listLocations'> = {}): Promise<Page<Location>> {
    const { data } = await http().GET('/v1/locations', { params: { query } });
    return data as Page<Location>;
  },
};

// ---- users, roles, invitations -------------------------------------------------------------------------

export const usersApi = {
  async list(query: Query<'listUsers'> = {}): Promise<Page<RegistryUser>> {
    const { data } = await http().GET('/v1/users', { params: { query } });
    return data as Page<RegistryUser>;
  },
  async get(id: string): Promise<Versioned<RegistryUser>> {
    const { data } = await http().GET('/v1/users/{id}', { params: { path: { id } } });
    return versioned(data as RegistryUser, `/v1/users/${id}`);
  },
  async invite(body: {
    email: string;
    display_name: string;
    role_id: string;
  }): Promise<RegistryUser> {
    const { data } = await http().POST('/v1/users', {
      body: {
        email: body.email,
        display_name: body.display_name,
        role_assignments: [{ role_id: body.role_id, scope_type: 'tenant' }],
        send_invite: true,
      },
    });
    return data as RegistryUser;
  },
  async update(
    id: string,
    body: {
      display_name?: string;
      status?: 'active' | 'disabled';
      role_assignments?: RegistryUser['role_assignments'];
    },
    etag?: string,
  ): Promise<RegistryUser> {
    const ifMatch = await freshEtag(etag, () => usersApi.get(id));
    const { data } = await http().PATCH('/v1/users/{id}', {
      params: { path: { id }, header: { 'If-Match': ifMatch } },
      body,
    });
    return data as RegistryUser;
  },
  async resendInvitation(id: string): Promise<void> {
    await http().POST('/v1/users/{id}/invitation/resend', { params: { path: { id } } });
  },
  async revokeInvitation(id: string): Promise<void> {
    await http().DELETE('/v1/users/{id}/invitation', { params: { path: { id } } });
  },
  async resetMfa(id: string): Promise<void> {
    await http().DELETE('/v1/users/{id}/mfa', { params: { path: { id } } });
  },
  async sessions(id: string): Promise<SessionInfo[]> {
    const { data } = await http().GET('/v1/users/{id}/sessions', { params: { path: { id } } });
    return (data as { data: SessionInfo[] }).data;
  },
  async revokeSession(id: string, sessionId: string): Promise<void> {
    await http().DELETE('/v1/users/{id}/sessions/{session_id}', {
      params: { path: { id, session_id: sessionId } },
    });
  },
};

export const rolesApi = {
  async list(): Promise<Role[]> {
    const { data } = await http().GET('/v1/roles');
    return (data as { data: Role[] }).data;
  },
};

/** Follow `next_cursor` until the list is complete (catalogue lists are small; capped at 20 pages). */
export async function fetchAll<T>(
  load: (cursor: string | undefined) => Promise<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await load(cursor);
    rows.push(...page.data);
    if (!page.page.has_more || !page.page.next_cursor) break;
    cursor = page.page.next_cursor;
  }
  return rows;
}
