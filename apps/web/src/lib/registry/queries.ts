'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth/auth-context';
import {
  categoriesApi,
  fetchAll,
  fieldsApi,
  locationsApi,
  manufacturersApi,
  modelsApi,
  rolesApi,
  statusApi,
  vendorsApi,
} from './api';
import type {
  AssetModel,
  Category,
  CustomFieldDef,
  Location,
  Manufacturer,
  Role,
  StatusLabel,
  Vendor,
} from './types';

/**
 * Catalogue lookups (categories, fields, models, statuses, vendors, locations ...). They are small
 * and needed by almost every registry screen, so each list is fetched once (all pages), cached for
 * a minute and shared. Writes call `invalidateLookups` so every screen sees the change.
 */
export const LOOKUP_KEYS = {
  categories: ['lookup', 'categories'],
  fields: ['lookup', 'fields'],
  statuses: ['lookup', 'statuses'],
  manufacturers: ['lookup', 'manufacturers'],
  models: ['lookup', 'models'],
  vendors: ['lookup', 'vendors'],
  locations: ['lookup', 'locations'],
  roles: ['lookup', 'roles'],
} as const;

const STALE = 60_000;

/** Permission gate for a lookup: a role without it would only collect 403s. */
function useCan(permission: string): boolean {
  return useAuth().can(permission);
}

export function useCategories(options: { includeArchived?: boolean } = {}) {
  const enabled = useCan('catalog:read');
  const archived = options.includeArchived ? 'include' : 'exclude';
  return useQuery({
    queryKey: [...LOOKUP_KEYS.categories, archived],
    queryFn: () =>
      fetchAll<Category>((cursor) =>
        categoriesApi.list({ limit: 200, cursor, kind: 'asset', archived, sort: ['name'] }),
      ),
    enabled,
    staleTime: STALE,
  });
}

export function useCustomFields(options: { includeArchived?: boolean } = {}) {
  const enabled = useCan('catalog:read');
  const archived = options.includeArchived ? 'include' : 'exclude';
  return useQuery({
    queryKey: [...LOOKUP_KEYS.fields, archived],
    queryFn: () =>
      fetchAll<CustomFieldDef>((cursor) =>
        fieldsApi.list({ limit: 200, cursor, archived, sort: ['position'] }),
      ),
    enabled,
    staleTime: STALE,
  });
}

export function useStatusLabels(options: { includeArchived?: boolean } = {}) {
  const enabled = useCan('catalog:read');
  const archived = options.includeArchived ? 'include' : 'exclude';
  return useQuery({
    queryKey: [...LOOKUP_KEYS.statuses, archived],
    queryFn: () =>
      fetchAll<StatusLabel>((cursor) =>
        statusApi.list({ limit: 200, cursor, archived, sort: ['position'] }),
      ),
    enabled,
    staleTime: STALE,
  });
}

export function useManufacturers() {
  const enabled = useCan('catalog:read');
  return useQuery({
    queryKey: LOOKUP_KEYS.manufacturers,
    queryFn: () =>
      fetchAll<Manufacturer>((cursor) =>
        manufacturersApi.list({ limit: 200, cursor, sort: ['name'] }),
      ),
    enabled,
    staleTime: STALE,
  });
}

export function useModels() {
  const enabled = useCan('catalog:read');
  return useQuery({
    queryKey: LOOKUP_KEYS.models,
    queryFn: () =>
      fetchAll<AssetModel>((cursor) => modelsApi.list({ limit: 200, cursor, sort: ['name'] })),
    enabled,
    staleTime: STALE,
  });
}

export function useVendors() {
  const enabled = useCan('catalog:read');
  return useQuery({
    queryKey: LOOKUP_KEYS.vendors,
    queryFn: () =>
      fetchAll<Vendor>((cursor) => vendorsApi.list({ limit: 200, cursor, sort: ['name'] })),
    enabled,
    staleTime: STALE,
  });
}

export function useLocations() {
  const enabled = useCan('location:read');
  return useQuery({
    queryKey: LOOKUP_KEYS.locations,
    queryFn: () =>
      fetchAll<Location>((cursor) =>
        locationsApi.list({ limit: 200, cursor, sort: ['depth', 'name'] }),
      ),
    enabled,
    staleTime: STALE,
  });
}

export function useRoles() {
  const enabled = useCan('role:read');
  return useQuery({
    queryKey: LOOKUP_KEYS.roles,
    queryFn: () => rolesApi.list(),
    enabled,
    staleTime: STALE,
  });
}

/** Refresh every cached catalogue list after a write. */
export function useInvalidateLookups() {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: ['lookup'] }), [client]);
}

/** "Riverside > Main building > Room 101" for a location id. */
export function locationPath(
  locations: readonly Location[] | undefined,
  id: string | null | undefined,
): string {
  if (!id || !locations) return '';
  const byId = new Map(locations.map((l) => [l.id, l]));
  const target = byId.get(id);
  if (!target) return '';
  const ids = target.ancestor_ids?.length ? target.ancestor_ids : [target.id];
  return ids
    .map((x) => byId.get(x)?.name ?? '')
    .filter(Boolean)
    .join(' > ');
}

export interface Lookups {
  categories: Category[];
  fields: CustomFieldDef[];
  statuses: StatusLabel[];
  models: AssetModel[];
  vendors: Vendor[];
  locations: Location[];
  manufacturers: Manufacturer[];
  categoryById: Map<string, Category>;
  statusById: Map<string, StatusLabel>;
  modelById: Map<string, AssetModel>;
  vendorById: Map<string, Vendor>;
  locationById: Map<string, Location>;
  manufacturerById: Map<string, Manufacturer>;
  /** Fields that apply to a category (its own plus those for all categories), in display order. */
  fieldsFor: (categoryId: string | undefined | null) => CustomFieldDef[];
  /** Path text of a location id. */
  locationLabel: (id: string | null | undefined) => string;
  loading: boolean;
  error: unknown;
}

const EMPTY: never[] = [];

/** Everything the asset screens need to turn ids into names and to render custom fields. */
export function useLookups(): Lookups {
  const categories = useCategories();
  const fields = useCustomFields();
  const statuses = useStatusLabels({ includeArchived: true });
  const models = useModels();
  const vendors = useVendors();
  const locations = useLocations();
  const manufacturers = useManufacturers();

  const categoryList = categories.data ?? EMPTY;
  const fieldList = fields.data ?? EMPTY;
  const statusList = statuses.data ?? EMPTY;
  const modelList = models.data ?? EMPTY;
  const vendorList = vendors.data ?? EMPTY;
  const locationList = locations.data ?? EMPTY;
  const manufacturerList = manufacturers.data ?? EMPTY;

  return useMemo(() => {
    const byId = <T extends { id: string }>(list: readonly T[]) =>
      new Map(list.map((item) => [item.id, item]));
    return {
      categories: categoryList,
      fields: fieldList,
      statuses: statusList,
      models: modelList,
      vendors: vendorList,
      locations: locationList,
      manufacturers: manufacturerList,
      categoryById: byId(categoryList),
      statusById: byId(statusList),
      modelById: byId(modelList),
      vendorById: byId(vendorList),
      locationById: byId(locationList),
      manufacturerById: byId(manufacturerList),
      fieldsFor: (categoryId) =>
        fieldList
          .filter((f) => !f.archived_at && (f.category_id == null || f.category_id === categoryId))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      locationLabel: (id) => locationPath(locationList, id),
      loading: categories.isLoading || fields.isLoading || statuses.isLoading || models.isLoading,
      error:
        categories.error ??
        fields.error ??
        statuses.error ??
        models.error ??
        locations.error ??
        null,
    };
  }, [
    categoryList,
    fieldList,
    statusList,
    modelList,
    vendorList,
    locationList,
    manufacturerList,
    categories.isLoading,
    fields.isLoading,
    statuses.isLoading,
    models.isLoading,
    categories.error,
    fields.error,
    statuses.error,
    models.error,
    locations.error,
  ]);
}

export type { Role };
