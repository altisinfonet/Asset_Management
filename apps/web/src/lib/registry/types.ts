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
export type LocationCreate = S['LocationCreate'];
export type LocationUpdate = S['LocationUpdate'];
export type LocationKind = NonNullable<Location['kind']>;
export type Department = S['Department'];
export type DepartmentCreate = S['DepartmentCreate'];
export type DepartmentUpdate = S['DepartmentUpdate'];
export type Person = S['Person'];
export type PersonCreate = S['PersonCreate'];
export type PersonUpdate = S['PersonUpdate'];
export type PersonKind = NonNullable<Person['kind']>;
export type Assignment = S['Assignment'];
export type AssignmentSummary = S['AssignmentSummary'];
export type CheckoutRequest = S['CheckoutRequest'];
export type CheckinRequest = S['CheckinRequest'];
export type TransferRequest = S['TransferRequest'];
export type CustodyResult = S['CustodyResult'];
export type TransferResult = S['TransferResult'];
export type UndoResult = S['UndoResult'];
export type ScanResolveResult = S['ScanResolveResult'];
export type ScanAction = ScanResolveResult['allowed_actions'][number];
export type Attachment = S['Attachment'];
export type AttachmentCreate = S['AttachmentCreate'];
export type AttachmentUpload = S['AttachmentUpload'];
export type AttachmentKind = Attachment['kind'];
export type AttachmentEntity = Attachment['entity_type'];
export type ScanStatus = Attachment['scan_status'];
export type FilesSettings = S['FilesSettings'];
export type FilesSettingsUpdate = S['FilesSettingsUpdate'];
export type CheckinCondition = NonNullable<CheckinRequest['condition']>;
export type HistoryEvent = S['HistoryEvent'];
export type SearchResult = S['SearchResult'];
export type RegistryUser = S['User'];
export type Role = S['Role'];
export type RoleAssignment = S['RoleAssignment'];
export type SessionInfo = S['SessionInfo'];
export type PageInfo = S['PageInfo'];
export type AssetTagTemplate = S['AssetTagTemplate'];
export type BulkAssetResult = S['BulkAssetResult'];
export type BulkAssetUpdate = S['BulkAssetUpdate'];
/** The changes a bulk edit applies to every selected asset. */
export type BulkChanges = BulkAssetUpdate['changes'];
/** M2-LIFE-05: the bodies of `mark-lost`, `mark-found` and `dispose`, and the bulk move. */
export type MarkLostRequest = S['MarkLostRequest'];
export type MarkFoundRequest = S['MarkFoundRequest'];
export type DisposeRequest = S['DisposeRequest'];
export type DisposalReason = DisposeRequest['reason'];
export type AssetDisposal = S['AssetDisposal'];
export type BulkAssetMove = S['BulkAssetMove'];

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

export const LOCATION_KINDS: readonly LocationKind[] = [
  'site',
  'building',
  'floor',
  'room',
  'storage',
  'vehicle',
  'other',
];

export const PERSON_KINDS: readonly PersonKind[] = [
  'employee',
  'student',
  'contractor',
  'external',
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
