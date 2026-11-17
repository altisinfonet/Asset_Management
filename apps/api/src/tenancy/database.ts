import type { ColumnType, Generated } from 'kysely';

/**
 * Typed view of the M1 schema (apps/api/migrations 0002-0008, source of truth
 * docs/engineering/schema.sql). Table keys are schema-qualified, so queries read
 * `trx.selectFrom('app.asset')`. Ids are UUIDv7 supplied by the application (`uuidv7()`); there
 * are no database-side id defaults (ED-08). M2 tables are added by the M2 migrations.
 *
 * Mapping notes: `bigint` columns come back as strings (node-postgres), `jsonb` objects are
 * serialised by the driver (arrays must be passed through JSON.stringify), `text[]` takes string[].
 */

/** timestamptz with a database default (insert optional). */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** nullable timestamptz without default. */
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type Bigint = ColumnType<string, string | number | bigint, string | number | bigint>;
type NullableBigint = ColumnType<
  string | null,
  string | number | bigint | null | undefined,
  string | number | bigint | null
>;
export type JsonObject = Record<string, unknown>;
type Jsonb = ColumnType<JsonObject, JsonObject | string | undefined, JsonObject | string>;
type NullableJsonb = ColumnType<unknown, unknown, unknown>;

/** Standard columns of a mutable tenant table. */
interface Common {
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string | null;
  updated_by: string | null;
  archived_at: NullableTimestamp;
  version: Generated<number>;
}

export interface TenantTable {
  id: string;
  name: string;
  plan: Generated<'free' | 'starter' | 'pro' | 'enterprise' | 'self_hosted'>;
  status: Generated<'active' | 'suspended' | 'pending_deletion'>;
  cell: Generated<string>;
  base_currency: Generated<string>;
  settings: Jsonb;
  created_at: Timestamp;
  updated_at: Timestamp;
  version: Generated<number>;
}

export interface CompanyTable extends Common {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  is_default: Generated<boolean>;
}

export interface RoleTable {
  id: string;
  tenant_id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: Generated<string[]>;
  is_builtin: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
  version: Generated<number>;
}

export interface UserAccountTable extends Common {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  status: Generated<'invited' | 'active' | 'disabled'>;
  locale: string | null;
  timezone: string | null;
  mfa_enabled: Generated<boolean>;
  last_login_at: NullableTimestamp;
}

export interface InvitationTable {
  id: string;
  tenant_id: string;
  user_id: string | null;
  email: string;
  role_id: string;
  status: Generated<'pending' | 'accepted' | 'revoked' | 'expired'>;
  expires_at: Date | string;
  accepted_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string | null;
  version: Generated<number>;
}

export interface RoleAssignmentTable {
  id: string;
  tenant_id: string;
  user_id: string;
  role_id: string;
  scope_type: Generated<'tenant' | 'company' | 'location'>;
  scope_company_id: string | null;
  scope_location_id: string | null;
  created_at: Timestamp;
  created_by: string | null;
}

export interface ApiKeyTable {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  scopes: Generated<string[]>;
  expires_at: NullableTimestamp;
  last_used_at: NullableTimestamp;
  last_used_ip: string | null;
  revoked_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string | null;
  version: Generated<number>;
}

export interface CategoryTable extends Common {
  id: string;
  tenant_id: string;
  name: string;
  kind: Generated<'asset' | 'accessory' | 'consumable' | 'component' | 'license'>;
  tag_prefix: string | null;
  description: string | null;
}

export interface ManufacturerTable extends Common {
  id: string;
  tenant_id: string;
  name: string;
  url: string | null;
  support_url: string | null;
  support_email: string | null;
  support_phone: string | null;
  notes: string | null;
}

export interface VendorTable extends Common {
  id: string;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  url: string | null;
  address: string | null;
  notes: string | null;
}

export interface AssetModelTable extends Common {
  id: string;
  tenant_id: string;
  category_id: string;
  category_kind: Generated<'asset'>;
  manufacturer_id: string | null;
  name: string;
  model_number: string | null;
  default_depreciation_months: number | null;
  eol_date: ColumnType<
    Date | string | null,
    Date | string | null | undefined,
    Date | string | null
  >;
  notes: string | null;
}

export interface StatusLabelTable extends Common {
  id: string;
  tenant_id: string;
  name: string;
  state_type: 'deployable' | 'deployed' | 'pending' | 'undeployable' | 'archived' | 'lost';
  color: string | null;
  description: string | null;
  position: Generated<number>;
  is_default: Generated<boolean>;
}

export interface CustomFieldDefTable extends Common {
  id: string;
  tenant_id: string;
  category_id: string | null;
  key: string;
  label: string;
  data_type:
    | 'text'
    | 'long_text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'select'
    | 'multiselect'
    | 'url'
    | 'email';
  required: Generated<boolean>;
  options: NullableJsonb;
  validation: NullableJsonb;
  help_text: string | null;
  position: Generated<number>;
  show_in_list: Generated<boolean>;
}

export interface AssetTagCounterTable {
  tenant_id: string;
  prefix: string;
  last_value: Generated<string>;
}

type DateOnly = ColumnType<
  Date | string | null,
  Date | string | null | undefined,
  Date | string | null
>;

export interface AssetTable extends Common {
  id: string;
  tenant_id: string;
  company_id: ColumnType<string, string | undefined, string>; // filled by trigger with the default company
  asset_tag: string;
  label_code: Generated<string>;
  name: string | null;
  serial: string | null;
  category_id: string;
  category_kind: Generated<'asset'>;
  model_id: string | null;
  status_id: string;
  location_id: string | null;
  vendor_id: string | null;
  parent_asset_id: string | null;
  purchase_date: DateOnly;
  purchase_cost_minor: NullableBigint;
  currency: string | null;
  order_number: string | null;
  warranty_end: DateOnly;
  notes: string | null;
  custom_data: Jsonb;
  external_source: string | null;
  external_id: string | null;
}

export interface AttachmentTable {
  id: string;
  tenant_id: string;
  entity_type:
    | 'asset'
    | 'accessory'
    | 'consumable'
    | 'location'
    | 'person'
    | 'maintenance_record'
    | 'assignment'
    | 'import_job';
  entity_id: string;
  kind: Generated<'photo' | 'document' | 'signature' | 'import_file' | 'other'>;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: Bigint;
  sha256: string | null;
  scan_status: Generated<'pending' | 'clean' | 'infected' | 'error'>;
  uploaded_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string | null;
  archived_at: NullableTimestamp;
  version: Generated<number>;
}

export interface IdempotencyKeyTable {
  tenant_id: string;
  principal_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  state: Generated<'in_flight' | 'completed'>;
  response_status: number | null;
  response_headers: NullableJsonb;
  response_body: NullableJsonb;
  created_at: Timestamp;
  expires_at: Timestamp;
}

export interface OutboxEventTable {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Jsonb;
  created_at: Timestamp;
  published_at: NullableTimestamp;
  attempts: Generated<number>;
}

export interface AuditLogTable {
  id: string;
  tenant_id: string;
  at: Timestamp;
  actor_type: 'user' | 'api_key' | 'integration' | 'system';
  actor_user_id: string | null;
  actor_ref: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  diff: NullableJsonb;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
}

// ----------------------------------------------------------------------------- identity (no RLS)

export interface TenantDirectoryTable {
  tenant_id: string;
  slug: string;
  status: Generated<'active' | 'suspended' | 'pending_deletion'>;
  cell: Generated<string>;
  created_at: Timestamp;
}

export interface LoginIdentityTable {
  tenant_id: string;
  user_id: string;
  email_lower: string;
  status: Generated<'active' | 'disabled'>;
}

export interface CredentialTable {
  tenant_id: string;
  user_id: string;
  password_hash: string;
  must_change: Generated<boolean>;
  failed_attempts: Generated<number>;
  locked_until: NullableTimestamp;
  password_changed_at: Timestamp;
}

export interface MfaFactorTable {
  id: string;
  tenant_id: string;
  user_id: string;
  type: 'totp' | 'webauthn';
  label: string | null;
  secret_encrypted: Buffer | null;
  credential_id: Buffer | null;
  public_key: Buffer | null;
  sign_count: Generated<string>;
  confirmed_at: NullableTimestamp;
  last_used_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface MfaRecoveryCodeTable {
  id: string;
  tenant_id: string;
  user_id: string;
  code_hash: Buffer;
  used_at: NullableTimestamp;
  created_at: Timestamp;
}

export interface SessionTable {
  id: string;
  token_hash: Buffer;
  tenant_id: string;
  user_id: string;
  auth_method: 'password' | 'oidc' | 'saml';
  mfa_verified_at: NullableTimestamp;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  idle_expires_at: Date | string;
  expires_at: Date | string;
  revoked_at: NullableTimestamp;
  ip: string | null;
  user_agent: string | null;
}

export interface ApiKeyLookupTable {
  key_prefix: string;
  key_hash: Buffer;
  tenant_id: string;
  api_key_id: string;
}

export interface InvitationTokenTable {
  token_hash: Buffer;
  tenant_id: string;
  invitation_id: string;
  expires_at: Date | string;
}

export interface ExternalIdentityTable {
  provider: 'google' | 'microsoft' | 'oidc';
  subject: string;
  tenant_id: string;
  user_id: string;
  created_at: Timestamp;
}

export interface SecurityEventTable {
  id: string;
  at: Timestamp;
  event_type: 'login_failed' | 'api_key_invalid' | 'session_invalid' | 'tenant_inactive' | 'other';
  tenant_id: string | null;
  subject: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  detail: Jsonb;
}

export interface Database {
  'app.tenant': TenantTable;
  'app.company': CompanyTable;
  'app.role': RoleTable;
  'app.user_account': UserAccountTable;
  'app.invitation': InvitationTable;
  'app.role_assignment': RoleAssignmentTable;
  'app.api_key': ApiKeyTable;
  'app.category': CategoryTable;
  'app.manufacturer': ManufacturerTable;
  'app.vendor': VendorTable;
  'app.asset_model': AssetModelTable;
  'app.status_label': StatusLabelTable;
  'app.custom_field_def': CustomFieldDefTable;
  'app.asset_tag_counter': AssetTagCounterTable;
  'app.asset': AssetTable;
  'app.attachment': AttachmentTable;
  'app.idempotency_key': IdempotencyKeyTable;
  'app.outbox_event': OutboxEventTable;
  'app.audit_log': AuditLogTable;
  'identity.tenant_directory': TenantDirectoryTable;
  'identity.login_identity': LoginIdentityTable;
  'identity.credential': CredentialTable;
  'identity.mfa_factor': MfaFactorTable;
  'identity.mfa_recovery_code': MfaRecoveryCodeTable;
  'identity.session': SessionTable;
  'identity.api_key_lookup': ApiKeyLookupTable;
  'identity.invitation_token': InvitationTokenTable;
  'identity.external_identity': ExternalIdentityTable;
  'identity.security_event': SecurityEventTable;
}
