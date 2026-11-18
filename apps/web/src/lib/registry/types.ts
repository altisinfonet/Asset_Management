import type { components } from '@assettracker/api-client';

/** Registry resource types, taken from the generated contract. */
type S = components['schemas'];

export type Asset = S['Asset'];
export type AssetCreate = S['AssetCreate'];
export type AssetUpdate = S['AssetUpdate'];
export type Category = S['Category'];
export type CategoryCreate = S['CategoryCreate'];
export type CategoryUpdate = S['CategoryUpdate'];
export type CustomFieldDef = S['CustomFieldDef'];
export type CustomFieldDefCreate = S['CustomFieldDefCreate'];
export type CustomFieldDefUpdate = S['CustomFieldDefUpdate'];
export type CustomFieldType = CustomFieldDef['data_type'];
export type StatusLabel = S['StatusLabel'];
export type StateType = StatusLabel['state_type'];
export type Manufacturer = S['Manufacturer'];
export type AssetModel = S['AssetModel'];
export type Vendor = S['Vendor'];
export type Location = S['Location'];
export type HistoryEvent = S['HistoryEvent'];
export type SearchResult = S['SearchResult'];
export type RegistryUser = S['User'];
export type Role = S['Role'];
export type RoleAssignment = S['RoleAssignment'];
export type SessionInfo = S['SessionInfo'];
export type PageInfo = S['PageInfo'];

export const CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  'text',
  'long_text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
  'url',
  'email',
];

export const STATE_TYPES: readonly StateType[] = [
  'deployable',
  'deployed',
  'pending',
  'undeployable',
  'archived',
  'lost',
];

/** A single resource together with the ETag that came with it (`If-Match` for the next write). */
export interface Versioned<T> {
  value: T;
  etag: string | undefined;
}

/** One page of a cursor-paginated list. */
export interface Page<T> {
  data: T[];
  page: PageInfo;
}
