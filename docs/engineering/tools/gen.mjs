// Generates docs/engineering/openapi.yaml (OpenAPI 3.1) from a compact definition.
import YAML from 'yaml';
import fs from 'fs';

const OUT = process.argv[2];

// ---------------------------------------------------------------- small helpers
const S = (n) => ({ $ref: `#/components/schemas/${n}` });
const P = (n) => ({ $ref: `#/components/parameters/${n}` });
const R = (n) => ({ $ref: `#/components/responses/${n}` });
const H = (n) => ({ $ref: `#/components/headers/${n}` });
const uuid = (description) => ({ type: 'string', format: 'uuid', ...(description ? { description } : {}) });
const nuuid = (description) => ({ type: ['string', 'null'], format: 'uuid', ...(description ? { description } : {}) });
const str = (o = {}) => ({ type: 'string', ...o });
const nstr = (o = {}) => ({ type: ['string', 'null'], ...o });
const int = (o = {}) => ({ type: 'integer', ...o });
const bool = (o = {}) => ({ type: 'boolean', ...o });
const date = (o = {}) => ({ type: 'string', format: 'date', ...o });
const ndate = (o = {}) => ({ type: ['string', 'null'], format: 'date', ...o });
const dt = (o = {}) => ({ type: 'string', format: 'date-time', ...o });
const ndt = (o = {}) => ({ type: ['string', 'null'], format: 'date-time', ...o });
const ro = (schema) => ({ ...schema, readOnly: true });
const arr = (items, o = {}) => ({ type: 'array', items, ...o });
const en = (values, o = {}) => ({ type: 'string', enum: values, ...o });
const obj = (properties, required = [], o = {}) => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...o });
const nref = (name) => ({ oneOf: [S(name), { type: 'null' }] });

const jsonBody = (schema, required = true, example) => ({
  required,
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
});

// ---------------------------------------------------------------- document skeleton
const doc = {
  openapi: '3.1.0',
  info: {
    title: 'Asset Tracker API',
    version: '1.0.0-m2',
    summary: 'REST API for the Asset Tracker (milestones M1 and M2).',
    description: [
      'Asset Tracker REST API, milestones **M1** (tenancy, users, auth, asset registry, audit log, attachments) and **M2** (locations, people, check-out/in, transfers, accessories, consumables, loaner pools, repairs, labels, imports).',
      '',
      '## Authentication',
      '- **Browser / web app:** server-side session in the `__Host-at_session` cookie (HttpOnly, Secure, SameSite=Lax). Mutating requests made with the cookie must send the `X-CSRF-Token` header (value returned by login and `GET /v1/auth/me`).',
      '- **Integrations / scripts / mobile:** `Authorization: Bearer <api key>`. Keys are scoped (`resource:action`), can expire and are stored hashed. A key can never exceed the permissions of the role that created it.',
      '- The tenant is derived **only** from the credential, never from a header or body field. A resource id that belongs to another tenant returns `404`, exactly like a missing id.',
      '- **Session lifetime:** every cookie session has an idle timeout and an absolute timeout (`GET /v1/auth/me` returns `session.idle_expires_at` and `session.absolute_expires_at`). A request on an expired or revoked session returns `401` with code `session-expired`.',
      '- **Unauthenticated endpoints** (login, MFA verify, password forgot/reset, password policy, invitation lookup/accept) take no cookie and no CSRF header, and are throttled per IP and per account (`429`, `Retry-After`). Invitation accept and password reset tokens are single-use and stored hashed.',
      '',
      '## Account security',
      '- **Password policy:** minimum 12 and maximum 128 characters, no composition rules, Unicode NFKC-normalised, and a breached-password check (bundled offline list always on; an optional online k-anonymity provider can be enabled). A rejected password returns `422` with an `errors[]` entry at pointer `/password` (code `too-short`, `too-long` or `breached`). Clients read the live limits from `GET /v1/auth/password-policy` instead of hardcoding them (schema `PasswordPolicy`).',
      '- **MFA enrolment enforcement:** when the tenant requires MFA for the user\'s role and the user has not enrolled, the session is *limited*: `GET /v1/auth/me` returns `mfa_enrolment_required: true` and every other endpoint except `/v1/auth/logout` and `/v1/auth/mfa/enrol*` answers `403` with code `mfa-enrolment-required`. Completing `POST /v1/auth/mfa/enrol/confirm` lifts the limit.',
      '- **Re-authentication:** regenerating recovery codes and disabling MFA need the current password or a current TOTP code in the body (`ReauthRequest`); a wrong value returns `403` `reauth-failed` (never `401`, which clients treat as "session gone").',
      '- **Self-service endpoints** (`/v1/auth/sessions`, `/v1/auth/mfa/*`) need a browser session, not an API key, and no permission beyond being signed in (marked `x-self-service: true`).',
      '',
      '## Permissions',
      'Each operation lists the permission it needs in `x-permission` (`resource:action`). Built-in roles: `tenant_admin` (`*`), `asset_manager`, `technician`, `auditor`, `viewer`. Role assignments can be scoped to the tenant, a company or a location subtree; reads and writes outside the scope behave as `404`.',
      '',
      '## Idempotency',
      'Every mutating request (POST, PATCH, DELETE) accepts an `Idempotency-Key` header (8-255 chars, client-generated, unique per principal). It is **required** on check-out, check-in, transfer, loaner check-out, stock movements and import commit. A retry with the same key and the same body replays the stored response and sets `Idempotent-Replayed: true`; the same key with a different body returns `422` (`idempotency-key-reuse`); a retry while the first request is still running returns `409` (`idempotency-key-in-flight`). Keys expire after 24 hours.',
      '',
      '## Optimistic concurrency',
      'Single-resource GET and every create/update response carry an `ETag` (`W/"<version>"`). `PATCH` and `DELETE` require `If-Match` (`428` if missing, `412` if stale). Check-out, check-in and transfer accept `If-Match` on the asset but also serialise server-side, so a lost race returns `409`. Their responses return the **updated asset** (body and `ETag`) together with the assignment (and the transfer record), so a client can chain the next call without a re-fetch.',
      '',
      '## Pagination, sorting, filtering',
      'List endpoints use **cursor pagination**: `limit` (1-200, default 50) and an opaque `cursor`; the response carries `page.next_cursor` and `page.has_more`. `page.total` is only returned with `include_total=true` (it costs a count). Cursors are bound to the `sort` and filters that produced them. `sort` is a comma-separated list, `-` prefix for descending. Filters are plain query parameters; array filters are comma-separated; custom fields filter with `cf[<key>]=<value>`.',
      '',
      '## Errors',
      'Errors are RFC 9457 `application/problem+json` with a stable machine `code`, the `request_id` (also in the `X-Request-Id` header) and, for validation failures, an `errors[]` array of JSON-pointer + message. The catalogue of codes is the `x-problem-codes` extension at the root of this document (code, HTTP status, meaning) and the `ProblemCode` schema; every error response lists the codes it can carry in its own `x-problem-codes` array. The set grows over time: clients must branch on `code` for the ones they know and fall back to the HTTP status for the rest.',
      '',
      '## Rate limits',
      'Per tenant by plan tier. Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; `429` adds `Retry-After`.',
      '',
      '## Money and dates',
      'Money is `{ amount_minor, currency }` (integer minor units, ISO 4217). Timestamps are RFC 3339 UTC; dates are `YYYY-MM-DD`.',
    ].join('\n'),
    license: { name: 'Proprietary', identifier: 'LicenseRef-Proprietary' },
    contact: { name: 'Asset Tracker engineering' },
  },
  servers: [
    { url: 'https://{host}', description: 'Cloud edition or a self-hosted install', variables: { host: { default: 'api.assettracker.test', description: 'API host. Paths already include the /v1 prefix.' } } },
  ],
  security: [{ sessionCookie: [] }, { bearerApiKey: [] }],
  tags: [],
  paths: {},
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Host-at_session', description: 'Browser session cookie issued by `POST /v1/auth/login`. Mutations also need the `X-CSRF-Token` header.' },
      bearerApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'at_<prefix>.<secret>', description: 'Scoped API key (also used by the mobile app after login). Send as `Authorization: Bearer <key>`.' },
    },
    parameters: {}, headers: {}, responses: {}, schemas: {},
  },
};
const C = doc.components;

const tagDefs = {
  Auth: 'Login, MFA enrolment and verification, password reset, invitation acceptance, browser sessions, password policy and the current principal.',
  System: 'Liveness/health and build version; no credential needed.',
  Search: 'Global search across registry entities, filtered by the caller\'s permissions.',
  Access: 'Users, roles, companies and API keys.',
  Assets: 'The asset registry: CRUD, search, scan resolution and history.',
  Custody: 'Check-out, check-in and transfer of assets.',
  Categories: 'Asset, accessory and consumable categories.',
  Manufacturers: 'Manufacturer catalogue.',
  Models: 'Asset models (make/model templates).',
  'Custom fields': 'Custom field definitions; values live in `asset.custom_data`.',
  'Status labels': 'Configurable status labels mapped to fixed state types.',
  Vendors: 'Suppliers and repair vendors.',
  Locations: 'Hierarchical locations.',
  People: 'Assignable people (employees, students, contractors), with or without a login.',
  Departments: 'Managed departments (ED-17): the list people and assets are assigned to, instead of free text.',
  Accessories: 'Quantity-tracked items that are checked out and returned.',
  Consumables: 'Quantity-tracked items that are used up, with a stock ledger.',
  Loaners: 'Loaner pools: spare devices with quick check-out, due dates and overdue tracking.',
  Repairs: 'Repair and maintenance log.',
  Labels: 'Fixed label templates and PDF label sheets.',
  Imports: 'CSV/XLSX imports (assets, people, locations, departments; Google Admin ChromeOS preset) with a mandatory dry run.',
  Attachments: 'File metadata and presigned upload/download.',
  Audit: 'Append-only audit log.',
};
doc.tags = Object.entries(tagDefs).map(([name, description]) => ({ name, description }));

// ---------------------------------------------------------------- shared components
C.headers = {
  ETag: { description: 'Weak entity tag of the resource version, `W/"<version>"`. Send it back in `If-Match`.', schema: str({ examples: ['W/"7"'] }) },
  Location: { description: 'URL of the created or queued resource.', schema: str({ format: 'uri-reference' }) },
  RequestId: { description: 'Server-generated request id; quote it in support requests.', schema: str() },
  RateLimitLimit: { description: 'Requests allowed in the current window.', schema: int() },
  RateLimitRemaining: { description: 'Requests left in the current window.', schema: int() },
  RateLimitReset: { description: 'Seconds until the window resets.', schema: int() },
  RetryAfter: { description: 'Seconds to wait before retrying.', schema: int() },
  IdempotentReplayed: { description: '`true` when the response is a replay of an earlier request with the same Idempotency-Key.', schema: bool() },
  SetCookie: { description: 'Session cookie `__Host-at_session`.', schema: str() },
};

C.parameters = {
  Id: { name: 'id', in: 'path', required: true, description: 'Resource id (UUIDv7).', schema: uuid() },
  AssetIdPath: { name: 'asset_id', in: 'path', required: true, description: 'Asset id.', schema: uuid() },
  Cursor: { name: 'cursor', in: 'query', description: 'Opaque cursor from `page.next_cursor` of the previous page.', schema: str({ maxLength: 1024 }) },
  Limit: { name: 'limit', in: 'query', description: 'Page size.', schema: int({ minimum: 1, maximum: 200, default: 50 }) },
  IncludeTotal: { name: 'include_total', in: 'query', description: 'Also return `page.total` (an extra count query; avoid on large lists).', schema: bool({ default: false }) },
  Archived: { name: 'archived', in: 'query', description: 'Archived (soft-deleted) records: `exclude` (default), `include` or `only`.', schema: en(['exclude', 'include', 'only'], { default: 'exclude' }) },
  Q: { name: 'q', in: 'query', description: 'Free-text search (trigram / prefix match).', schema: str({ minLength: 1, maxLength: 200 }) },
  IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: false, description: 'Client-generated key making the request safely retryable (8-255 chars). Optional here; recommended for mobile and scripts.', schema: str({ minLength: 8, maxLength: 255 }) },
  IdempotencyKeyRequired: { name: 'Idempotency-Key', in: 'header', required: true, description: 'Client-generated key (8-255 chars) so the operation can be retried without being applied twice. Required.', schema: str({ minLength: 8, maxLength: 255 }) },
  IfMatch: { name: 'If-Match', in: 'header', required: true, description: 'ETag of the version being modified. `428` if absent, `412` if stale.', schema: str({ examples: ['W/"7"'] }) },
  IfMatchOptional: { name: 'If-Match', in: 'header', required: false, description: 'ETag of the asset the client acted on; if it changed, the request fails with `412` and the client should refresh.', schema: str({ examples: ['W/"7"'] }) },
  CsrfToken: { name: 'X-CSRF-Token', in: 'header', required: false, description: 'Required for mutating requests authenticated with the session cookie; ignored for API keys.', schema: str() },
};

// Catalogue of problem `code` values: code -> [HTTP statuses, meaning]. Published as the root `x-problem-codes`
// extension and as the `ProblemCode` schema; each response lists the subset it can carry in its own `x-problem-codes`.
const PROBLEM_CODES = {
  'bad-request': [[400], 'Malformed request: bad JSON, bad query parameter.'],
  'invalid-cursor': [[400], 'The cursor is not valid for this list: it is garbled, or it was issued for a different sort or filter. Start again without a cursor.'],
  'idempotency-key-required': [[400], 'The operation needs an Idempotency-Key header and none was sent.'],
  'idempotency-key-invalid': [[400], 'The Idempotency-Key header is not 8-255 visible ASCII characters.'],
  unauthorized: [[401], 'No credential, or the credential is not valid (generic).'],
  'invalid-credentials': [[401], 'Wrong email or password. Never reveals which one, or whether the account exists.'],
  'mfa-invalid-code': [[401, 422], 'The TOTP or recovery code is wrong, already used, or outside its window. 401 on the login challenge, 422 when confirming an enrolment.'],
  'mfa-challenge-expired': [[401], 'The MFA challenge from login is expired or already consumed; sign in again.'],
  'session-expired': [[401], 'The session hit its idle or absolute timeout, or was revoked; sign in again.'],
  forbidden: [[403], 'Authenticated, but the principal lacks the required permission (or the request needs a browser session).'],
  'csrf-invalid': [[403], 'A cookie-authenticated mutation is missing a valid X-CSRF-Token.'],
  'mfa-enrolment-required': [[403], 'The tenant requires MFA and the user has not enrolled; only enrolment endpoints and logout work until then.'],
  'mfa-required-by-policy': [[403], 'The action (disabling MFA) is not allowed because tenant policy enforces MFA for this user.'],
  'reauth-failed': [[403], 'The password or TOTP code sent to re-authenticate a sensitive action is wrong.'],
  'not-found': [[404], 'The resource does not exist, belongs to another tenant, or is outside the caller\'s scope.'],
  'token-invalid': [[404], 'The password-reset token is unknown or already used. Also: a local-storage file link (`/v1/files/{token}`) that is malformed, forged or of the wrong kind.'],
  'invitation-not-found': [[404], 'The invitation token is unknown, already accepted or revoked.'],
  'method-not-allowed': [[405], 'The path exists but not for this HTTP method.'],
  conflict: [[409], 'State conflict: uniqueness violation, or the resource is in the wrong state for this action.'],
  'idempotency-key-in-flight': [[409], 'A request with the same Idempotency-Key is still running.'],
  'cannot-revoke-current': [[409], 'The current session cannot be revoked here; use sign out.'],
  'mfa-already-enrolled': [[409], 'The user already has an active TOTP factor; disable it first.'],
  'asset-already-checked-out': [[409], 'The asset is already checked out.'],
  'asset-not-checked-out': [[409], 'The asset has no open check-out to return.'],
  // [M2-USR-03, ED-22] link a person and a login account
  'person-already-linked': [[409], 'The person is already linked to a login account (the same or another one). Unlink it first.'],
  'login-already-linked': [[409], 'The login account is already linked to a person that somebody chose (not the placeholder the system made for it). Unlink that person first.'],
  'login-person-in-use': [[409], 'The login account\'s own person record still holds assets, so it cannot be replaced by the person being linked: check them in or transfer them first (`usage.open_assignments`).'],
  // [M2-UX-02, ED-23] undo of a custody action
  'undo-expired': [[409], 'More than five minutes have passed since the custody action, so it can no longer be undone.'],
  'undo-asset-changed': [[409], 'The asset changed after the action (another custody action, an edit, a move...), so it can no longer be undone.'],
  'undo-not-possible': [[409], 'The action cannot be undone: it was already undone, the previous holder or status is no longer available, or it is loaner custody.'],
  // [M2-W1 locations, people, custody]
  'asset-not-deployable': [[409], 'The asset\'s status does not allow this custody action: check-out (and a transfer out of stock) need a `deployable` state, so lost, archived, in-repair and pending assets cannot be checked out.'],
  'insufficient-stock': [[409], 'Not enough quantity on hand.'],
  'no-loaner-available': [[409], 'The loaner pool has no available member.'],
  'import-stale-dry-run': [[409], 'The dry run being committed is not the one reviewed: the file, mapping, options or value mapping changed after it, or a newer dry run exists.'],
  'import-wrong-state': [[409], 'The import is not in a state that allows this action (for example a commit before a dry run, or editing a running import). `state` and `allowed` say which.'],
  'import-quota-exceeded': [[429], 'The organisation already runs the maximum number of imports at once; retry after the time in `Retry-After`.'],
  // [LOAN] ED-20 loaner pools
  'loan-limit-reached': [[409], 'The borrower already holds the most open loans the pool allows (`max_loans_per_person`).'],
  'loaner-pool-inactive': [[409], 'The loaner pool is switched off (`is_active = false`): it lends nothing until it is switched on again.'],
  // M2 wave 1b (files): BEGIN
  'upload-missing': [[409], 'The upload was not found in object storage: PUT the bytes to the presigned URL before calling complete.'],
  // M2 wave 1b (files): END
  'token-expired': [[410], 'The password-reset token has expired; request a new one. Also: a local-storage file link (`/v1/files/{token}`) whose lifetime ended.'],
  'invitation-expired': [[410], 'The invitation has expired; ask an administrator to resend it.'],
  'precondition-failed': [[412], '`If-Match` does not match the current version.'],
  'payload-too-large': [[413], 'The request body exceeds the size limit. For attachments: the file is larger than the organisation\'s upload cap (see `GET /v1/settings/files`) or than the size declared when the upload was started.'],
  'unsupported-media-type': [[415], 'The Content-Type is not supported. For attachments: the file type is not on the allow-list (images, PDF, Office documents, CSV; never SVG or HTML), or its content does not match the declared type or extension.'],
  validation: [[422], 'Validation failed; see errors[] (JSON pointer + message + field code).'],
  'idempotency-key-reuse': [[422], 'The Idempotency-Key was already used with a different request body.'],
  'precondition-required': [[428], '`If-Match` is required for this operation.'],
  'account-locked': [[429], 'Too many failed sign-in or re-authentication attempts; locked until Retry-After elapses.'],
  'too-many-requests': [[429], 'Rate limit exceeded; wait for Retry-After.'],
  internal: [[500], 'Unexpected server error; quote request_id.'],
  unavailable: [[503], 'A dependency is down or the service is starting.'],
};
doc['x-problem-codes'] = Object.fromEntries(Object.entries(PROBLEM_CODES).map(([code, [status, description]]) => [code, { status, description }]));
const codeList = (codes) => codes.map((c) => `\`${c}\``).join(', ');

const problemResponse = (description, example, codes = []) => ({
  description: codes.length ? `${description} Codes: ${codeList(codes)}.` : description,
  headers: { 'X-Request-Id': H('RequestId') },
  content: { 'application/problem+json': { schema: S('Problem'), ...(example ? { example } : {}) } },
  ...(codes.length ? { 'x-problem-codes': codes } : {}),
});
C.responses = {
  BadRequest: problemResponse('Malformed request (bad JSON, bad query parameter, invalid cursor).', { type: 'https://api.assettracker.test/problems/bad-request', title: 'Bad request', status: 400, code: 'bad-request', detail: 'Query parameter "limit" must be between 1 and 200.', request_id: '01JABCDEF0123456789' }, ['bad-request', 'idempotency-key-required', 'idempotency-key-invalid']),
  Unauthorized: { ...problemResponse('Missing, invalid or expired credentials.', undefined, ['unauthorized', 'session-expired']), headers: { 'X-Request-Id': H('RequestId'), 'WWW-Authenticate': { description: 'Authentication scheme.', schema: str() } } },
  Forbidden: problemResponse('Authenticated, but the principal lacks the required permission (or MFA enrolment is required).', undefined, ['forbidden', 'csrf-invalid', 'mfa-enrolment-required']),
  NotFound: problemResponse('The resource does not exist **or belongs to another tenant or is outside the caller\'s scope**.', undefined, ['not-found']),
  Conflict: problemResponse('State conflict: uniqueness violation, asset already checked out, insufficient stock, or an Idempotency-Key request still in flight.', undefined, ['conflict', 'idempotency-key-in-flight']),
  PreconditionFailed: problemResponse('`If-Match` does not match the current version; re-read and retry.', undefined, ['precondition-failed']),
  PreconditionRequired: problemResponse('`If-Match` header is required for this operation.', undefined, ['precondition-required']),
  Unprocessable: problemResponse('Validation failed (see `errors[]`), or an Idempotency-Key was reused with a different body.', { type: 'https://api.assettracker.test/problems/validation', title: 'Validation failed', status: 422, code: 'validation', errors: [{ pointer: '/asset_tag', message: 'must not contain whitespace', code: 'pattern' }], request_id: '01JABCDEF0123456789' }, ['validation', 'idempotency-key-reuse']),
  TooManyRequests: { ...problemResponse('Rate limit exceeded.', undefined, ['too-many-requests']), headers: { 'X-Request-Id': H('RequestId'), 'Retry-After': H('RetryAfter'), 'RateLimit-Limit': H('RateLimitLimit'), 'RateLimit-Remaining': H('RateLimitRemaining'), 'RateLimit-Reset': H('RateLimitReset') } },
};

// Specific problem responses for one operation: `problems: { 401: ['invalid-credentials'], ... }` in addOp. The description
// and `x-problem-codes` list exactly the codes that status can carry there.
const STATUS_TEXT = { 400: 'Malformed request.', 401: 'Not authenticated.', 403: 'Forbidden.', 404: 'Not found.', 409: 'Conflict.', 410: 'Gone.', 422: 'Validation failed.', 429: 'Throttled; see Retry-After.' };
function specificProblem(status, codes, text) {
  const first = codes[0];
  const base = status === '429' ? C.responses.TooManyRequests : status === '401' ? C.responses.Unauthorized : { headers: { 'X-Request-Id': H('RequestId') } };
  return {
    description: `${text ?? STATUS_TEXT[status]} Codes: ${codeList(codes)}.`,
    headers: base.headers,
    content: { 'application/problem+json': { schema: S('Problem'), example: { type: `https://api.assettracker.test/problems/${first}`, title: first.replace(/-/g, ' '), status: Number(status), code: first, request_id: '01JABCDEF0123456789' } } },
    'x-problem-codes': codes,
  };
}

// ---------------------------------------------------------------- common schemas
const S_ = C.schemas;
// Registry additions (M1-REG-06 / M1-REG-09); listed first to keep the published schema order stable.
const BULK_MAX = 100;
const bulkIds = () => arr({ type: 'string', format: 'uuid' }, { minItems: 1, maxItems: BULK_MAX });
S_.AssetCloneRequest = obj({
  count: int({ minimum: 1, maximum: 100, default: 1 }),
  copy_fields: arr(en(['name', 'model_id', 'status_id', 'vendor_id', 'location_id', 'department_id', 'parent_asset_id', 'purchase_date', 'purchase_cost', 'order_number', 'warranty_end', 'notes', 'custom_data']), { description: 'Fields to copy from the source. Default - all of them.' }),
  asset_tags: arr(str({ minLength: 1, maxLength: 64, pattern: '^\\S+$' }), { description: 'One explicit tag per copy; omit to generate them from the numbering template.' }),
}, [], { additionalProperties: false });
S_.AssetCloneResult = obj({ data: arr(S('Asset')) }, ['data']);
S_.BulkAssetIds = obj({ ids: bulkIds() }, ['ids'], { additionalProperties: false });
S_.BulkAssetUpdate = obj({
  ids: bulkIds(),
  changes: obj({
    status_id: uuid(),
    category_id: uuid(),
    model_id: nuuid(),
    vendor_id: nuuid(),
    department_id: nuuid('[ED-17] Department for every listed asset; `null` clears it.'),
    custom_data: S('CustomData'),
  }, [], { description: 'At least one of these. `custom_data` merges per key (`null` removes a key).', additionalProperties: false }),
}, ['ids', 'changes'], { additionalProperties: false });
S_.BulkAssetResult = obj({
  results: arr(obj({
    index: int(),
    status: int({ description: 'HTTP status the single-asset operation would have returned.' }),
    data: S('Asset'),
    error: S('Problem'),
  }, ['index', 'status'])),
  summary: obj({ total: int(), succeeded: int(), failed: int() }, ['total', 'succeeded', 'failed']),
}, ['results', 'summary']);
S_.AssetTagTemplate = obj({
  prefix: str({ pattern: '^[A-Z0-9-]{0,12}$', default: '' }),
  width: int({ minimum: 1, maximum: 12, default: 5, description: 'Zero-padded width of the counter.' }),
  use_category_prefix: bool({ default: true }),
  example: str({ readOnly: true, description: 'A sample tag produced by the template (counter 42).' }),
}, [], { additionalProperties: false });
S_.HealthResponse = obj({
  status: en(['ok', 'degraded']),
  checks: obj({
    db: obj({
      status: en(['ok', 'error']),
      latencyMs: { type: 'number', minimum: 0, description: 'Round trip of the database probe (only when `ok`).' },
      error: str({ description: 'Why the probe failed (only when `error`).' }),
    }, ['status']),
  }, ['db']),
  uptimeSeconds: { type: 'number', minimum: 0 },
}, ['status', 'checks', 'uptimeSeconds'], { description: 'Health of the API process and its database. `200` when `ok`, `503` (same shape) when `degraded`.' });
S_.VersionResponse = obj({
  name: str({ description: 'Package name of the API build.' }),
  version: str({ description: 'Semantic version of the build.' }),
  commit: str({ description: 'Git commit the image was built from (`dev` for local runs).' }),
  role: str({ description: 'Process role: `api`, `worker`, `scheduler` or `migrate`.' }),
}, ['name', 'version', 'commit', 'role']);
S_.Problem = obj({
  type: str({ format: 'uri-reference', description: 'Problem type URI.' }),
  title: str(),
  status: int({ minimum: 400, maximum: 599 }),
  detail: str(),
  instance: str({ format: 'uri-reference' }),
  code: S('ProblemCode'),
  request_id: str(),
  errors: arr(S('FieldError')),
  usage: { type: 'object', description: 'Extension member of a `409` that refuses to delete or change something still in use: what references it (for example `{"assets": 12, "models": 3}`).', additionalProperties: int() },
}, ['type', 'title', 'status'], { description: 'RFC 9457 problem details.' });
S_.ProblemCode = str({
  description: 'Stable machine-readable problem code. The set is open (new codes may appear): branch on codes you know and fall back to the HTTP status. The full catalogue (code, HTTP status, meaning) is the root `x-problem-codes` extension of this document; each error response lists its own subset in `x-problem-codes`.',
  examples: ['validation', 'invalid-credentials', 'mfa-enrolment-required', 'asset-already-checked-out'],
  'x-known-values': Object.keys(PROBLEM_CODES),
});
S_.FieldError = obj({
  pointer: str({ description: 'JSON pointer into the request body, or `query:<name>`.' }),
  message: str(),
  code: str({ description: 'Per-field code, e.g. `pattern`, `required`; for passwords `too-short`, `too-long`, `breached`.' }),
}, ['pointer', 'message']);
S_.PageInfo = obj({
  next_cursor: nstr({ description: 'Pass as `cursor` to get the next page; null on the last page.' }),
  has_more: bool(),
  total: { type: ['integer', 'null'], description: 'Only with `include_total=true`.' },
}, ['next_cursor', 'has_more']);
S_.Money = obj({ amount_minor: int({ format: 'int64', minimum: 0, description: 'Integer minor units (cents).' }), currency: str({ pattern: '^[A-Z]{3}$', description: 'ISO 4217.' }) }, ['amount_minor', 'currency']);
S_.CustomData = { type: 'object', additionalProperties: true, description: 'Custom field values keyed by `custom_field_def.key`; validated against the definitions.' };
S_.Address = obj({ line1: nstr(), line2: nstr(), city: nstr(), region: nstr(), postal_code: nstr(), country: nstr({ description: 'ISO 3166-1 alpha-2: exactly two letters, stored upper-case (`no` is saved as `NO`); anything else is a 422 on `/address/country`.', pattern: '^[A-Za-z]{2}$' }) });
S_.AssignmentTarget = {
  type: 'object',
  description: 'Exactly one target: a person, a location, or another asset.',
  properties: { person_id: uuid(), location_id: uuid(), target_asset_id: uuid() },
  oneOf: [{ required: ['person_id'] }, { required: ['location_id'] }, { required: ['target_asset_id'] }],
};

const baseRead = (archivable = true) => ({
  id: ro(uuid()),
  created_at: ro(dt()),
  updated_at: ro(dt()),
  ...(archivable ? { archived_at: ro(ndt()) } : {}),
});

// ---------------------------------------------------------------- resource schema generator
// props: writable properties. readOnly: extra read-only props. required: required on create.
function defineResource(name, { props, required = [], readOnly = {}, createOnly = {}, archivable = true, description }) {
  S_[name] = obj({ ...baseRead(archivable), ...props, ...readOnly }, ['id', ...required.filter((r) => !(r in createOnly))], description ? { description } : {});
  S_[`${name}Create`] = obj({ ...props, ...createOnly }, required, { additionalProperties: false });
  S_[`${name}Update`] = obj({ ...props }, [], { additionalProperties: false, description: 'Partial update (RFC 7396 merge semantics): omitted fields are unchanged, `null` clears a nullable field.' });
  S_[`${name}List`] = obj({ data: arr(S(name)), page: S('PageInfo') }, ['data', 'page']);
}

// ---------------------------------------------------------------- catalogue resources
defineResource('Category', {
  props: {
    name: str({ minLength: 1, maxLength: 100 }),
    kind: en(['asset', 'accessory', 'consumable', 'component', 'license'], { default: 'asset', description: 'Fixed at creation; assets, models, accessories and consumables only accept categories of their own kind.' }),
    tag_prefix: nstr({ pattern: '^[A-Z0-9-]{1,12}$', description: 'Prefix for generated asset tags, e.g. `LAP-`.' }),
    description: nstr(),
  },
  required: ['name'],
});
defineResource('Manufacturer', {
  props: { name: str({ minLength: 1, maxLength: 200 }), url: nstr({ format: 'uri' }), support_url: nstr({ format: 'uri' }), support_email: nstr({ format: 'email' }), support_phone: nstr(), notes: nstr() },
  required: ['name'],
});
defineResource('Vendor', {
  props: { name: str({ minLength: 1, maxLength: 200 }), contact_name: nstr(), contact_email: nstr({ format: 'email' }), phone: nstr(), url: nstr({ format: 'uri' }), address: nstr(), notes: nstr() },
  required: ['name'],
});
defineResource('AssetModel', {
  props: {
    category_id: uuid('An asset-kind category.'),
    manufacturer_id: nuuid(),
    name: str({ minLength: 1, maxLength: 200 }),
    model_number: nstr(),
    default_depreciation_months: { type: ['integer', 'null'], minimum: 0 },
    eol_date: ndate(),
    notes: nstr(),
  },
  required: ['category_id', 'name'],
});
// M2 wave 1b (files): BEGIN - the picture of a model (M2-FILE-03). An image attachment whose owner is the model.
{
  const modelImage = nuuid('Primary picture: an image attachment (`entity_type=asset_model`) of this model. Upload it with `POST /v1/attachments`, then set its id here; `null` clears it.');
  S_.AssetModel.properties.image_attachment_id = modelImage;
  S_.AssetModelUpdate.properties.image_attachment_id = modelImage;
}
// M2 wave 1b (files): END
defineResource('StatusLabel', {
  props: {
    name: str({ minLength: 1, maxLength: 100 }),
    state_type: en(['deployable', 'deployed', 'pending', 'undeployable', 'archived', 'lost'], { description: 'Fixed state types; labels are configurable.' }),
    color: nstr({ pattern: '^#[0-9a-fA-F]{6}$' }),
    description: nstr(),
    position: int({ default: 0 }),
    is_default: bool({ default: false, description: 'Status given to newly created assets; exactly one non-archived label is the default.' }),
  },
  required: ['name', 'state_type'],
});
defineResource('CustomFieldDef', {
  props: {
    category_id: nuuid('Null = applies to every asset category.'),
    key: str({ pattern: '^[a-z][a-z0-9_]{0,62}$', description: 'Key inside `custom_data`; immutable after creation.' }),
    label: str({ minLength: 1, maxLength: 100 }),
    data_type: en(['text', 'long_text', 'number', 'boolean', 'date', 'select', 'multiselect', 'url', 'email']),
    required: bool({ default: false }),
    options: { type: ['array', 'null'], items: obj({ value: str(), label: str() }, ['value']), description: 'Required for select / multiselect.' },
    validation: { type: ['object', 'null'], additionalProperties: true, description: 'e.g. `{"min":0,"max":100}` or `{"pattern":"^[A-Z]{2}-\\\\d+$"}`.' },
    help_text: nstr(),
    position: int({ default: 0 }),
    show_in_list: bool({ default: false }),
  },
  required: ['key', 'label', 'data_type'],
});

// ---------------------------------------------------------------- M2 base resources
defineResource('Location', {
  props: {
    parent_id: nuuid('Parent location; null = root. Moving a location re-parents its subtree.'),
    company_id: uuid('Defaults to the tenant default company.'),
    name: str({ minLength: 1, maxLength: 200 }),
    kind: en(['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'], { default: 'other' }),
    code: nstr(),
    address: { oneOf: [S('Address'), { type: 'null' }] },
    latitude: { type: ['number', 'null'], minimum: -90, maximum: 90 },
    longitude: { type: ['number', 'null'], minimum: -180, maximum: 180 },
    notes: nstr(),
  },
  required: ['name'],
  readOnly: {
    depth: ro(int({ description: 'Distance from the root (a root has depth 0). The hierarchy is limited to depth 9, i.e. ten levels.' })),
    ancestor_ids: ro(arr(uuid(), { description: 'Root..self.' })),
    // [M2-W1] counts, computed per request
    asset_count: ro(int({ minimum: 0, description: 'Live (not archived) assets located here **or in any descendant** location.' })),
    direct_asset_count: ro(int({ minimum: 0, description: 'Live assets located exactly here.' })),
    child_count: ro(int({ minimum: 0, description: 'Live direct child locations.' })),
  },
});
defineResource('Person', {
  props: {
    kind: en(['employee', 'student', 'contractor', 'external'], { default: 'employee' }),
    display_name: str({ minLength: 1, maxLength: 200 }),
    first_name: nstr(),
    last_name: nstr(),
    email: nstr({ format: 'email' }),
    phone: nstr(),
    employee_ref: nstr({ description: 'Unique per tenant when set (employee / student number).' }),
    department_id: nuuid('[ED-17] A managed department (`POST /v1/departments`); `null` = none. Replaces the free-text department.'),
    job_title: nstr(),
    location_id: nuuid('Primary or home location.'),
    company_id: uuid(),
    status: en(['active', 'inactive'], { default: 'active' }),
    notes: nstr(),
  },
  required: ['display_name'],
  readOnly: {
    user_id: ro(nuuid('Linked login account, if this person can sign in.')),
    department: ro(nstr({ description: '[ED-17] The NAME of the linked department (read-only; write `department_id`). Kept so readers of the old free-text field keep working.' })),
    // [M2-W1] computed per request
    assets_held: ro(int({ minimum: 0, description: 'Number of assets currently checked out to this person.' })),
    // [ED-33] the login's own automatic record (v0.2.8)
    is_login_placeholder: ro(bool({ description: "[ED-33] True for the login account's own automatic person record: the one the system made when the login was created (ED-15) or after an unlink, never chosen by anybody (`user_id` set, no `created_by` and no `updated_by`: a person that was linked to the login, or edited, is not). Such a record cannot be unlinked (409); link the login to a real person instead (`POST /v1/people/{id}/link-user`)." })),
  },
});
// [M2-W1] Deactivating a person who still holds assets is refused (409 with `usage.open_assignments`) unless
// the update says `force: true` together with a `reason` (recorded in the audit trail). Not stored on the person.
S_.PersonUpdate.properties.force = bool({ default: false, description: 'With `status: "inactive"`: deactivate even though the person still holds assets. Needs `reason`. Not stored on the person.' });
S_.PersonUpdate.properties.reason = str({ minLength: 1, maxLength: 500, description: 'Why a forced deactivation is justified (audit trail). Ignored without `force`.' });
// [DEPT] BEGIN - managed departments (ED-17; founder request 2026-11-24)
defineResource('Department', {
  description: 'A managed department: chosen from a list instead of typed, so the same department is never spelled three ways. People and assets reference it by id.',
  props: {
    name: str({ minLength: 1, maxLength: 200, description: 'Unique among the live departments of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`).' }),
    code: nstr({ maxLength: 50, description: 'Short code or cost-centre number; unique among live departments when set (409, pointer `/code`). An empty string means none.' }),
    description: nstr({ maxLength: 2000 }),
    manager_person_id: nuuid('The head of the department: a live person (422 on `/manager_person_id` otherwise).'),
  },
  required: ['name'],
  readOnly: {
    manager_name: ro(nstr({ description: 'Display name of the manager.' })),
    person_count: ro(int({ minimum: 0, description: 'Live (not archived) people in this department. Present on the department endpoints only.' })),
    asset_count: ro(int({ minimum: 0, description: 'Live (not archived) assets owned by this department. Present on the department endpoints only.' })),
  },
});
// [DEPT] END
defineResource('Accessory', {
  props: {
    category_id: uuid('An accessory-kind category.'),
    name: str({ minLength: 1, maxLength: 200 }),
    manufacturer_id: nuuid(),
    vendor_id: nuuid(),
    location_id: nuuid(),
    company_id: uuid(),
    model_number: nstr(),
    qty_total: int({ minimum: 0 }),
    min_qty: int({ minimum: 0, default: 0, description: 'Low-stock alert threshold on available quantity.' }),
    purchase_date: ndate(),
    purchase_cost: { oneOf: [S('Money'), { type: 'null' }], description: 'Per-unit or total cost; unit semantics are tenant convention.' },
    notes: nstr(),
  },
  required: ['category_id', 'name', 'qty_total'],
  // [M2-W2 ACC] units out and available are computed per request from the open assignments (never stored)
  readOnly: {
    qty_checked_out: ro(int({ minimum: 0, description: 'Units still out: the sum of `quantity - quantity_returned` over the open assignments.' })),
    qty_available: ro(int({ description: '`qty_total - qty_checked_out`: what can be checked out right now.' })),
    low_stock: ro(bool({ description: 'True while `min_qty > 0` and `qty_available <= min_qty`.' })),
    label_code: ro(str({ description: 'Opaque QR payload of the label: `GET /v1/scan/resolve?code=` answers it with `entity_type: accessory`.' })),
  },
});
// [M2-W2 ACC] the computed members are always present in a response
S_.Accessory.required.push('qty_checked_out', 'qty_available', 'low_stock', 'label_code');
defineResource('Consumable', {
  props: {
    category_id: uuid('A consumable-kind category.'),
    name: str({ minLength: 1, maxLength: 200 }),
    manufacturer_id: nuuid(),
    vendor_id: nuuid(),
    location_id: nuuid(),
    company_id: uuid(),
    model_number: nstr(),
    unit: str({ default: 'each' }),
    min_qty: int({ minimum: 0, default: 0, description: 'Low-stock alert threshold.' }),
    unit_cost: { oneOf: [S('Money'), { type: 'null' }] },
    notes: nstr(),
  },
  required: ['category_id', 'name'],
  createOnly: { initial_qty: int({ minimum: 0, default: 0, description: 'Creates an initial `receive` stock movement.' }) },
  // [M2-W2 ACC] `qty_on_hand` is the balance of the ledger: only stock movements change it
  readOnly: {
    qty_on_hand: ro(int({ minimum: 0, description: 'Changed only through stock movements; always the sum of the ledger.' })),
    low_stock: ro(bool({ description: 'True while `min_qty > 0` and `qty_on_hand <= min_qty`.' })),
    label_code: ro(str({ description: 'Opaque QR payload of the label: `GET /v1/scan/resolve?code=` answers it with `entity_type: consumable`.' })),
  },
});
S_.Consumable.required.push('qty_on_hand', 'low_stock', 'label_code');
defineResource('LoanerPool', {
  description: 'A loaner pool (ED-20): a named set of spare devices (a Chromebook cart, a laptop trolley) with loan rules. An asset belongs to at most one pool.',
  props: {
    name: str({ minLength: 1, maxLength: 200, description: 'Unique among the live pools of the tenant, ignoring case and surrounding spaces (409 `conflict`, pointer `/name`).' }),
    description: nstr(),
    home_location_id: nuuid('Where returned devices go back to: a quick return moves the asset here unless the request names another location.'),
    default_loan_days: { type: ['integer', 'null'], minimum: 1, description: 'Length of a loan when the request has no `expected_return`: today (UTC) + this many days. null (the default) = the organisation\'s `default_expected_return_days` (`GET /v1/settings/custody`), else 7 (ED-24); the result is never longer than `max_loan_days`.' },
    max_loan_days: { type: ['integer', 'null'], minimum: 1, description: 'Longest a loan may run, counted from the day it started (also bounds an extension). Must be >= default_loan_days when that is set; null = no limit.' },
    max_loans_per_person: { type: ['integer', 'null'], minimum: 1, description: 'Most open loans one person may hold from this pool at once (409 `loan-limit-reached`); null = no limit.' },
    eligible_person_kinds: { type: ['array', 'null'], items: en(['employee', 'student', 'contractor', 'external']), minItems: 1, uniqueItems: true, description: 'Kinds of people who may borrow from the pool (422 `not-eligible` otherwise); null = every kind.' },
    owner_user_id: nuuid('The user told about overdue loans of this pool in addition to the borrower; without one the users who hold `loaner:manage` are told.'),
    is_active: bool({ default: true, description: 'false = the pool lends nothing (409 `loaner-pool-inactive`) but keeps its members and open loans.' }),
    email_borrowers_without_login: { type: ['boolean', 'null'], description: 'Whether a borrower who has no login account but has an e-mail address gets the due-soon and overdue e-mails (no in-app notification, there is no account). null (the default) = automatic: every kind of person except students; true = every borrower with an address; false = nobody (ED-24). Overdue loans are always also reported to the pool owner or the loaner managers.' },
  },
  required: ['name'],
  readOnly: {
    effective_default_loan_days: ro(int({ minimum: 1, description: 'The loan length a request without `expected_return` gets right now: `default_loan_days`, else the organisation\'s `default_expected_return_days`, else 7, cut to `max_loan_days` (ED-24). What the loaner desk pre-fills.' })),
    member_count: ro(int({ minimum: 0, description: 'Live (not archived) assets in the pool.' })),
    available_count: ro(int({ minimum: 0, description: 'Members that can be lent right now: not archived, in a `deployable` state and not checked out.' })),
    checked_out_count: ro(int({ minimum: 0, description: 'Members that are checked out (a loan from the pool or a regular check-out).' })),
    overdue_count: ro(int({ minimum: 0, description: 'Checked-out members whose `expected_return` is before today (UTC).' })),
    due_today_count: ro(int({ minimum: 0, description: 'Checked-out members whose `expected_return` is today (UTC).' })),
  },
});
S_.LoanerPool.required.push('effective_default_loan_days', 'email_borrowers_without_login', 'member_count', 'available_count', 'checked_out_count', 'overdue_count', 'due_today_count');
defineResource('Repair', {
  description: 'Repair / maintenance log entry (table `maintenance_record`).',
  props: {
    asset_id: uuid(),
    kind: en(['repair', 'maintenance', 'inspection', 'upgrade'], { default: 'repair' }),
    title: str({ minLength: 1, maxLength: 200 }),
    description: nstr(),
    reported_at: dt(),
    started_at: ndt(),
    vendor_id: nuuid(),
    performed_by_person_id: nuuid(),
    ticket_ref: nstr(),
    cost: { oneOf: [S('Money'), { type: 'null' }] },
    restore_status_id: nuuid('Asset status restored on completion. Defaults to the asset status before the repair opened.'),
    status: en(['open', 'in_progress', 'cancelled'], { default: 'open', description: 'Completion happens through `POST /v1/repairs/{id}/complete`.' }),
  },
  required: ['asset_id', 'title'],
  createOnly: { set_status_id: uuid('Status label to put the asset in while the repair is open (typically an undeployable label such as "In repair").') },
  readOnly: { completed_at: ro(ndt()), resolution_notes: ro(nstr()) },
});
// repair status on read also includes "completed"
S_.Repair.properties.status = en(['open', 'in_progress', 'completed', 'cancelled']);

// ---------------------------------------------------------------- assets
const assetProps = {
  asset_tag: str({ minLength: 1, maxLength: 64, pattern: '^\\S+$', description: 'Unique per tenant (case-insensitive). If omitted on create, generated from the category `tag_prefix`.' }),
  name: nstr({ maxLength: 200 }),
  serial: nstr(),
  category_id: uuid('An asset-kind category. Must equal the model\'s category when a model is set.'),
  model_id: nuuid(),
  status_id: uuid('Defaults to the tenant default status label.'),
  location_id: nuuid(),
  department_id: nuuid('[ED-17] The owning / cost-centre department (optional); where the asset is stays `location_id`.'),
  company_id: uuid('Defaults to the tenant default company.'),
  vendor_id: nuuid(),
  parent_asset_id: nuuid('Parent asset (e.g. a laptop in a cart).'),
  purchase_date: ndate(),
  purchase_cost: { oneOf: [S('Money'), { type: 'null' }] },
  order_number: nstr(),
  warranty_end: ndate(),
  notes: nstr(),
  custom_data: S('CustomData'),
  external_source: nstr({ description: 'Origin system, e.g. `snipe_it`, `google_admin`. Set together with `external_id`.' }),
  external_id: nstr(),
};
S_.AssignmentSummary = obj({
  assignment_id: uuid(),
  target_type: en(['person', 'location', 'asset']),
  target_id: uuid(),
  target_name: nstr(),
  checked_out_at: dt(),
  expected_return: ndate(),
  overdue: bool({ description: '[M2-W1] Computed: the assignment is open and `expected_return` is before today (UTC).' }),
  loaner_pool_id: nuuid(),
}, ['assignment_id', 'target_type', 'target_id', 'checked_out_at']);
S_.AssetDisposal = obj({
  disposed_on: date(),
  reason: en(['sold', 'donated', 'recycled', 'scrapped', 'stolen', 'returned_to_vendor', 'other']),
  note: nstr(),
}, ['disposed_on', 'reason'], { description: '[M2-W1] Why and when the asset left the inventory.' });
S_.Asset = obj({
  ...baseRead(true),
  ...assetProps,
  label_code: ro(str({ description: 'Opaque, unguessable code encoded in the QR label URL.' })),
  current_assignment: ro({ oneOf: [S('AssignmentSummary'), { type: 'null' }], description: 'Open custody period, or null when in stock.' }),
  // [M2-W1] disposal (M2-LIFE-05)
  disposal: ro({ oneOf: [S('AssetDisposal'), { type: 'null' }], description: 'Set once the asset was disposed of (`POST /v1/assets/{id}/dispose`); null otherwise.' }),
  status: ro(obj({ id: uuid(), name: str(), state_type: str() }, ['id', 'name', 'state_type'])),
  expanded: ro(obj({}, [], { additionalProperties: true, description: 'Related objects requested through `expand` (model, category, location, vendor, department).' })),
}, ['id', 'asset_tag', 'category_id', 'status_id', 'custom_data']);
S_.AssetCreate = obj({ ...assetProps, asset_tag: { ...assetProps.asset_tag, description: assetProps.asset_tag.description } }, ['category_id'], { additionalProperties: false });
S_.AssetUpdate = obj({ ...assetProps }, [], { additionalProperties: false, description: 'Partial update (merge semantics). `custom_data` is merged per key; set a key to null to remove it. Changing status or location writes history events.' });
S_.AssetList = obj({ data: arr(S('Asset')), page: S('PageInfo') }, ['data', 'page']);
// M2 wave 1b (files): BEGIN - the primary picture of an asset (M2-FILE-03). Not on create: an attachment needs its owner to exist.
{
  const assetImage = nuuid('Primary picture: an image attachment (`entity_type=asset`) of this asset. Upload it with `POST /v1/attachments`, then set its id here; `null` clears it. Not accepted on create.');
  S_.Asset.properties.image_attachment_id = assetImage;
  S_.AssetUpdate.properties.image_attachment_id = assetImage;
}
// M2 wave 1b (files): END

S_.ScanResolveResult = obj({
  // [M2-INT] `serial`: the exact device serial number is accepted too
  match_type: en(['label_code', 'asset_tag', 'serial'], { description: 'What the code was: the opaque `label_code` of the label, the `asset_tag`, or the device `serial` (checked in that order).' }),
  asset: S('Asset'),
  allowed_actions: arr(en(['checkout', 'checkin', 'transfer', 'update', 'open_repair']), { description: 'Actions valid for the asset in its current state and for the caller.' }),
  // M2 wave 1b (scan codes): BEGIN
  entity_type: en(['asset'], { description: 'Kind of record the code identifies: always `asset` in this result. Accessories and consumables are answered with their own results (`ScanResolveAccessoryResult`, `ScanResolveConsumableResult`; see `ScanResolveResponse`), so branch on this field.' }),
  // M2 wave 1b (scan codes): END
}, ['match_type', 'entity_type', 'asset', 'allowed_actions']);

// [M2-W2 ACC]: BEGIN - scan resolve answers accessories and consumables too (their own `entity_type`).
// `ScanResolveResult` above stays the answer for an asset; the 200 response of `resolveScan` is a oneOf of the
// three results, told apart by `entity_type`.
S_.ScanResolveAccessoryResult = obj({
  match_type: en(['label_code'], { description: 'Accessories are found by their `label_code` only.' }),
  entity_type: en(['accessory']),
  accessory: S('Accessory'),
  allowed_actions: arr(en(['checkout', 'checkin', 'update']), { description: '`checkout`: the caller may check units out and some are available. `checkin`: the caller may return units and some are out. `update`: the caller may edit the accessory.' }),
}, ['match_type', 'entity_type', 'accessory', 'allowed_actions'], { description: 'A scanned accessory label.' });
S_.ScanResolveConsumableResult = obj({
  match_type: en(['label_code']),
  entity_type: en(['consumable']),
  consumable: S('Consumable'),
  allowed_actions: arr(en(['issue', 'receive', 'adjust', 'update']), { description: '`issue` (consume) needs stock on hand; `receive` and `adjust` need `consumable:adjust`; `update` needs `consumable:manage`.' }),
}, ['match_type', 'entity_type', 'consumable', 'allowed_actions'], { description: 'A scanned consumable label.' });
S_.ScanResolveResponse = {
  description: 'What a scanned code identifies. Branch on `entity_type`.',
  oneOf: [S('ScanResolveResult'), S('ScanResolveAccessoryResult'), S('ScanResolveConsumableResult')],
  discriminator: { propertyName: 'entity_type', mapping: { asset: '#/components/schemas/ScanResolveResult', accessory: '#/components/schemas/ScanResolveAccessoryResult', consumable: '#/components/schemas/ScanResolveConsumableResult' } },
};
// [M2-W2 ACC]: END

// ---------------------------------------------------------------- custody
S_.Assignment = obj({
  id: ro(uuid()),
  asset_id: nuuid(),
  accessory_id: nuuid(),
  person_id: nuuid(),
  location_id: nuuid(),
  target_asset_id: nuuid(),
  quantity: int({ minimum: 1 }),
  quantity_returned: int({ minimum: 0, description: 'Units already returned. Always 0 while an asset is out and 1 once it is checked in; for accessories it grows with each partial return. `0 <= quantity_returned <= quantity`, and the assignment is closed (`checked_in_at` set) exactly when `quantity_returned = quantity`. Outstanding units = `quantity - quantity_returned`.' }),
  loaner_pool_id: nuuid(),
  checked_out_at: dt(),
  checked_out_by: nuuid(),
  expected_return: ndate(),
  checked_in_at: ndt(),
  checked_in_by: nuuid(),
  checkin_location_id: nuuid(),
  acceptance_state: en(['not_required', 'pending', 'accepted', 'declined']),
  note: nstr(),
  checkin_note: nstr(),
  // [M2-INT] condition recorded at check-in
  checkin_condition: { type: ['string', 'null'], enum: ['good', 'fair', 'poor', 'damaged', null], description: 'Condition of the asset when it came back (`CheckinRequest.condition`); `null` while the assignment is open or when none was stated.' },
  // [M2-W1]
  attachment_ids: arr(uuid(), { description: 'Photos / signatures linked at check-out (ids only; the attachments service owns the files).' }),
  checkin_attachment_ids: arr(uuid(), { description: 'Photos linked at check-in.' }),
  overdue: bool({ description: 'Computed: the assignment is open and `expected_return` is before today (UTC).' }),
  asset_tag: nstr({ description: 'Tag of the asset; present in the assignment lists of a person and of an asset.' }),
  asset_name: nstr({ description: 'Name of the asset; present together with `asset_tag`.' }),
  // [M2-W2 ACC] accessory assignments
  accessory_name: nstr({ description: 'Name of the accessory; present in the assignment lists of a person and of an accessory (accessory assignments only).' }),
  target_name: nstr({ description: 'Display name of the person, location or asset the units are with; present in the assignment list of an accessory.' }),
}, ['id', 'quantity', 'quantity_returned', 'checked_out_at', 'acceptance_state'], { description: 'One custody period. Exactly one of asset_id / accessory_id and exactly one of person_id / location_id / target_asset_id is set.' });
S_.AssignmentList = obj({ data: arr(S('Assignment')), page: S('PageInfo') }, ['data', 'page']);
S_.CheckoutRequest = {
  allOf: [S('AssignmentTarget'), obj({
    expected_return: date({ description: 'Required for loaner pool check-outs.' }),
    note: str({ maxLength: 2000 }),
    acceptance_required: bool({ default: false, description: 'Creates the assignment with `acceptance_state=pending`.' }),
    attachment_ids: arr(uuid(), { description: 'Photos/signatures uploaded against the asset beforehand (`POST /v1/attachments` with `entity_type=asset`; `pending` or `clean`). They are linked to the new assignment and then list under it (`entity_type=assignment`). `422` with the pointer `/attachment_ids/<index>` when an id is unknown, belongs to another asset or organisation, or was rejected (infected, error).', maxItems: 10 }),
    // [M2-INT]
    status_label_id: uuid('Status to give the asset: a non-archived label of type `deployed`. Default: the organisation\'s first deployed label.'),
  })],
  description: 'Check an asset out to a person, location or another asset.',
};
S_.CheckinRequest = obj({
  checkin_location_id: nuuid('Where the asset is now; also updates the asset location.'),
  status_id: nuuid('Status to set on check-in (default: the tenant default deployable status).'),
  // [M2-INT]
  condition: en(['good', 'fair', 'poor', 'damaged'], { description: 'Condition of the asset as it comes back; stored on the assignment (`checkin_condition`) and shown in the history.' }),
  note: str({ maxLength: 2000 }),
  attachment_ids: arr(uuid(), { maxItems: 10, description: 'Photos uploaded against the asset beforehand (`pending` or `clean`); linked to the closed assignment, same rules and `422` pointers as at check-out.' }),
});
S_.TransferRequest = {
  allOf: [S('AssignmentTarget'), obj({
    to_location_id: nuuid('Physical destination, if different from the new assignee\'s location.'),
    expected_return: date(),
    reason: str({ maxLength: 500 }),
    note: str({ maxLength: 2000 }),
    attachment_ids: arr(uuid(), { maxItems: 10, description: 'Photos uploaded against the asset beforehand; linked to the new assignment (same rules and `422` pointers as at check-out).' }),
  })],
  description: 'Atomic hand-over: closes the current assignment (if any) and opens a new one to the given target.',
};
S_.Transfer = obj({
  id: ro(uuid()),
  asset_id: uuid(),
  from_assignment_id: nuuid(),
  to_assignment_id: uuid(),
  from_location_id: nuuid(),
  to_location_id: nuuid(),
  reason: nstr(),
  note: nstr(),
  transferred_at: dt(),
  transferred_by: nuuid(),
}, ['id', 'asset_id', 'to_assignment_id', 'transferred_at']);
S_.CustodyResult = obj({
  asset: S('Asset'),
  assignment: S('Assignment'),
}, ['asset', 'assignment'], { description: 'Result of a check-out or check-in: the **updated asset** (status, location and `current_assignment` reflect the change; its new `ETag` is also in the response header) and the assignment that was opened (check-out) or closed (check-in).' });
S_.TransferResult = obj({
  asset: S('Asset'),
  transfer: S('Transfer'),
  assignment: S('Assignment'),
}, ['asset', 'transfer', 'assignment'], { description: 'Result of a transfer: the **updated asset** (new `ETag` also in the header), the `Transfer` record and the newly opened assignment.' });
S_.HistoryEvent = obj({
  id: uuid(),
  asset_id: uuid(),
  at: dt(),
  event_type: en(['created', 'updated', 'status_changed', 'location_changed', 'checked_out', 'checked_in', 'transferred', 'repair_opened', 'repair_completed', 'archived', 'restored', 'label_printed', 'imported', 'custody_undone']),
  actor_type: en(['user', 'api_key', 'integration', 'system']),
  actor_id: nuuid(),
  actor: { oneOf: [obj({ id: uuid(), display_name: str() }, ['id', 'display_name']), { type: 'null' }], description: 'Who did it, resolved for display (the user, or the API key name for `actor_type: api_key`); null for system events or when the user no longer exists.' },
  asset_tag: nstr({ description: '[M2-W1] Tag of the asset, so a per-person timeline can label its entries.' }),
  assignment_id: nuuid(),
  transfer_id: nuuid(),
  summary: nstr(),
  // [M2-INT] payload shapes per event type
  payload: { type: 'object', additionalProperties: true, description: [
    'Event details; the keys depend on `event_type` (all ids are uuids, names are display strings, optional keys are absent when empty):',
    '',
    '- `created`: `{status_id, location_id, cloned_from?}`',
    '- `updated`: `{fields: string[]}`, the names of the fields that changed',
    '- `status_changed`: `{from, to, from_name, to_name}` (status label ids and names); a lost/found mark adds `action: "lost" | "found"` and `note?`',
    '- `location_changed`: `{from, to, from_name, to_name, note?}` (location ids, `null` when unknown)',
    '- `checked_out`: `{assignment_id, target_type: "person"|"location"|"asset", target_id, target_name, expected_return, status: {from, to, from_id, to_id}, note?, attachment_ids?}`',
    '- `checked_in`: `{assignment_id, target_type, target_id, target_name, status: {from, to, from_id, to_id}, location?: {from, to}, condition?: "good"|"fair"|"poor"|"damaged", note?, attachment_ids?}`',
    '- `transferred`: `{from: {type, id, name} | null, to: {type, id, name}, from_assignment_id, to_assignment_id, status?: {from, to, from_id, to_id} (only for a transfer out of stock), location?: {from, to}, reason?, note?, attachment_ids?}`',
    '- `custody_undone` ([M2-UX-02, ED-23]): written by `POST /v1/assets/{id}/undo-custody` next to (never instead of) the event it reverses: `{undone: "checkout"|"checkin"|"transfer", undone_event_type, undone_assignment_id, assignment_id?, target_type?, target_id?, target_name?, status: {from, to}, location?: {from, to}}`',
    '- `archived`: `{}`; when the asset was disposed of: `{disposal: {disposed_on, reason, note}, from, to, from_name, to_name}`',
    '- `restored`: `{}` or `{was_disposed: true}`',
    '- `label_printed` ([M2-W2 LABELS]): `{batch_id, template_key, copies}`; the actor is the user (or API key) that requested the label batch',
    '- `repair_opened`, `repair_completed`, `imported`: reserved for later milestones (an empty object until then)',
  ].join('\n') },
}, ['id', 'asset_id', 'at', 'event_type', 'actor_type']);
S_.HistoryEventList = obj({ data: arr(S('HistoryEvent')), page: S('PageInfo') }, ['data', 'page']);
S_.AccessoryCheckoutRequest = {
  allOf: [S('AssignmentTarget'), obj({
    quantity: int({ minimum: 1, default: 1 }),
    expected_return: date(),
    note: str({ maxLength: 2000 }),
  })],
};
S_.AccessoryCheckinRequest = obj({
  assignment_id: uuid('The open assignment being returned.'),
  quantity: int({ minimum: 1, description: 'Units being returned now; defaults to everything still outstanding (`quantity - quantity_returned`). A partial return adds to `quantity_returned` and leaves the assignment open; the return that brings `quantity_returned` up to `quantity` closes it. More than the outstanding units is rejected with 422.' }),
  note: str({ maxLength: 2000 }),
}, ['assignment_id']);

// consumables
S_.StockMovement = obj({
  id: ro(uuid()),
  consumable_id: uuid(),
  qty_delta: int({ description: 'Non-zero; negative = stock leaves.' }),
  reason: en(['receive', 'issue', 'return', 'adjust', 'correction']),
  person_id: nuuid(),
  note: nstr(),
  balance_after: int({ minimum: 0, description: 'Stock on hand right after this movement.' }),
  by_user_id: nuuid(),
  at: dt(),
  // [M2-W2 ACC] display names, present in the stock lists
  consumable_name: nstr({ description: 'Name of the consumable; present in the lists.' }),
  person_name: nstr({ description: 'Name of the person the stock was issued to / returned by; present in the lists.' }),
}, ['id', 'consumable_id', 'qty_delta', 'reason', 'balance_after', 'at']);
S_.StockMovementCreate = obj({
  qty_delta: { type: 'integer', not: { const: 0 }, description: 'Non-zero. The sign must match the reason: `receive` and `return` are positive, `issue` is negative, `adjust` and `correction` either way (422 `validation` otherwise). Rejected with 409 `insufficient-stock` if it would make stock negative.' },
  reason: en(['receive', 'issue', 'return', 'adjust', 'correction'], { description: '`receive`: stock arrives. `issue`: stock is consumed (optionally by a person). `return`: unused stock comes back. `adjust` / `correction`: the count differs from the ledger; these two need a `note` saying why.' }),
  person_id: nuuid('Who it was issued to / returned by.'),
  note: str({ maxLength: 2000, description: 'Required (non-blank) for `adjust` and `correction`.' }),
}, ['qty_delta', 'reason'], { additionalProperties: false });
S_.StockMovementList = obj({ data: arr(S('StockMovement')), page: S('PageInfo') }, ['data', 'page']);

// loaners
// [LOAN] BEGIN - loaner pools, quick loans, overdue, dashboard (ED-20, ED-21, ADR 0011)
S_.LoanerPoolMember = obj({ asset_id: uuid(), loaner_pool_id: uuid(), added_at: dt(), available: bool({ description: 'Can be lent right now: not archived, in a `deployable` state and not checked out.' }), asset: S('Asset') }, ['asset_id', 'loaner_pool_id', 'added_at', 'available']);
S_.LoanerPoolMemberList = obj({ data: arr(S('LoanerPoolMember')), page: S('PageInfo') }, ['data', 'page']);
S_.LoanerPoolMembersBulk = obj({ ids: bulkIds() }, ['ids'], { additionalProperties: false, description: 'Asset ids (at most 100).' });
S_.LoanerPoolMemberBulkResult = obj({
  results: arr(obj({
    index: int(),
    status: int({ description: 'HTTP status the single-asset operation would have returned (201 added, 204 removed).' }),
    data: S('LoanerPoolMember'),
    error: S('Problem'),
  }, ['index', 'status'])),
  summary: obj({ total: int(), succeeded: int(), failed: int() }, ['total', 'succeeded', 'failed']),
}, ['results', 'summary']);
S_.LoanerCheckoutRequest = obj({
  person_id: uuid(),
  asset_id: uuid('A specific pool member. If omitted, the next available member is chosen (ED-24: the member idle the longest, a device never lent first, ties by the lowest asset tag; the answer names it).'),
  expected_return: date({ description: 'Defaults to today (UTC) + the pool\'s `default_loan_days`, else + the organisation\'s `default_expected_return_days`, else + 7 days (ED-24), cut to `max_loan_days`; an explicit date must not exceed the start day + pool.max_loan_days.' }),
  note: str({ maxLength: 2000 }),
}, ['person_id'], { additionalProperties: false });
S_.PersonBrief = obj({
  id: uuid(),
  display_name: str(),
  kind: en(['employee', 'student', 'contractor', 'external']),
  email: nstr(),
  employee_ref: nstr(),
}, ['id', 'display_name', 'kind'], { description: 'The borrower a scan resolved to.' });
S_.QuickLoanRequest = obj({
  person_id: uuid('The borrower by id. Exactly one of `person_id` and `borrower`.'),
  borrower: str({ minLength: 1, maxLength: 254, description: 'The borrower as scanned or typed: the exact email address or the exact `employee_ref` (the badge / student number), matched case-insensitively. Exactly one of `person_id` and `borrower`. 422 (pointer `/borrower`, code `not-found`) when nobody matches, 409 `conflict` when the text matches two different people.' }),
  codes: arr(str({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 50, description: 'The devices: the opaque QR `label_code` (or the whole label URL), the asset tag or the exact serial number, as `GET /v1/scan/resolve` accepts them. Several devices per borrower in one request.' }),
  expected_return: date({ description: 'One due date for every device. Defaults like `LoanerCheckoutRequest.expected_return` (pool default, organisation default, 7 days); must not exceed the start day + pool.max_loan_days.' }),
  note: str({ maxLength: 2000 }),
}, ['codes'], {
  additionalProperties: false,
  oneOf: [{ required: ['person_id'] }, { required: ['borrower'] }],
  description: 'Quick check-out by scanning: one borrower, one or more devices.',
});
S_.QuickLoanResult = obj({
  person: S('PersonBrief'),
  loaner_pool_id: uuid(),
  expected_return: date({ description: 'The due date that applied (the request\'s, or the pool default).' }),
  results: arr(obj({
    index: int({ description: 'Position of the code in the request.' }),
    code: str({ description: 'The code as sent.' }),
    status: int({ description: '201 when the loan was opened, otherwise the status of the problem.' }),
    data: S('CustodyResult'),
    error: S('Problem'),
  }, ['index', 'code', 'status'])),
  summary: obj({ total: int(), succeeded: int(), failed: int() }, ['total', 'succeeded', 'failed']),
}, ['person', 'loaner_pool_id', 'expected_return', 'results', 'summary'], { description: 'Per-device outcome of a quick check-out, in request order. A device that fails (unknown code, not in this pool, already out, borrower at the pool\'s limit...) does not stop the others.' });
S_.LoanReturnRequest = obj({
  codes: arr(str({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: 100, description: 'The returned devices (label code or URL, asset tag or serial), as for a quick check-out.' }),
  loaner_pool_id: uuid('Only accept devices of this pool (422 `not-in-pool` for others).'),
  checkin_location_id: nuuid('Where the devices are now; default the pool\'s `home_location_id`.'),
  status_id: nuuid('Status to set on every device (default: the tenant default deployable status).'),
  condition: en(['good', 'fair', 'poor', 'damaged']),
  note: str({ maxLength: 2000 }),
}, ['codes'], { additionalProperties: false, description: 'Return by scanning: one or many devices, any borrowers.' });
S_.LoanReturnResult = obj({
  results: arr(obj({
    index: int({ description: 'Position of the code in the request.' }),
    code: str({ description: 'The code as sent.' }),
    status: int({ description: '200 when the device was checked in, otherwise the status of the problem.' }),
    data: S('CustodyResult'),
    error: S('Problem'),
  }, ['index', 'code', 'status'])),
  summary: obj({ total: int(), succeeded: int(), failed: int() }, ['total', 'succeeded', 'failed']),
}, ['results', 'summary'], { description: 'Per-device outcome of a quick return, in request order (the per-scan feedback of the bulk check-in screen). Returning a device that is not out is a per-item `409 asset-not-checked-out`.' });
S_.Loan = obj({
  id: uuid('The assignment id.'),
  asset_id: uuid(),
  asset_tag: str(),
  asset_name: nstr(),
  loaner_pool_id: uuid(),
  pool_name: str(),
  person_id: nuuid(),
  person_name: nstr(),
  person_email: nstr(),
  person_ref: nstr({ description: 'The borrower\'s `employee_ref` (badge, student number).' }),
  checked_out_at: dt(),
  expected_return: date(),
  returned_at: ndt({ description: 'When the device came back; null while it is out.' }),
  state: en(['on_loan', 'due_today', 'overdue', 'returned'], { description: '`on_loan` = out and due after today, `due_today`, `overdue` = out and due before today, `returned`. "Today" is the UTC date.' }),
  days_overdue: int({ minimum: 0, description: 'Whole days past the due date while `overdue`; 0 otherwise.' }),
  note: nstr(),
}, ['id', 'asset_id', 'asset_tag', 'loaner_pool_id', 'pool_name', 'checked_out_at', 'expected_return', 'state', 'days_overdue'], { description: 'A loan: one device out of a pool (an assignment with `loaner_pool_id`).' });
S_.LoanList = obj({ data: arr(S('Loan')), page: S('PageInfo') }, ['data', 'page']);
S_.LoanExtendRequest = obj({
  expected_return: date({ description: 'The new due date: later than the current one, not before today (UTC) and within the pool\'s `max_loan_days` counted from the day the loan started.' }),
  note: str({ maxLength: 500, description: 'Why (audit trail and history).' }),
}, ['expected_return'], { additionalProperties: false });
S_.OverdueCheckout = obj({
  assignment_id: uuid(),
  asset_id: uuid(),
  asset_tag: str(),
  asset_name: nstr(),
  person_id: nuuid(),
  location_id: nuuid(),
  target_asset_id: nuuid(),
  holder_name: nstr({ description: 'Display name of the person, location or asset the device is with.' }),
  loaner_pool_id: nuuid(),
  pool_name: nstr(),
  expected_return: date(),
  days_overdue: int({ minimum: 1 }),
}, ['assignment_id', 'asset_id', 'asset_tag', 'expected_return', 'days_overdue']);
S_.OverdueCheckoutList = obj({ data: arr(S('OverdueCheckout')), page: S('PageInfo') }, ['data', 'page']);
S_.LoanerDashboardPool = obj({
  id: uuid(),
  name: str(),
  is_active: bool(),
  member_count: int({ minimum: 0 }),
  available_count: int({ minimum: 0 }),
  checked_out_count: int({ minimum: 0, description: 'Members that are checked out (includes the overdue ones and those due today).' }),
  overdue_count: int({ minimum: 0 }),
  due_today_count: int({ minimum: 0 }),
  due_soon_count: int({ minimum: 0, description: 'Checked-out members due after today but within the tenant\'s `loan_reminder_days`.' }),
}, ['id', 'name', 'is_active', 'member_count', 'available_count', 'checked_out_count', 'overdue_count', 'due_today_count', 'due_soon_count']);
S_.LoanerActivity = obj({
  at: dt(),
  kind: en(['checked_out', 'checked_in']),
  assignment_id: uuid(),
  asset_id: uuid(),
  asset_tag: str(),
  asset_name: nstr(),
  person_id: nuuid(),
  person_name: nstr(),
  loaner_pool_id: uuid(),
  pool_name: str(),
  expected_return: date(),
}, ['at', 'kind', 'assignment_id', 'asset_id', 'asset_tag', 'loaner_pool_id', 'pool_name', 'expected_return']);
S_.LoanerDashboard = obj({
  as_of: date({ description: 'The UTC date the counts are for.' }),
  totals: obj({
    pools: int({ minimum: 0 }),
    members: int({ minimum: 0 }),
    available: int({ minimum: 0 }),
    checked_out: int({ minimum: 0 }),
    overdue: int({ minimum: 0 }),
    due_today: int({ minimum: 0 }),
    due_soon: int({ minimum: 0 }),
  }, ['pools', 'members', 'available', 'checked_out', 'overdue', 'due_today', 'due_soon']),
  pools: arr(S('LoanerDashboardPool')),
  recent: arr(S('LoanerActivity'), { maxItems: 20, description: 'The latest check-outs and returns of loans from the pools, newest first (at most 20).' }),
}, ['as_of', 'totals', 'pools', 'recent'], { description: 'Everything the loaner dashboard page shows, in one call. Each count has a list behind it: `GET /v1/loans` (`loaner_pool_id`, `state`) for out / overdue / due today, `GET /v1/loaner-pools/{id}/members?available=true` for available.' });
S_.CustodySettings = obj({
  default_expected_return_days: { type: ['integer', 'null'], minimum: 1, maximum: 366, description: 'Pre-fill for the expected return of a check-out or transfer: today + this many days; null = none. A hint for clients: the API never applies it to an ordinary check-out (one without `expected_return` stays open-ended); a loaner loan whose pool has no `default_loan_days` takes it (ED-24).' },
  loan_reminder_days: int({ minimum: 0, maximum: 30, default: 2, description: 'How many days before the due date a borrower of a loaner pool gets the "due soon" reminder; 0 = no reminder.' }),
}, ['default_expected_return_days', 'loan_reminder_days']);
S_.CustodySettingsUpdate = obj({
  default_expected_return_days: { type: ['integer', 'null'], minimum: 1, maximum: 366 },
  loan_reminder_days: int({ minimum: 0, maximum: 30 }),
}, [], { additionalProperties: false, description: 'Replaces the settings; an omitted member is reset to its default (`null` / 2).' });
// [LOAN] END

// repairs
S_.RepairCompleteRequest = obj({
  completed_at: dt({ description: 'Defaults to now.' }),
  resolution_notes: str({ maxLength: 4000 }),
  cost: { oneOf: [S('Money'), { type: 'null' }] },
  restore_status_id: nuuid('Overrides the repair\'s `restore_status_id`.'),
}, [], { additionalProperties: false });

// labels
// [M2-W2 LABELS] BEGIN - M2-TAG-02: fixed templates (read, calibrate) and asynchronous label batches (replaces the first
// draft's synchronous `POST /v1/labels/render`).
const LABEL_FIELD_VALUES = ['asset_tag', 'name', 'serial', 'location', 'model', 'organisation'];
S_.LabelTemplate = obj({
  id: uuid(),
  key: str({ description: 'Stable key, the `template_key` of a batch.' }),
  name: str(),
  page_size: en(['letter', 'a4', 'custom']),
  page_width_mm: { type: 'number' }, page_height_mm: { type: 'number' },
  label_width_mm: { type: 'number' }, label_height_mm: { type: 'number' },
  cols: int(), rows: int(),
  slots: int({ description: 'Labels per sheet (`cols` x `rows`): the upper bound of a batch\'s `start_position`.' }),
  margin_top_mm: { type: 'number' }, margin_left_mm: { type: 'number' },
  gap_x_mm: { type: 'number', description: 'Space between two columns of labels.' }, gap_y_mm: { type: 'number', description: 'Space between two rows of labels.' },
  offset_x_mm: { type: 'number', minimum: -10, maximum: 10, description: 'Calibration: shifts the whole sheet to the right (negative: left). Change it with `PATCH` after a test print (M2-TAG-04).' },
  offset_y_mm: { type: 'number', minimum: -10, maximum: 10, description: 'Calibration: shifts the whole sheet down (negative: up).' },
  code_type: en(['qr', 'code128', 'qr_and_code128'], { description: 'The codes the template draws unless a batch says otherwise.' }),
  fields: arr(en(LABEL_FIELD_VALUES), { description: 'The text lines the template prints unless a batch says otherwise, first line first.' }),
  is_system: bool({ description: 'System templates are fixed in the MVP (the editor arrives in v1.1): only the two calibration offsets can change.' }),
}, ['id', 'key', 'name', 'page_size', 'page_width_mm', 'page_height_mm', 'label_width_mm', 'label_height_mm', 'cols', 'rows', 'slots', 'offset_x_mm', 'offset_y_mm', 'code_type', 'fields', 'is_system']);
S_.LabelTemplateList = obj({ data: arr(S('LabelTemplate')) }, ['data']);
S_.LabelTemplateUpdate = obj({
  offset_x_mm: { type: 'number', minimum: -10, maximum: 10, multipleOf: 0.01 },
  offset_y_mm: { type: 'number', minimum: -10, maximum: 10, multipleOf: 0.01 },
}, [], { additionalProperties: false, minProperties: 1, description: 'Calibration of a fixed template. At least one offset.' });
S_.LabelAssetFilter = obj({
  q: str({ minLength: 1, maxLength: 200 }),
  archived: en(['exclude', 'include', 'only'], { default: 'exclude' }),
  tag: str(), serial: str(),
  status_id: arr(uuid(), { maxItems: 200 }),
  state_type: arr(en(['deployable', 'deployed', 'pending', 'undeployable', 'archived', 'lost'])),
  category_id: arr(uuid(), { maxItems: 200 }),
  model_id: arr(uuid(), { maxItems: 200 }),
  manufacturer_id: uuid(),
  location_id: uuid(),
  include_sublocations: bool({ default: true }),
  assigned: bool(), assigned_person_id: uuid(), overdue: bool(),
  company_id: uuid(), vendor_id: uuid(), parent_asset_id: uuid(),
  import_job_id: uuid('[ED-38] The assets this import created ("Print labels for the new assets").'),
  warranty_end_before: date(), warranty_end_after: date(),
  purchase_date_from: date(), purchase_date_to: date(),
  updated_since: dt(),
  sort: str({ description: 'As the `sort` of `GET /v1/assets` (`asset_tag` by default here, so a sheet reads in tag order).', maxLength: 200 }),
}, [], { additionalProperties: false, description: 'The filters of `GET /v1/assets` that narrow the set (no paging, no `cf[...]` custom-field filters), as JSON: lists are arrays, flags are booleans.' });
S_.LabelBatchCreate = obj({
  template_key: str({ description: 'Key from `GET /v1/labels/templates`.' }),
  asset_ids: arr(uuid(), { minItems: 1, maxItems: 2000, uniqueItems: true, description: 'The assets, printed in this order. Send this or `filter`.' }),
  filter: S('LabelAssetFilter'),
  start_position: int({ minimum: 1, maximum: 1000, default: 1, description: '1-based slot of the first label on the first sheet (re-use a partly used sheet); at most the template\'s `slots`. Slots are numbered row by row, left to right.' }),
  copies: int({ minimum: 1, maximum: 10, default: 1, description: 'Labels per asset, printed next to each other.' }),
  codes: arr(en(['qr', 'code128']), { maxItems: 2, uniqueItems: true, description: 'Which codes to draw; default: the template\'s `code_type`. The QR encodes `<web base url>/s/<label_code>` (an opaque code, never an internal id), the Code128 encodes the asset tag (printable ASCII only). An empty list prints text only.' }),
  fields: arr(en(LABEL_FIELD_VALUES), { maxItems: 6, uniqueItems: true, description: 'The text lines to print, first line first and largest; default: the template\'s `fields`. Text shrinks to fit and ends with an ellipsis when it still does not.' }),
  logo_attachment_id: nuuid('Optional logo: a clean PNG or JPEG attachment of your organisation (at most 2 MiB), printed small above the text.'),
  outlines: bool({ default: false, description: 'Draw a hairline around every label: for calibration prints on plain paper.' }),
}, ['template_key'], { additionalProperties: false, description: 'Exactly one of `asset_ids` and `filter`. At most 2000 assets and 2000 labels (assets x copies) per batch.' });
S_.LabelBatch = obj({
  id: ro(uuid()),
  status: ro(en(['queued', 'ready', 'failed', 'expired'], { description: '`queued` until the worker has rendered the PDF, then `ready` (download it), `failed` (see `error`) or, after `expires_at`, `expired` (the file is deleted).' })),
  template_key: str(),
  source: en(['asset_ids', 'filter']),
  asset_count: int(), copies: int(), label_count: int({ description: 'Labels printed: `asset_count` x `copies`.' }),
  start_position: int(),
  codes: arr(en(['qr', 'code128'])),
  fields: arr(en(LABEL_FIELD_VALUES)),
  outlines: bool(),
  logo_attachment_id: nuuid(),
  page_count: { type: ['integer', 'null'], description: 'Sheets in the PDF, once rendered.' },
  filename: nstr({ description: 'Suggested file name, once ready.' }),
  size_bytes: { type: ['integer', 'null'], format: 'int64' },
  created_at: ro(dt()),
  rendered_at: ro(ndt()),
  expires_at: ro(dt({ description: 'After this moment the file is deleted and the batch becomes `expired`.' })),
  download_url: ro({ type: ['string', 'null'], format: 'uri', description: 'A short-lived presigned URL of the PDF; only when `ready`. A fresh one comes with every read.' }),
  download_expires_at: ro(ndt()),
  error: ro({ oneOf: [obj({ code: str({ description: 'e.g. `logo-invalid`, `render-failed`.' }), detail: str() }, ['code', 'detail']), { type: 'null' }], description: 'Why the batch failed; `null` otherwise.' }),
}, ['id', 'status', 'template_key', 'source', 'asset_count', 'copies', 'label_count', 'start_position', 'codes', 'fields', 'outlines', 'page_count', 'created_at', 'expires_at', 'download_url', 'error'], { description: 'One request to print labels. Visible to the user (or API key) that made it, nobody else.' });
S_.LabelBatchList = obj({ data: arr(S('LabelBatch')), page: S('PageInfo') }, ['data', 'page']);
// [M2-W2 LABELS] END

// attachments
S_.Attachment = obj({
  id: ro(uuid()),
  entity_type: en(['asset', 'asset_model', 'accessory', 'consumable', 'location', 'person', 'maintenance_record', 'assignment', 'import_job']),
  entity_id: uuid(),
  kind: en(['photo', 'document', 'signature', 'import_file', 'other']),
  filename: str(),
  content_type: str(),
  size_bytes: int({ format: 'int64', minimum: 0 }),
  sha256: nstr({ pattern: '^[0-9a-f]{64}$' }),
  scan_status: ro(en(['pending', 'clean', 'infected', 'error'])),
  uploaded_at: ro(ndt()),
  created_at: ro(dt()),
  // M2 wave 1b (files): BEGIN
  scan_detail: ro(nstr({ description: 'Why the status is what it is: the signature name when `infected`, a short reason when `error` (`size-mismatch`, `content-mismatch`, `upload-abandoned`...), `scan-disabled` when the deployment runs without a scanner.' })),
  width: ro({ type: ['integer', 'null'], description: 'Pixel width of an image, once its thumbnail exists.' }),
  height: ro({ type: ['integer', 'null'], description: 'Pixel height of an image, once its thumbnail exists.' }),
  thumbnail_url: ro({ type: ['string', 'null'], format: 'uri', description: 'Short-lived URL of the metadata-free WebP thumbnail (images only, once generated, and only when `scan_status=clean`). Present on list and get.' }),
  // M2 wave 1b (files): END
  download_url: ro({ type: ['string', 'null'], format: 'uri', description: 'Short-lived signed URL, only when `scan_status=clean`; present on the list and on `GET /v1/attachments/{id}` alike (no per-item request needed). Images are served inline, everything else as an attachment download.' }),
}, ['id', 'entity_type', 'entity_id', 'kind', 'filename', 'content_type', 'size_bytes', 'scan_status', 'created_at']);
S_.AttachmentCreate = obj({
  entity_type: en(['asset', 'asset_model', 'accessory', 'consumable', 'location', 'person', 'maintenance_record', 'assignment', 'import_job']),
  entity_id: uuid(),
  kind: en(['photo', 'document', 'signature', 'import_file', 'other'], { default: 'document' }),
  filename: str({ minLength: 1, maxLength: 255 }),
  content_type: str(),
  size_bytes: int({ format: 'int64', minimum: 0 }),
  sha256: str({ pattern: '^[0-9a-f]{64}$' }),
}, ['entity_type', 'entity_id', 'filename', 'content_type', 'size_bytes'], { additionalProperties: false });
S_.AttachmentUpload = obj({
  attachment: S('Attachment'),
  upload: obj({
    method: en(['PUT']),
    url: str({ format: 'uri', description: 'Presigned URL with size and content-type conditions; PUT the bytes here.' }),
    headers: { type: 'object', additionalProperties: str(), description: 'Headers that must accompany the PUT.' },
    expires_at: dt(),
  }, ['method', 'url', 'expires_at']),
}, ['attachment', 'upload']);
S_.AttachmentList = obj({ data: arr(S('Attachment')), page: S('PageInfo') }, ['data', 'page']);
// M2 wave 1b (files): BEGIN
S_.FilesSettings = obj({
  strip_exif_original: bool({ description: 'Re-encode every uploaded image without EXIF/GPS metadata (the stored original is replaced). Thumbnails are always metadata-free.' }),
  max_upload_bytes: { type: ['integer', 'null'], minimum: 1024, description: 'Lower the upload cap below the tier default; `null` = the tier default. It can never raise the cap above the tier.' },
  effective_max_upload_bytes: ro(int({ description: 'The cap that applies: the smaller of the override (or tier default) and the deployment ceiling.' })),
  tier_max_upload_bytes: ro(int({ description: 'The cap of the organisation\'s plan.' })),
}, ['strip_exif_original', 'max_upload_bytes']);
S_.FilesSettingsUpdate = obj({
  strip_exif_original: bool(),
  max_upload_bytes: { type: ['integer', 'null'], minimum: 1024 },
}, ['strip_exif_original', 'max_upload_bytes'], { additionalProperties: false });
// M2 wave 1b (files): END

// audit
S_.AuditEntry = obj({
  id: uuid(),
  at: dt(),
  actor_type: en(['user', 'api_key', 'integration', 'system']),
  actor_user_id: nuuid(),
  actor_ref: nuuid(),
  action: str({ examples: ['asset.checkout'] }),
  entity_type: str(),
  entity_id: nuuid(),
  diff: { type: ['object', 'null'], additionalProperties: true, description: '`{before, after}` with sensitive fields redacted.' },
  ip: nstr(),
  user_agent: nstr(),
  request_id: nstr(),
}, ['id', 'at', 'actor_type', 'action', 'entity_type']);
S_.AuditEntryList = obj({ data: arr(S('AuditEntry')), page: S('PageInfo') }, ['data', 'page']);

// ---------------------------------------------------------------- auth / access schemas
S_.LoginRequest = obj({
  email: str({ format: 'email' }),
  password: str({ format: 'password', minLength: 1, maxLength: 1024 }),
  tenant_slug: str({ pattern: '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$', description: 'Needed when the email exists in several tenants (or when using a tenant vanity host).' }),
}, ['email', 'password'], { additionalProperties: false });
S_.TenantChoice = obj({ slug: str(), name: str() }, ['slug', 'name']);
S_.LoginResponse = obj({
  status: en(['authenticated', 'mfa_required', 'tenant_selection_required']),
  csrf_token: str({ description: 'For `authenticated`: send as `X-CSRF-Token` on cookie-authenticated mutations.' }),
  mfa: obj({ challenge_id: str(), methods: arr(en(['totp', 'webauthn', 'recovery_code'])) }, ['challenge_id', 'methods'], { description: 'For `mfa_required`.' }),
  tenants: arr(S('TenantChoice'), { description: 'For `tenant_selection_required`.' }),
  user: S('User'),
}, ['status']);
S_.MfaVerifyRequest = obj({
  challenge_id: str(),
  method: en(['totp', 'webauthn', 'recovery_code']),
  code: str({ description: 'TOTP code, recovery code, or the WebAuthn assertion (JSON string).' }),
}, ['challenge_id', 'method', 'code'], { additionalProperties: false });
S_.Me = obj({
  user: S('User'),
  tenant: obj({
    id: uuid(), name: str(), plan: str(), base_currency: str(), cell: str(),
    branding: obj({
      logo_url: nstr({ format: 'uri', description: 'Absolute URL of the tenant logo. Always null until tenant branding ships (M4+).' }),
      accent_color: nstr({ pattern: '^#[0-9a-fA-F]{6}$', description: 'Accent colour as `#rrggbb`. Always null until tenant branding ships (M4+).' }),
    }, ['logo_url', 'accent_color'], { description: 'Tenant branding for the web shell. Always present; both fields are null in M1-M3 (clients use the default theme).' }),
  }, ['id', 'name', 'base_currency', 'branding']),
  default_company_id: uuid(),
  permissions: arr(str(), { description: 'Effective permissions of the principal (role permissions, or the API key scopes).' }),
  role_assignments: arr(S('RoleAssignment')),
  auth: obj({ method: en(['session', 'api_key']), mfa_verified: bool(), api_key_id: nuuid(), scopes: arr(str()) }, ['method']),
  mfa_enrolment_required: bool({ description: 'True when tenant policy requires MFA for this user and the user has not enrolled yet. The session is then *limited*: every endpoint except `/v1/auth/me`, `/v1/auth/logout` and `/v1/auth/mfa/enrol*` returns 403 `mfa-enrolment-required`. Always false for API keys.' }),
  session: {
    oneOf: [S('SessionExpiry'), { type: 'null' }],
    description: 'Lifetime of the current browser session; null when authenticated with an API key.',
  },
  csrf_token: str({ description: 'Only for cookie sessions.' }),
}, ['user', 'tenant', 'permissions', 'auth', 'mfa_enrolment_required', 'session']);
S_.SessionExpiry = obj({
  idle_expires_at: dt({ description: 'The session ends at this time unless there is activity before it; each authenticated request pushes it forward, never beyond `absolute_expires_at`.' }),
  absolute_expires_at: dt({ description: 'Hard end of the session regardless of activity.' }),
}, ['idle_expires_at', 'absolute_expires_at']);
S_.PasswordPolicy = obj({
  min_length: int({ description: 'Minimum length in Unicode code points after NFKC normalisation.', examples: [12] }),
  max_length: int({ description: 'Maximum length in Unicode code points (bounds hashing cost).', examples: [128] }),
  composition_rules: bool({ description: 'Always false: no required character classes. Length and the breach check are the policy.' }),
  breached_check: obj({
    enabled: bool(),
    sources: arr(en(['local_list', 'online_k_anonymity']), { description: 'Always includes `local_list` (bundled, works offline and in self-hosted installs). `online_k_anonymity` is present only when the operator enabled the optional provider; only a hash prefix ever leaves the server.' }),
  }, ['enabled', 'sources']),
  rejection_codes: arr(en(['too-short', 'too-long', 'breached']), { description: 'Field codes returned in `errors[].code` at pointer `/password` on a 422.' }),
}, ['min_length', 'max_length', 'composition_rules', 'breached_check'], { description: 'The password rules enforced by `POST /v1/auth/password/reset` and `POST /v1/auth/invitations/accept`. Defaults: min 12, max 128, breached-password check on (bundled local list; optional online k-anonymity provider). Clients read this instead of hardcoding limits.' });
S_.Password = str({ format: 'password', minLength: 12, maxLength: 128, description: 'New password. Policy: 12-128 characters, no composition rules, NFKC-normalised, rejected if found in the breached-password list. A violation returns 422 with `errors[]` pointer `/password` and code `too-short`, `too-long` or `breached`. Live limits: `GET /v1/auth/password-policy`.' });
S_.ForgotPasswordRequest = obj({ email: str({ format: 'email' }) }, ['email'], { additionalProperties: false });
S_.ResetPasswordRequest = obj({
  token: str({ description: 'Single-use token from the reset email link.' }),
  password: S('Password'),
}, ['token', 'password'], { additionalProperties: false });
S_.InvitationInfo = obj({
  email: str({ format: 'email' }),
  display_name: str({ description: 'Name the administrator entered; the invitee may change it on accept.' }),
  tenant_name: str(),
  role_name: str({ description: 'Display name of the invited role (for example "Asset Manager").' }),
  expires_at: dt(),
  mfa_enrolment_required: bool({ description: 'The tenant requires MFA for this role: after accepting, the new session is limited until the user enrols (see `Me.mfa_enrolment_required`).' }),
}, ['email', 'display_name', 'tenant_name', 'expires_at', 'mfa_enrolment_required'], { description: 'What the accept-invitation screen shows before the user picks a password. Contains no secret.' });
S_.AcceptInvitationRequest = obj({
  token: str({ description: 'Single-use invitation token from the email link.' }),
  password: S('Password'),
  display_name: str({ minLength: 1, maxLength: 200 }),
}, ['token', 'password', 'display_name'], { additionalProperties: false });
S_.MfaEnrolment = obj({
  secret: str({ description: 'Base32 TOTP shared secret, for manual entry.' }),
  provisioning_uri: str({ description: '`otpauth://totp/...` URI that the QR code encodes.' }),
}, ['secret', 'provisioning_uri'], { description: 'A pending (not yet active) TOTP factor. It becomes active only after `POST /v1/auth/mfa/enrol/confirm`. Calling enrol again before confirming replaces the pending secret.' });
S_.MfaConfirmRequest = obj({ code: str({ pattern: '^[0-9 ]{6,8}$', description: 'Current 6-digit TOTP code (spaces ignored).' }) }, ['code'], { additionalProperties: false });
const RECOVERY_CODES = arr(str(), { minItems: 10, maxItems: 10, description: 'Ten single-use recovery codes. Shown **once**; only their hashes are stored. Any earlier set is invalidated.' });
S_.MfaRecoveryCodes = obj({ recovery_codes: RECOVERY_CODES }, ['recovery_codes']);
S_.MfaEnrolmentConfirmed = obj({
  recovery_codes: RECOVERY_CODES,
  csrf_token: str({ description: 'The session is rotated on activation, so the CSRF token changes: store this one and send it as `X-CSRF-Token` on the next cookie-authenticated mutation.' }),
}, ['recovery_codes', 'csrf_token']);
S_.ReauthRequest = {
  type: 'object',
  description: 'Proof of a recent sign-in for a sensitive action. Send the current password **or** a current TOTP code. A wrong value returns 403 `reauth-failed` and counts toward the account lockout.',
  properties: {
    password: str({ format: 'password', maxLength: 1024 }),
    totp_code: str({ pattern: '^[0-9 ]{6,8}$' }),
  },
  anyOf: [{ required: ['password'] }, { required: ['totp_code'] }],
  additionalProperties: false,
};
S_.SessionInfo = obj({
  id: uuid('Session id (not the cookie token).'),
  created_at: dt(),
  last_seen_at: dt(),
  ip: nstr({ description: 'IP address the session was last seen from.' }),
  user_agent: nstr({ description: 'Raw or summarised user agent.' }),
  current: bool({ description: 'True for the session making this request.' }),
}, ['id', 'created_at', 'last_seen_at', 'ip', 'user_agent', 'current']);
S_.SessionInfoList = obj({ data: arr(S('SessionInfo')) }, ['data']);
S_.SearchResult = obj({
  type: en(['asset', 'model', 'category', 'person', 'location']),
  id: uuid(),
  label: str({ description: 'Primary text, e.g. asset tag + name, model name, category name.' }),
  sublabel: nstr({ description: 'Secondary text, e.g. serial number or model; null if none.' }),
  href_hint: str({ description: 'App-relative path the web client may navigate to (for example `/assets/view?id=<uuid>`). A hint only: clients own routing and may build the URL from `type` and `id`.' }),
}, ['type', 'id', 'label', 'sublabel', 'href_hint']);
S_.SearchResultList = obj({ data: arr(S('SearchResult'), { description: 'Grouped by type in the order of the `types` parameter (default: asset, model, category, person, location), best match first within a group; at most `limit` per type.' }) }, ['data']);
S_.RoleAssignment = obj({
  id: ro(uuid()),
  role_id: uuid(),
  scope_type: en(['tenant', 'company', 'location'], { default: 'tenant' }),
  company_id: nuuid('Required when scope_type=company.'),
  location_id: nuuid('Required when scope_type=location; the grant covers the location subtree.'),
}, ['role_id']);
defineResource('User', {
  description: 'Login-capable account. People who only receive assets are `Person` records.',
  props: {
    email: str({ format: 'email' }),
    display_name: str({ minLength: 1, maxLength: 200 }),
    status: en(['invited', 'active', 'disabled']),
    locale: nstr(),
    timezone: nstr(),
    role_assignments: arr(S('RoleAssignment'), { minItems: 1 }),
  },
  required: ['email', 'display_name', 'role_assignments'],
  createOnly: { send_invite: bool({ default: true }) },
  readOnly: { mfa_enabled: ro(bool()), last_login_at: ro(ndt()), person_id: ro(nuuid('[M2-USR-03] The person record of this login account (every login has exactly one; see `POST /v1/people/{id}/link-user`). Filled by `/v1/users` and `/v1/me`; null in login responses.')) },
});
S_.Role = obj({ id: uuid(), key: str(), name: str(), description: nstr(), permissions: arr(str()), is_builtin: bool() }, ['id', 'key', 'name', 'permissions', 'is_builtin']);
S_.RoleList = obj({ data: arr(S('Role')) }, ['data']);
S_.Company = obj({ id: uuid(), name: str(), code: nstr(), is_default: bool() }, ['id', 'name', 'is_default']);
S_.CompanyList = obj({ data: arr(S('Company')) }, ['data']);
S_.ApiKey = obj({
  id: ro(uuid()),
  name: str({ minLength: 1, maxLength: 100 }),
  key_prefix: ro(str()),
  scopes: arr(str(), { description: '`resource:action` strings; a subset of the creator\'s permissions.' }),
  expires_at: ndt(),
  last_used_at: ro(ndt()),
  revoked_at: ro(ndt()),
  created_at: ro(dt()),
  created_by: ro(nuuid()),
}, ['id', 'name', 'key_prefix', 'scopes']);
S_.ApiKeyCreate = obj({ name: str({ minLength: 1, maxLength: 100 }), scopes: arr(str(), { minItems: 1 }), expires_at: ndt() }, ['name', 'scopes'], { additionalProperties: false });
S_.ApiKeyCreated = { allOf: [S('ApiKey'), obj({ secret: str({ description: 'The full key (`<prefix>.<secret>`). Shown **once**; only its hash is stored.' }) }, ['secret'])] };
S_.ApiKeyList = obj({ data: arr(S('ApiKey')), page: S('PageInfo') }, ['data', 'page']);

// ---------------------------------------------------------------- path builders
function addTagIfMissing() {}

function okResp(status, description, schema, { etag = false, location = false, replay = true, content } = {}) {
  const headers = { 'X-Request-Id': H('RequestId'), 'RateLimit-Limit': H('RateLimitLimit'), 'RateLimit-Remaining': H('RateLimitRemaining'), 'RateLimit-Reset': H('RateLimitReset') };
  if (etag) headers.ETag = H('ETag');
  if (location) headers.Location = H('Location');
  if (replay) headers['Idempotent-Replayed'] = H('IdempotentReplayed');
  const r = { description, headers };
  if (content) r.content = content;
  else if (schema) r.content = { 'application/json': { schema } };
  return r;
}

function addOp(path, method, o) {
  const {
    tag, id, summary, description, perm, params = [], body, success, mutate = method !== 'get',
    ifMatch = false, ifMatchOptional = false, idem = null, hasId = /\{/.test(path), anon = false, extraErrors = [], conflict = mutate,
    problems = {}, noAuthError = false, selfService = false, extensions = {},
  } = o;
  const parameters = [...params];
  if (mutate && !anon) {
    parameters.push(P('CsrfToken'));
    if (idem === 'required') parameters.push(P('IdempotencyKeyRequired'));
    else if (idem !== 'none') parameters.push(P('IdempotencyKey'));
  }
  if (ifMatch) parameters.push(P('IfMatch'));
  if (ifMatchOptional) parameters.push(P('IfMatchOptional'));
  const hasQuery = params.some((p) => p.in === 'query' || (p.$ref && /Cursor|Limit|Archived|Q$/.test(p.$ref)));
  const responses = { ...success };
  if (body || hasQuery) responses['400'] = R('BadRequest');
  if (!anon) { responses['401'] = R('Unauthorized'); responses['403'] = R('Forbidden'); }
  else { responses['401'] = R('Unauthorized'); }
  if (hasId) responses['404'] = R('NotFound');
  if (conflict) responses['409'] = R('Conflict');
  if (ifMatch) { responses['412'] = R('PreconditionFailed'); responses['428'] = R('PreconditionRequired'); }
  if (ifMatchOptional) responses['412'] = R('PreconditionFailed');
  if (body) responses['422'] = R('Unprocessable');
  for (const e of extraErrors) responses[String(e)] = R({ 404: 'NotFound', 409: 'Conflict', 422: 'Unprocessable' }[e]);
  responses['429'] = R('TooManyRequests');
  if (noAuthError) delete responses['401'];
  for (const [st, spec] of Object.entries(problems)) {
    const { codes, text } = Array.isArray(spec) ? { codes: spec } : spec;
    responses[st] = specificProblem(st, codes, text);
  }
  const operation = {
    tags: [tag],
    operationId: id,
    summary,
    description: [description, perm ? `Requires permission \`${perm}\`.` : null].filter(Boolean).join('\n\n'),
    ...(anon ? { security: [] } : {}),
    ...(perm ? { 'x-permission': perm } : {}),
    ...(selfService ? { 'x-self-service': true } : {}),
    ...extensions,
    parameters: parameters.length ? parameters : undefined,
    requestBody: body,
    responses: Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b))),
  };
  Object.keys(operation).forEach((k) => operation[k] === undefined && delete operation[k]);
  (doc.paths[path] ??= {})[method] = operation;
}

const THROTTLED = { codes: ['account-locked', 'too-many-requests'], text: 'Throttled: too many attempts for this account or IP (`account-locked`) or the general rate limit. See `Retry-After`.' };
const ANON = { 400: ['bad-request'], 422: ['validation'], 429: THROTTLED };
const qp = (name, schema, description) => ({ name, in: 'query', description, schema });
const arrQ = (name, itemSchema, description) => ({ name, in: 'query', description, style: 'form', explode: false, schema: arr(itemSchema) });
const sortParam = (fields, def) => ({
  name: 'sort', in: 'query', style: 'form', explode: false,
  description: `Comma-separated sort keys, \`-\` prefix = descending. Allowed: ${fields.join(', ')}. A unique tiebreaker (\`id\`) is always appended.`,
  schema: arr(en(fields.flatMap((f) => [f, `-${f}`])), { default: def }),
});
const listParams = (extra = [], { archived = true, q = true } = {}) => [P('Cursor'), P('Limit'), P('IncludeTotal'), ...(q ? [P('Q')] : []), ...(archived ? [P('Archived')] : []), ...extra];

const ID = P('Id');

// generic CRUD
function crud({ tag, base, name, plural, singular, permBase, readPerm, writePerm, filters = [], sorts, defSort, supportsQ = true, archivable = true, noDelete = false, createExtraErr = [] }) {
  const L = `/v1/${base}`;
  const I = `/v1/${base}/{id}`;
  addOp(L, 'get', {
    tag, id: `list${plural}`, summary: `List ${plural.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}`,
    description: 'Cursor-paginated list.', perm: readPerm,
    params: listParams([...filters, sortParam(sorts, defSort)], { archived: archivable, q: supportsQ }),
    success: { 200: okResp(200, 'A page of results.', S(`${name}List`), { replay: false }) },
  });
  addOp(L, 'post', {
    tag, id: `create${name}`, summary: `Create ${singular}`, perm: writePerm,
    body: jsonBody(S(`${name}Create`)),
    success: { 201: okResp(201, `${name} created.`, S(name), { etag: true, location: true }) },
    extraErrors: createExtraErr,
  });
  addOp(I, 'get', {
    tag, id: `get${name}`, summary: `Get ${singular}`, perm: readPerm, params: [ID],
    success: { 200: okResp(200, `The ${singular}.`, S(name), { etag: true, replay: false }) },
  });
  addOp(I, 'patch', {
    tag, id: `update${name}`, summary: `Update ${singular}`, perm: writePerm, params: [ID], ifMatch: true,
    body: jsonBody(S(`${name}Update`)),
    success: { 200: okResp(200, `Updated ${singular}.`, S(name), { etag: true }) },
  });
  if (!noDelete) {
    addOp(I, 'delete', {
      tag, id: `archive${name}`, summary: `Archive ${singular}`,
      description: 'Soft delete (`archived_at`). Fails with 409 while the record is still referenced by active records where that would break integrity.',
      perm: writePerm, params: [ID], ifMatch: true,
      success: { 204: okResp(204, 'Archived.') },
    });
  }
}

// ---------------------------------------------------------------- AUTH
addOp('/v1/auth/login', 'post', {
  tag: 'Auth', id: 'login', summary: 'Sign in with email and password', anon: true, mutate: true, idem: 'none', conflict: false,
  description: 'Creates a server-side session and sets the `__Host-at_session` cookie. If the account has MFA the response is `mfa_required` and no session is created until `POST /v1/auth/mfa/verify`. Throttled per email and per IP.',
  problems: { 401: { codes: ['invalid-credentials'], text: 'Wrong email or password (same answer for an unknown account).' }, 429: THROTTLED },
  body: jsonBody(S('LoginRequest'), true, { email: 'alice@example.org', password: 'correct horse battery staple' }),
  success: { 200: { description: 'Authenticated, or a next step is required.', headers: { 'Set-Cookie': H('SetCookie'), 'X-Request-Id': H('RequestId') }, content: { 'application/json': { schema: S('LoginResponse') } } } },
});
addOp('/v1/auth/mfa/verify', 'post', {
  tag: 'Auth', id: 'verifyMfa', summary: 'Complete an MFA challenge', anon: true, mutate: true, idem: 'none', conflict: false,
  description: 'Exchanges a pending MFA challenge for a session (TOTP, WebAuthn/passkey or a one-time recovery code).',
  problems: { 401: { codes: ['mfa-invalid-code', 'mfa-challenge-expired'], text: 'The code is wrong (also: a TOTP code replayed inside its window) or the challenge is gone.' }, 429: THROTTLED },
  body: jsonBody(S('MfaVerifyRequest')),
  success: { 200: { description: 'Session created.', headers: { 'Set-Cookie': H('SetCookie'), 'X-Request-Id': H('RequestId') }, content: { 'application/json': { schema: S('LoginResponse') } } } },
});
addOp('/v1/auth/logout', 'post', {
  tag: 'Auth', id: 'logout', summary: 'Sign out', idem: 'none', conflict: false, hasId: false,
  description: 'Revokes the current session and clears the cookie. For API keys this is a no-op `204`.',
  success: { 204: okResp(204, 'Signed out.', null, { replay: false }) },
});
addOp('/v1/auth/me', 'get', {
  tag: 'Auth', id: 'getMe', summary: 'Current principal', hasId: false,
  description: 'The authenticated user (or the user that owns the API key), tenant (with branding), effective permissions and role scopes, plus, for cookie sessions, the session lifetime (`session`) and whether the user must still enrol in MFA (`mfa_enrolment_required`). This is one of the few endpoints that still works on a *limited* session (MFA enrolment pending), so the web app calls it first to decide where to route.',
  problems: { 401: { codes: ['unauthorized', 'session-expired'], text: 'No session, or it expired or was revoked.' } },
  success: { 200: okResp(200, 'The principal.', S('Me'), { replay: false }) },
});

// ---- password policy, reset, invitations (unauthenticated)
addOp('/v1/auth/password-policy', 'get', {
  tag: 'Auth', id: 'getPasswordPolicy', summary: 'Password policy', anon: true, noAuthError: true, hasId: false,
  description: 'Public. The rules the server enforces for new passwords (minimum 12, maximum 128, breached-password check), so clients and forms do not hardcode them. The values can differ per deployment (self-hosted operators may enable the online breach provider).',
  problems: { 429: THROTTLED },
  success: { 200: okResp(200, 'The policy.', S('PasswordPolicy'), { replay: false }) },
});
addOp('/v1/auth/password/forgot', 'post', {
  tag: 'Auth', id: 'forgotPassword', summary: 'Request a password-reset email', anon: true, noAuthError: true, mutate: true, idem: 'none', conflict: false, hasId: false,
  description: 'Always answers `202`, whether or not an account exists for the email, so it cannot be used to discover accounts; the response time does not depend on it either. If an active account matches, a single-use reset link (token stored hashed, short expiry) is emailed. Throttled per IP and per email. `422` only for a malformed email.',
  body: jsonBody(S('ForgotPasswordRequest'), true, { email: 'alice@example.org' }),
  problems: ANON,
  success: { 202: okResp(202, 'Accepted. If the account exists an email is on its way.', null, { replay: false }) },
});
addOp('/v1/auth/password/reset', 'post', {
  tag: 'Auth', id: 'resetPassword', summary: 'Set a new password with a reset token', anon: true, noAuthError: true, mutate: true, idem: 'none', conflict: false, hasId: false,
  description: 'Consumes a single-use reset token and sets the new password (policy: see `PasswordPolicy` and `GET /v1/auth/password-policy`). On success **every session of the user is revoked** and no session is created: the user signs in again. Failure modes: `404 token-invalid` (unknown or already used), `410 token-expired`, `422` with `errors[]` at pointer `/password` (code `too-short`, `too-long` or `breached`); a rejected password does not consume the token.',
  body: jsonBody(S('ResetPasswordRequest')),
  problems: { ...ANON, 404: { codes: ['token-invalid'], text: 'The reset token is unknown or was already used.' }, 410: { codes: ['token-expired'], text: 'The reset token has expired; request a new link.' }, 422: { codes: ['validation'], text: 'Password rejected: `errors[]` pointer `/password`, code `too-short`, `too-long` or `breached`.' } },
  success: { 204: okResp(204, 'Password changed; all sessions revoked.', null, { replay: false }) },
});
addOp('/v1/auth/invitations/{token}', 'get', {
  tag: 'Auth', id: 'getInvitation', summary: 'Look up an invitation', anon: true, noAuthError: true,
  description: 'Shows what an invitation link is for, before the invitee chooses a password. Does not consume the token. Throttled per IP.',
  params: [{ name: 'token', in: 'path', required: true, description: 'Invitation token from the email link.', schema: str({ minLength: 16, maxLength: 256 }) }],
  problems: { 404: { codes: ['invitation-not-found'], text: 'Unknown token, or the invitation was already accepted or revoked.' }, 410: { codes: ['invitation-expired'], text: 'The invitation expired; an administrator can resend it.' }, 429: THROTTLED },
  success: { 200: okResp(200, 'The invitation.', S('InvitationInfo'), { replay: false }) },
});
addOp('/v1/auth/invitations/accept', 'post', {
  tag: 'Auth', id: 'acceptInvitation', summary: 'Accept an invitation and set a password', anon: true, noAuthError: true, mutate: true, idem: 'none', conflict: false, hasId: false,
  description: 'Consumes the single-use invitation token, activates the account with the chosen password and display name, and signs the user in (cookie + `csrf_token`, same as login, `status` is `authenticated`). If the tenant requires MFA for the role (`InvitationInfo.mfa_enrolment_required`) the new session is *limited* until MFA enrolment is confirmed (`Me.mfa_enrolment_required`). A rejected password does not consume the token.',
  body: jsonBody(S('AcceptInvitationRequest')),
  problems: { ...ANON, 404: { codes: ['invitation-not-found'], text: 'Unknown token, or the invitation was already accepted or revoked.' }, 410: { codes: ['invitation-expired'], text: 'The invitation expired; an administrator can resend it.' }, 422: { codes: ['validation'], text: 'Password rejected: `errors[]` pointer `/password`, code `too-short`, `too-long` or `breached`.' } },
  success: { 200: { description: 'Account activated and signed in.', headers: { 'Set-Cookie': H('SetCookie'), 'X-Request-Id': H('RequestId') }, content: { 'application/json': { schema: S('LoginResponse') } } } },
});

// ---- MFA (TOTP) self-service
const SELF_403 = { codes: ['forbidden', 'csrf-invalid'], text: 'Needs a browser session (not an API key) with a valid `X-CSRF-Token`.' };
const SECRET_NOTE = ' The response contains secrets and is never stored for idempotent replay, so no `Idempotency-Key` is accepted.';
addOp('/v1/auth/mfa/enrol', 'post', {
  tag: 'Auth', id: 'startMfaEnrolment', summary: 'Start TOTP enrolment', selfService: true, idem: 'none', hasId: false,
  description: 'Creates a pending TOTP factor (secret stored envelope-encrypted) and returns the secret and the `otpauth://` URI for the QR code. Works on a *limited* session (MFA enrolment pending). Not active until `POST /v1/auth/mfa/enrol/confirm`; calling it again replaces the pending secret.' + SECRET_NOTE,
  problems: { 403: SELF_403, 409: { codes: ['mfa-already-enrolled'], text: 'A TOTP factor is already active; disable it first.' } },
  success: { 200: okResp(200, 'Pending factor.', S('MfaEnrolment'), { replay: false }) },
});
addOp('/v1/auth/mfa/enrol/confirm', 'post', {
  tag: 'Auth', id: 'confirmMfaEnrolment', summary: 'Confirm TOTP enrolment', selfService: true, idem: 'none', hasId: false,
  description: 'Verify-then-activate: a valid current code activates the factor, generates ten single-use recovery codes (stored hashed) and returns them **once**. If the session was limited it becomes a full session and `mfa_verified` is true. The session id is rotated (new cookie) and the response carries the new `csrf_token`. Works on a limited session. Attempts are throttled.' + SECRET_NOTE,
  body: jsonBody(S('MfaConfirmRequest')),
  problems: { 403: SELF_403, 409: { codes: ['conflict', 'mfa-already-enrolled'], text: 'No enrolment is pending (call enrol first) or a factor is already active.' }, 422: { codes: ['mfa-invalid-code', 'validation'], text: 'The code does not match. `errors[]` pointer `/code`.' }, 429: THROTTLED },
  success: { 200: okResp(200, 'Factor active; recovery codes and the new CSRF token.', S('MfaEnrolmentConfirmed'), { replay: false }) },
});
addOp('/v1/auth/mfa/recovery-codes/regenerate', 'post', {
  tag: 'Auth', id: 'regenerateRecoveryCodes', summary: 'Regenerate recovery codes', selfService: true, idem: 'none', hasId: false,
  description: 'Replaces all recovery codes with ten new ones (the old ones stop working) and returns them once. Requires recent re-authentication: the current password or a current TOTP code in the body.' + SECRET_NOTE,
  body: jsonBody(S('ReauthRequest')),
  problems: { 403: { codes: ['forbidden', 'csrf-invalid', 'reauth-failed'], text: 'Not a browser session, bad CSRF token, or the re-authentication value is wrong.' }, 409: { codes: ['conflict'], text: 'MFA is not enabled for this user.' }, 422: { codes: ['validation'], text: 'Neither `password` nor `totp_code` was sent.' }, 429: THROTTLED },
  success: { 200: okResp(200, 'New recovery codes.', S('MfaRecoveryCodes'), { replay: false }) },
});
addOp('/v1/auth/mfa', 'delete', {
  tag: 'Auth', id: 'disableMfa', summary: 'Disable MFA', selfService: true, hasId: false,
  description: "Removes the user's own TOTP factor and recovery codes. Requires re-authentication (password or current TOTP code in the body) and revokes all the user's **other** sessions. Forbidden while tenant policy enforces MFA for this user (`403 mfa-required-by-policy`); an administrator can reset a lost factor with `DELETE /v1/users/{id}/mfa`.",
  body: jsonBody(S('ReauthRequest')),
  problems: { 403: { codes: ['mfa-required-by-policy', 'reauth-failed', 'forbidden', 'csrf-invalid'], text: 'Tenant policy enforces MFA for this user, the re-authentication value is wrong, or the request is not a valid browser-session mutation.' }, 409: { codes: ['conflict'], text: 'MFA is not enabled for this user.' }, 422: { codes: ['validation'], text: 'Neither `password` nor `totp_code` was sent.' }, 429: THROTTLED },
  success: { 204: okResp(204, 'MFA disabled.') },
});

// ---- browser sessions (devices)
addOp('/v1/auth/sessions', 'get', {
  tag: 'Auth', id: 'listMySessions', summary: 'List my active sessions', selfService: true, hasId: false,
  description: "The caller's unrevoked, unexpired browser sessions (devices), newest activity first, with the current one flagged. Not paginated (a user has few live sessions).",
  problems: { 403: { codes: ['forbidden'], text: 'Needs a browser session, not an API key.' } },
  success: { 200: okResp(200, 'Active sessions.', S('SessionInfoList'), { replay: false }) },
});
addOp('/v1/auth/sessions', 'delete', {
  tag: 'Auth', id: 'revokeOtherSessions', summary: 'Sign out everywhere else', selfService: true, hasId: false,
  description: 'Revokes every session of the caller except the current one. Revoked sessions fail on their next request with `401 session-expired`.',
  problems: { 403: SELF_403 },
  success: { 204: okResp(204, 'Other sessions revoked.') },
});
addOp('/v1/auth/sessions/{id}', 'delete', {
  tag: 'Auth', id: 'revokeMySession', summary: 'Revoke one of my sessions', selfService: true, params: [ID],
  description: "Revokes one of the caller's own sessions. The current session cannot be revoked here (use `POST /v1/auth/logout`). An unknown id, or one that belongs to another user, is `404`.",
  problems: { 403: SELF_403, 404: ['not-found'], 409: { codes: ['cannot-revoke-current'], text: 'That is the current session; use sign out.' } },
  success: { 204: okResp(204, 'Revoked.') },
});

// ---------------------------------------------------------------- SEARCH
addOp('/v1/search', 'get', {
  tag: 'Search', id: 'search', summary: 'Search across the registry', perm: 'search:read', hasId: false,
  description: "One box, several entity types. Results are filtered by the caller's permissions *per type* (and by location scope): a type the caller may not read is silently left out, never a `403`. `search:read` is granted to every built-in role; the per-type permissions are in `x-permission-by-type`.\n\n**Availability:** `asset`, `model`, `category`, `person` (name, email, employee number) and `location` (name, code) results. Matching is a case-insensitive prefix / trigram match on tag, serial, name and code. Archived records are excluded.",
  params: [
    { name: 'q', in: 'query', required: true, description: 'Search text (1-200 characters).', schema: str({ minLength: 1, maxLength: 200 }) },
    arrQ('types', en(['asset', 'model', 'category', 'person', 'location']), 'Comma-separated entity types to search. Default: every type available in this release.'),
    { name: 'limit', in: 'query', description: 'Maximum results **per type**.', schema: int({ minimum: 1, maximum: 50, default: 5 }) },
  ],
  extensions: { 'x-permission-by-type': { asset: 'asset:read', model: 'catalog:read', category: 'catalog:read', person: 'person:read', location: 'location:read' } },
  success: { 200: okResp(200, 'Grouped results (empty array when nothing matches).', S('SearchResultList'), { replay: false }) },
});

// ---------------------------------------------------------------- ACCESS
addOp('/v1/users', 'get', {
  tag: 'Access', id: 'listUsers', summary: 'List users', perm: 'user:read',
  params: listParams([qp('status', en(['invited', 'active', 'disabled']), 'Filter by status.'), qp('role_id', uuid(), 'Users holding this role.'), sortParam(['display_name', 'email', 'created_at', 'last_login_at'], ['display_name'])]),
  success: { 200: okResp(200, 'A page of users.', S('UserList'), { replay: false }) },
});
addOp('/v1/users', 'post', {
  tag: 'Access', id: 'createUser', summary: 'Create or invite a user', perm: 'user:manage',
  description: 'Creates an account in status `invited` and (with `send_invite`) emails a single-use invitation link. A matching `Person` record is created automatically.',
  body: jsonBody(S('UserCreate')),
  success: { 201: okResp(201, 'User created.', S('User'), { etag: true, location: true }) },
});
addOp('/v1/users/{id}', 'get', { tag: 'Access', id: 'getUser', summary: 'Get a user', perm: 'user:read', params: [ID], success: { 200: okResp(200, 'The user.', S('User'), { etag: true, replay: false }) } });
addOp('/v1/users/{id}', 'patch', {
  tag: 'Access', id: 'updateUser', summary: 'Update a user and role assignments', perm: 'user:manage', params: [ID], ifMatch: true,
  description: '`role_assignments`, when present, replaces the full set. The last active `tenant_admin` cannot be removed or disabled (409).',
  body: jsonBody(S('UserUpdate')),
  success: { 200: okResp(200, 'Updated user.', S('User'), { etag: true }) },
});
addOp('/v1/users/{id}', 'delete', {
  tag: 'Access', id: 'archiveUser', summary: 'Disable and archive a user', perm: 'user:manage', params: [ID], ifMatch: true,
  description: 'Revokes all sessions, disables login and archives the account; the linked `Person` and the audit trail are kept.',
  success: { 204: okResp(204, 'Archived.') },
});
addOp('/v1/users/{id}/invitation/resend', 'post', {
  tag: 'Access', id: 'resendUserInvitation', summary: "Resend a user's invitation", perm: 'user:manage', params: [ID],
  description: 'For a user still in status `invited`: invalidates the previous link, issues a fresh single-use token with a new expiry and emails it. Also the way to recover from `410 invitation-expired`. `409 conflict` if the user has no pending or expired invitation (already active or disabled).',
  success: { 204: okResp(204, 'New invitation sent.') },
});
addOp('/v1/users/{id}/invitation', 'delete', {
  tag: 'Access', id: 'revokeUserInvitation', summary: "Revoke a user's pending invitation", perm: 'user:manage', params: [ID],
  description: 'Marks the invitation `revoked` (the link then answers `404 invitation-not-found`) and archives the never-activated account. `409 conflict` if the user already accepted. The action is audited.',
  success: { 204: okResp(204, 'Invitation revoked.') },
});
addOp('/v1/users/{id}/sessions', 'get', {
  tag: 'Access', id: 'listUserSessions', summary: "List a user's active sessions", perm: 'user:manage', params: [ID],
  description: 'Administrator view of the same device list as `GET /v1/auth/sessions` (`current` is always false). Not paginated.',
  success: { 200: okResp(200, 'Active sessions.', S('SessionInfoList'), { replay: false }) },
});
addOp('/v1/users/{id}/sessions/{session_id}', 'delete', {
  tag: 'Access', id: 'revokeUserSession', summary: 'Revoke one session of a user', perm: 'user:manage',
  params: [ID, { name: 'session_id', in: 'path', required: true, description: 'Session id.', schema: uuid() }],
  description: "Revokes a single session of another user (the user's whole set is also revoked by role change, deactivation and password reset). Audited.",
  success: { 204: okResp(204, 'Revoked.') },
});
addOp('/v1/users/{id}/mfa', 'delete', {
  tag: 'Access', id: 'resetUserMfa', summary: "Reset a user's MFA", perm: 'user:manage', params: [ID],
  description: 'For a user who lost their device and recovery codes: removes all MFA factors and recovery codes and revokes all their sessions. If tenant policy requires MFA the user must enrol again at the next sign-in. You cannot reset your own MFA this way (`409 conflict`; use `DELETE /v1/auth/mfa`). Audited.',
  success: { 204: okResp(204, 'MFA reset.') },
});
// ================================================================ [M2-USR-04] role assignments, one at a time (ED-27)
addOp('/v1/users/{id}/role-assignments', 'post', {
  tag: 'Access', id: 'addUserRoleAssignment', summary: 'Add a role assignment to a user', perm: 'user:manage', params: [ID], ifMatch: true,
  description: 'Adds ONE role assignment (a role for the whole organisation, or limited to a location subtree with `scope_type=location` and `location_id`, ED-26) to the user and returns the updated user with its new `ETag`. The rules of `PATCH /v1/users/{id}` apply: nobody grants a role with permissions they lack or wider than they hold them (`403`), a location-scoped assignment never grants the org-only permissions, an unknown or archived role or location is `422` (`/role_id`, `/location_id`). `409 conflict` when the user already holds the same role with the same scope or already has 20 assignments. The target\'s sessions are revoked (yours stays when you edit yourself) and the change is audited (`user.role_assigned`).',
  body: jsonBody(S('RoleAssignment')),
  success: { 201: okResp(201, 'The user with the new assignment.', S('User'), { etag: true }) },
});
addOp('/v1/users/{id}/role-assignments/{assignment_id}', 'delete', {
  tag: 'Access', id: 'removeUserRoleAssignment', summary: 'Remove a role assignment of a user', perm: 'user:manage', ifMatch: true,
  params: [ID, { name: 'assignment_id', in: 'path', required: true, description: 'Id of a role assignment of this user (`User.role_assignments[].id`).', schema: uuid() }],
  description: 'Removes ONE role assignment and returns the updated user with its new `ETag`. `404` for an assignment that is not this user\'s. `409 conflict` (the user is unchanged) when it is the user\'s only assignment (add another first, or disable or archive the user), when it is the assignment that makes the last active administrator an administrator, or when it would remove your own last administrator access (`user:manage` for the whole organisation). The target\'s sessions are revoked (yours stays when you edit yourself) and the change is audited (`user.role_removed`).',
  success: { 200: okResp(200, 'The user without the assignment.', S('User'), { etag: true }) },
});
// ================================================================ [M2-USR-04] END
addOp('/v1/roles', 'get', { tag: 'Access', id: 'listRoles', summary: 'List roles', perm: 'role:read', hasId: false, description: 'Built-in roles in the MVP (custom roles arrive in v2).', success: { 200: okResp(200, 'All roles of the tenant.', S('RoleList'), { replay: false }) } });
addOp('/v1/companies', 'get', { tag: 'Access', id: 'listCompanies', summary: 'List companies', perm: 'company:read', hasId: false, description: 'Every tenant has a default company; multi-company management UI arrives in v2.', success: { 200: okResp(200, 'All companies of the tenant.', S('CompanyList'), { replay: false }) } });
addOp('/v1/api-keys', 'get', {
  tag: 'Access', id: 'listApiKeys', summary: 'List API keys', perm: 'apikey:manage', params: listParams([], { q: false, archived: false }),
  success: { 200: okResp(200, 'A page of API keys (secrets are never returned).', S('ApiKeyList'), { replay: false }) },
});
addOp('/v1/api-keys', 'post', {
  tag: 'Access', id: 'createApiKey', summary: 'Create an API key', perm: 'apikey:manage',
  description: 'The secret is returned **once** in this response. Scopes must be a subset of the caller\'s own permissions.',
  body: jsonBody(S('ApiKeyCreate')),
  success: { 201: okResp(201, 'Key created.', S('ApiKeyCreated'), { location: true }) },
});
addOp('/v1/api-keys/{id}', 'delete', {
  tag: 'Access', id: 'revokeApiKey', summary: 'Revoke an API key', perm: 'apikey:manage', params: [ID], idem: 'optional',
  description: 'Immediately revokes the key (removes it from the pre-auth lookup).',
  success: { 204: okResp(204, 'Revoked.') },
});

// ---------------------------------------------------------------- CATALOGUE
crud({
  tag: 'Categories', base: 'categories', name: 'Category', plural: 'Categories', singular: 'category', readPerm: 'catalog:read', writePerm: 'catalog:manage',
  filters: [qp('kind', en(['asset', 'accessory', 'consumable', 'component', 'license']), 'Filter by kind.')], sorts: ['name', 'created_at'], defSort: ['name'],
});
crud({ tag: 'Manufacturers', base: 'manufacturers', name: 'Manufacturer', plural: 'Manufacturers', singular: 'manufacturer', readPerm: 'catalog:read', writePerm: 'catalog:manage', sorts: ['name', 'created_at'], defSort: ['name'] });
crud({ tag: 'Vendors', base: 'vendors', name: 'Vendor', plural: 'Vendors', singular: 'vendor', readPerm: 'catalog:read', writePerm: 'catalog:manage', sorts: ['name', 'created_at'], defSort: ['name'] });
crud({
  tag: 'Models', base: 'models', name: 'AssetModel', plural: 'Models', singular: 'asset model', readPerm: 'catalog:read', writePerm: 'catalog:manage',
  filters: [qp('category_id', uuid(), 'Filter by category.'), qp('manufacturer_id', uuid(), 'Filter by manufacturer.')], sorts: ['name', 'created_at'], defSort: ['name'],
});
crud({
  tag: 'Status labels', base: 'status-labels', name: 'StatusLabel', plural: 'StatusLabels', singular: 'status label', readPerm: 'catalog:read', writePerm: 'catalog:manage',
  filters: [arrQ('state_type', en(['deployable', 'deployed', 'pending', 'undeployable', 'archived', 'lost']), 'Filter by state type.')], sorts: ['position', 'name'], defSort: ['position'], supportsQ: false,
});
crud({
  tag: 'Custom fields', base: 'custom-fields', name: 'CustomFieldDef', plural: 'CustomFields', singular: 'custom field definition', readPerm: 'catalog:read', writePerm: 'catalog:manage',
  filters: [qp('category_id', uuid(), 'Fields applying to this category (including fields that apply to all categories).')], sorts: ['position', 'key', 'created_at'], defSort: ['position'],
});

// ---------------------------------------------------------------- LOCATIONS / PEOPLE
crud({
  tag: 'Locations', base: 'locations', name: 'Location', plural: 'Locations', singular: 'location', readPerm: 'location:read', writePerm: 'location:manage',
  filters: [
    qp('parent_id', uuid(), 'Direct children of this location.'),
    qp('root', bool(), 'Only root locations.'),
    qp('descendants_of', uuid(), 'All locations in the subtree below this location.'),
    arrQ('kind', en(['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other']), 'Filter by kind.'),
    qp('company_id', uuid(), 'Filter by company.'),
  ],
  sorts: ['name', 'depth', 'created_at'], defSort: ['name'],
});
// [M2-W1] Location rules (M2-LOC-01): descriptions of the generic CRUD operations
doc.paths['/v1/locations'].post.description = 'Creates a location under `parent_id` (a root when null). The name must be unique among the live children of the same parent (409 `conflict`, pointer `/name`); the hierarchy is at most ten levels deep (422, pointer `/parent_id`). Requires permission `location:manage`.';
doc.paths['/v1/locations/{id}'].patch.description = 'Merge semantics. Changing `parent_id` **moves the whole subtree** (every descendant\'s `ancestor_ids` and `depth` are rewritten in the same transaction). Moving a location under itself or one of its descendants is 422 (pointer `/parent_id`, code `cycle`), as is exceeding the depth limit or an archived parent. Requires permission `location:manage`.';
doc.paths['/v1/locations/{id}'].delete.description = 'Soft delete. Refused with `409 conflict` and `usage` (`children`, `assets`, `people`, `open_assignments`: how many live records still reference the location) while anything is located here or below it. Requires permission `location:manage`.';
crud({
  tag: 'People', base: 'people', name: 'Person', plural: 'People', singular: 'person', readPerm: 'person:read', writePerm: 'person:manage',
  filters: [arrQ('kind', en(['employee', 'student', 'contractor', 'external']), 'Filter by kind.'), qp('status', en(['active', 'inactive']), 'Filter by status.'), qp('department_id', uuid(), '[ED-17] People of this department.'), qp('location_id', uuid(), 'Home location.'), qp('employee_ref', str(), 'Exact employee / student number.'), qp('has_login', bool(), 'Only people with (true) or without (false) a login account.')],
  sorts: ['display_name', 'created_at', 'employee_ref'], defSort: ['display_name'],
});
// [M2-W1] People rules (M2-USR-01)
doc.paths['/v1/people'].post.description = 'Creates an assignable person (no login). `email` and `employee_ref` are unique per tenant among live people (409 `conflict`). A login account (`POST /v1/users`) gets its person automatically; a person created here with the same email is linked to the account when it is created. People never receive login emails. Requires permission `person:manage`.';
doc.paths['/v1/people/{id}'].patch.description = 'Merge semantics. Setting `status: "inactive"` while the person still holds assets is `409 conflict` with `usage.open_assignments`, unless `force: true` and a `reason` are sent (the reason lands in the audit trail; the custody stays open). An inactive person cannot receive new check-outs. Requires permission `person:manage`.';
doc.paths['/v1/people/{id}'].delete.description = 'Soft delete. `409 conflict` with `usage.open_assignments` while the person still holds assets, and for a person linked to a login account (archive the account first). Requires permission `person:manage`.';
// [M2-USR-03] BEGIN - link and unlink a person and a login account (ED-22)
S_.PersonLinkUserRequest = obj({ user_id: uuid('The login account (`User.id`) to link: live, in this tenant.') }, ['user_id'], { additionalProperties: false });
addOp('/v1/people/{id}/link-user', 'post', {
  tag: 'People', id: 'linkPersonToUser', summary: 'Link a person to a login account', perm: 'user:manage', params: [ID], ifMatchOptional: true,
  description: 'Makes the person the person record of the login account (Administrators only, audited as `person.user_linked`). Every login account already has the person the database created for it, so linking **replaces** that placeholder: it is archived (never deleted; its history keeps pointing at it) and a department it headed is headed by the linked person. The linked person keeps all of its assignments and history. One person per login and one login per person: a person that already has a login is 409 `person-already-linked`, a login whose person was chosen by somebody (not the system-made placeholder, which has no `created_by`) is 409 `login-already-linked` (unlink it first), a placeholder that still holds assets is 409 `login-person-in-use` (`usage.open_assignments`). Linking the pair that is already linked changes nothing (200). 422 `/user_id` when the account does not exist in the tenant or is archived. The person\'s name and email are not changed, but a later rename of the login account renames the person again (ED-15).',
  body: jsonBody(S('PersonLinkUserRequest'), true, { user_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d92' }),
  problems: { 409: { codes: ['person-already-linked', 'login-already-linked', 'login-person-in-use', 'conflict', 'idempotency-key-in-flight'], text: 'The person already has a login, the login already has a chosen person, or the login\'s own placeholder person still holds assets.' } },
  success: { 200: okResp(200, 'Linked. The person (`user_id` set); `ETag` is its new version.', S('Person'), { etag: true }) },
});
addOp('/v1/people/{id}/link-user', 'delete', {
  tag: 'People', id: 'unlinkPersonFromUser', summary: 'Unlink a person from its login account', perm: 'user:manage', params: [ID], ifMatchOptional: true,
  description: 'Removes the login from the person (Administrators only, audited as `person.user_unlinked`). The person stays with all its assignments and history, as a person without a login. The login account keeps exactly one person (ED-15): a new one is created from its name and email (the email is left empty while a live person uses it, which is the case right after this call; `GET /v1/users/{id}` gives its `person_id`). 409 `conflict` when the person has no login, and when the person is the login\'s own automatic record (`is_login_placeholder`, ED-33): there is nothing to unlink, and unlinking it would only make another empty record with the same name. The login account is not changed, disabled or signed out.',
  problems: { 409: { codes: ['conflict', 'idempotency-key-in-flight'], text: 'The person has no login account to unlink, or is the login\'s own automatic record.' } },
  success: { 200: okResp(200, 'Unlinked. The person (`user_id` null); `ETag` is its new version.', S('Person'), { etag: true }) },
});
// [M2-USR-03] END
// [DEPT] BEGIN - departments (ED-17)
crud({
  tag: 'Departments', base: 'departments', name: 'Department', plural: 'Departments', singular: 'department', readPerm: 'department:read', writePerm: 'department:manage',
  sorts: ['name', 'code', 'created_at'], defSort: ['name'],
});
doc.paths['/v1/departments'].get.description = 'Cursor-paginated list. `q` matches the name and the code (case-insensitive). Every row carries `person_count` and `asset_count` (live people / assets), so the settings page needs one call.';
doc.paths['/v1/departments'].post.description = 'Creates a department. The name (and the code, when set) must be unique among live departments, ignoring case (409 `conflict`, pointer `/name` or `/code`). The manager must be a live person (422).';
doc.paths['/v1/departments/{id}'].patch.description = 'Merge semantics. Renaming keeps every person and asset linked: they reference the id.';
doc.paths['/v1/departments/{id}'].delete.description = 'Soft delete. While live people or assets still reference the department the answer is `409 conflict` with `usage` (`people`, `assets`), unless `reassign_to` names another live department: then every person and asset (archived ones included) moves there in the same transaction and the department is archived (this is how two departments are merged). The move is recorded in the audit entry (`meta.reassigned_to`, `people`, `assets`).';
doc.paths['/v1/departments/{id}'].delete.parameters.push(qp('reassign_to', uuid(), 'Move the people and assets of this department to that department before archiving (merge). Must be another live department (422 on `query:reassign_to` otherwise).'));
doc.paths['/v1/departments/{id}'].delete.responses['400'] = R('BadRequest');
doc.paths['/v1/departments/{id}'].delete.responses['422'] = R('Unprocessable');
doc.paths['/v1/departments/{id}'].delete.responses = Object.fromEntries(Object.entries(doc.paths['/v1/departments/{id}'].delete.responses).sort(([a], [b]) => a.localeCompare(b)));
// [DEPT] END
addOp('/v1/people/{id}/assignments', 'get', {
  tag: 'People', id: 'listPersonAssignments', summary: 'What is checked out to a person', perm: 'person:read',
  description: 'Assignments (assets and accessories) targeting this person; defaults to open ones, which is the offboarding checklist.',
  params: [ID, P('Cursor'), P('Limit'), qp('state', en(['open', 'closed', 'all']), 'Defaults to `open`.')],
  success: { 200: okResp(200, 'A page of assignments.', S('AssignmentList'), { replay: false }) },
});

// ---------------------------------------------------------------- ASSETS
const assetFilters = [
  qp('tag', str(), 'Exact asset tag (case-insensitive) - the barcode scan path.'),
  qp('serial', str(), 'Exact serial number.'),
  arrQ('status_id', uuid(), 'Any of these status labels.'),
  arrQ('state_type', en(['deployable', 'deployed', 'pending', 'undeployable', 'archived', 'lost']), 'Any of these state types.'),
  arrQ('category_id', uuid(), 'Any of these categories.'),
  arrQ('model_id', uuid(), 'Any of these models.'),
  qp('manufacturer_id', uuid(), 'Via the model.'),
  qp('location_id', uuid(), 'Assets at this location.'),
  qp('department_id', uuid(), '[ED-17] Assets of this department.'),
  qp('include_sublocations', bool({ default: true }), 'With `location_id`: include the whole subtree.'),
  qp('company_id', uuid(), 'Filter by company.'),
  qp('vendor_id', uuid(), 'Filter by vendor.'),
  qp('parent_asset_id', uuid(), 'Children of this asset.'),
  qp('assigned_person_id', uuid(), 'Currently checked out to this person.'),
  qp('assigned', bool(), 'true = checked out, false = in stock.'),
  qp('overdue', bool(), '[M2-W1] true = checked out with an `expected_return` before today (UTC); false = every other asset.'),
  qp('loaner_pool_id', uuid(), '[LOAN] Members of this loaner pool (ED-20).'),
  qp('in_loaner_pool', bool(), '[LOAN] true = member of any loaner pool, false = in none.'),
  qp('import_job_id', uuid(), '[ED-38] The assets this import created (its rows with result `created`). Matches nothing once the import\'s rows are purged (ED-25).'),
  qp('warranty_end_before', date(), 'Warranty ends on or before.'),
  qp('warranty_end_after', date(), 'Warranty ends on or after.'),
  qp('purchase_date_from', date(), 'Purchased on or after.'),
  qp('purchase_date_to', date(), 'Purchased on or before.'),
  qp('updated_since', dt(), 'Changed at or after (incremental sync).'),
  { name: 'cf', in: 'query', style: 'deepObject', explode: true, description: 'Custom field filters, e.g. `cf[warranty_tier]=gold`. Exact match on the JSONB value.', schema: { type: 'object', additionalProperties: str() } },
  arrQ('expand', en(['model', 'category', 'location', 'vendor', 'department']), 'Embed related objects under `expanded`.'),
  arrQ('fields', str(), 'Sparse fieldset: return only these top-level properties (`id` is always included).'),
];
addOp('/v1/assets', 'get', {
  tag: 'Assets', id: 'listAssets', summary: 'List and search assets', perm: 'asset:read',
  description: 'The main registry query. `q` searches tag, serial and name (trigram); `tag` / `serial` are exact. Soft-deleted assets are excluded unless `archived` says otherwise.\n\n[M2-REG-03, ED-22] `sort` also takes `location` (the full location path, `HQ > Floor 2 > Room 4`, case-insensitive), `assignee` (the name of whoever holds the asset: person, location or asset tag, case-insensitive) and `due` (the expected return date of the open custody). For these three keys an asset with no value (no location, not checked out, no expected return) is listed **last in both directions**, ordered by `id` among themselves, so a page boundary never splits or repeats rows. The other keys keep sorting an empty value as the smallest. Cursors are bound to the sort: a cursor of another sort is 400 `invalid-cursor`.',
  params: listParams([...assetFilters, sortParam(['created_at', 'updated_at', 'asset_tag', 'name', 'purchase_date', 'warranty_end', 'location', 'assignee', 'due'], ['-created_at'])]),
  success: { 200: okResp(200, 'A page of assets.', S('AssetList'), { replay: false }) },
});
addOp('/v1/assets', 'post', {
  tag: 'Assets', id: 'createAsset', summary: 'Create an asset', perm: 'asset:create',
  description: 'Writes the asset, a `created` history event, an audit record and an outbox event in one transaction. `custom_data` is validated against the category\'s custom field definitions.',
  body: jsonBody(S('AssetCreate'), true, { asset_tag: 'LAP-00042', name: 'Dana\'s laptop', serial: 'C02XK1ABCD', category_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d90', model_id: null, custom_data: { warranty_tier: 'gold' } }),
  success: { 201: okResp(201, 'Asset created.', S('Asset'), { etag: true, location: true }) },
});
addOp('/v1/assets/{id}', 'get', {
  tag: 'Assets', id: 'getAsset', summary: 'Get an asset', perm: 'asset:read',
  params: [ID, arrQ('expand', en(['model', 'category', 'location', 'vendor', 'department']), 'Embed related objects under `expanded`.')],
  success: { 200: okResp(200, 'The asset.', S('Asset'), { etag: true, replay: false }) },
});
addOp('/v1/assets/{id}', 'patch', {
  tag: 'Assets', id: 'updateAsset', summary: 'Update an asset', perm: 'asset:update', params: [ID], ifMatch: true,
  description: 'Merge semantics. Status and location changes are recorded as history events. Custody changes must use check-out / check-in / transfer, not this endpoint.',
  body: jsonBody(S('AssetUpdate')),
  success: { 200: okResp(200, 'Updated asset.', S('Asset'), { etag: true }) },
});
addOp('/v1/assets/{id}', 'delete', {
  tag: 'Assets', id: 'archiveAsset', summary: 'Archive an asset', perm: 'asset:delete', params: [ID], ifMatch: true,
  description: 'Soft delete. Rejected with 409 while the asset is checked out or has an open repair. Disposal/retirement is a status change, not a delete.',
  success: { 204: okResp(204, 'Archived.') },
});
addOp('/v1/assets/{id}/restore', 'post', {
  tag: 'Assets', id: 'restoreAsset', summary: 'Restore an archived asset', perm: 'asset:delete', params: [ID], ifMatch: true,
  success: { 200: okResp(200, 'Restored asset.', S('Asset'), { etag: true }) },
});
// Public probes (no credential, not rate limited). `/healthz` and `/readyz` are the unversioned orchestrator probes and stay out of the contract.
const probeOk = (description, schema) => ({ description, headers: { 'X-Request-Id': H('RequestId') }, content: { 'application/json': { schema: S(schema) } } });
doc.paths['/v1/health'] = { get: {
  tags: ['System'], operationId: 'getHealth', summary: 'Health with a database round trip', security: [],
  description: 'Liveness plus a database round trip (through PgBouncer when so configured). No credential needed. `503` with the same body shape when the database does not answer.',
  responses: {
    200: probeOk('Healthy.', 'HealthResponse'),
    429: R('TooManyRequests'),
    503: { description: 'Degraded: the database check failed (same body).', headers: { 'X-Request-Id': H('RequestId') }, content: { 'application/json': { schema: S('HealthResponse') } } },
  },
} };
doc.paths['/v1/version'] = { get: {
  tags: ['System'], operationId: 'getVersion', summary: 'Build version', security: [],
  description: 'Name, version, commit and process role of the running build. No credential needed.',
  responses: { 200: probeOk('The build.', 'VersionResponse'), 429: R('TooManyRequests') },
} };
addOp('/v1/assets/{id}/clone', 'post', {
  tag: 'Assets', id: 'cloneAsset', summary: 'Clone an asset', perm: 'asset:create', params: [ID],
  description: 'Creates `count` copies of the asset with fresh tags (the numbering template, or the explicit `asset_tags`) and a cleared serial. `copy_fields` chooses what is copied (default: all of `name`, `model_id`, `status_id`, `vendor_id`, `location_id`, `parent_asset_id`, `purchase_date`, `purchase_cost`, `order_number`, `warranty_end`, `notes`, `custom_data`). All or nothing: one transaction, one audit record and outbox event per copy.\n\nAdded by M1-REG-09 (not part of the first contract draft).',
  body: jsonBody(S('AssetCloneRequest'), false),
  success: { 201: okResp(201, 'The copies.', S('AssetCloneResult')) },
});
const BULK_NOTE = 'At most 100 ids per request. The response is `200` with one result per id, in request order (`results[].status` is the status the single-asset operation would have returned, `results[].error` the problem document when it failed); a failing item does not roll back the others. Each item writes its own audit record and outbox event, plus one `bulk_operation` audit record for the request. Idempotent with `Idempotency-Key`.\n\nAdded by M1-REG-09 (not part of the first contract draft).';
addOp('/v1/assets/bulk-update', 'post', {
  tag: 'Assets', id: 'bulkUpdateAssets', summary: 'Edit many assets', perm: 'asset:update', hasId: false, conflict: false,
  description: 'Applies the same `changes` (status, category, model, vendor, department, `custom_data` merge) to every listed asset.\n\n' + BULK_NOTE,
  body: jsonBody(S('BulkAssetUpdate')),
  success: { 200: okResp(200, 'Per-item results.', S('BulkAssetResult')) },
});
addOp('/v1/assets/bulk-archive', 'post', {
  tag: 'Assets', id: 'bulkArchiveAssets', summary: 'Archive many assets', perm: 'asset:delete', hasId: false, conflict: false,
  description: 'Soft-deletes the listed assets (same rules as `DELETE /v1/assets/{id}`).\n\n' + BULK_NOTE,
  body: jsonBody(S('BulkAssetIds')),
  success: { 200: okResp(200, 'Per-item results.', S('BulkAssetResult')) },
});
addOp('/v1/assets/bulk-restore', 'post', {
  tag: 'Assets', id: 'bulkRestoreAssets', summary: 'Restore many assets', perm: 'asset:delete', hasId: false, conflict: false,
  description: 'Restores the listed archived assets.\n\n' + BULK_NOTE,
  body: jsonBody(S('BulkAssetIds')),
  success: { 200: okResp(200, 'Per-item results.', S('BulkAssetResult')) },
});
addOp('/v1/settings/asset-tag-template', 'get', {
  tag: 'Assets', id: 'getAssetTagTemplate', summary: 'Get the asset tag numbering template', perm: 'catalog:read',
  description: 'The template used to generate asset tags when `POST /v1/assets` omits `asset_tag`: `prefix` + the category `tag_prefix` (when `use_category_prefix`) + a counter zero-padded to `width`. Counters are per tenant and per full prefix; tags are never reused.\n\nAdded by M1-REG-06 (not part of the first contract draft).',
  success: { 200: okResp(200, 'The template.', S('AssetTagTemplate'), { etag: true, replay: false }) },
});
addOp('/v1/settings/asset-tag-template', 'put', {
  tag: 'Assets', id: 'putAssetTagTemplate', summary: 'Replace the asset tag numbering template', perm: 'catalog:manage', ifMatch: true, conflict: false,
  description: 'Existing tags are never rewritten. `If-Match` is the ETag of `GET` (the tenant settings version).',
  body: jsonBody(S('AssetTagTemplate')),
  success: { 200: okResp(200, 'The new template.', S('AssetTagTemplate'), { etag: true }) },
});
addOp('/v1/assets/{id}/history', 'get', {
  tag: 'Assets', id: 'listAssetHistory', summary: 'Chain of custody and lifecycle events', perm: 'asset:read',
  description: 'Newest first. Includes custody changes, status/location changes, repairs and imports.',
  params: [ID, P('Cursor'), P('Limit'), arrQ('event_type', en(['created', 'updated', 'status_changed', 'location_changed', 'checked_out', 'checked_in', 'transferred', 'repair_opened', 'repair_completed', 'archived', 'restored', 'label_printed', 'imported', 'custody_undone']), 'Filter by event type.'), qp('from', dt(), 'Events at or after.'), qp('to', dt(), 'Events before.')],
  success: { 200: okResp(200, 'A page of events.', S('HistoryEventList'), { replay: false }) },
});
addOp('/v1/assets/{id}/assignments', 'get', {
  tag: 'Assets', id: 'listAssetAssignments', summary: 'Assignment history of an asset', perm: 'asset:read',
  description: 'Every custody period of the asset, newest first.',
  params: [ID, P('Cursor'), P('Limit')],
  success: { 200: okResp(200, 'A page of assignments.', S('AssignmentList'), { replay: false }) },
});
addOp('/v1/scan/resolve', 'get', {
  tag: 'Assets', id: 'resolveScan', summary: 'Resolve a scanned code', perm: 'asset:read', hasId: true,
  description: 'Accepts the opaque QR `label_code`, the whole label URL (`<PUBLIC_URL>/s/<label_code>` or `/s/<label_code>`: its last path segment is used) a Code128 `asset_tag` or the exact device `serial` number (matched case-insensitively, tried in that order; `match_type` says which one it was), and returns the asset with the actions allowed right now. `entity_type` says what the code identifies: `asset`, or (M2 wave 2) `accessory` / `consumable`, which are found by the `label_code` of their label only and answered with their own member (`accessory` / `consumable`) and actions; the accessory and consumable answers need `accessory:read` / `consumable:read` (without it the code is a plain 404). `404` when nothing matches in the caller\'s tenant and scope: unknown, foreign and out-of-scope codes are indistinguishable. Enumeration resistance: a signed-in caller whose lookups keep missing (60 per throttle window by default) is answered `429` with `Retry-After` for every code until the window ends (hits never count towards the limit). The web route `/s/<label_code>` sends signed-out users to sign-in first and reveals nothing about the code; this endpoint answers `401` without a credential whatever the code. Responses are `Cache-Control: private, no-store`. A serial number is not unique per organisation: when it belongs to more than one asset the answer is `409 conflict` (scan the label or enter the tag instead) rather than a guess.',
  problems: { 409: { codes: ['conflict'], text: 'The serial number belongs to several assets; use the label or the asset tag.' } },
  params: [{ name: 'code', in: 'query', required: true, description: 'Scanned value.', schema: str({ minLength: 1, maxLength: 200 }) }],
  success: { 200: okResp(200, 'The matching asset, accessory or consumable.', S('ScanResolveResponse'), { replay: false }) },
});

// ---------------------------------------------------------------- CUSTODY
addOp('/v1/assets/{id}/checkout', 'post', {
  tag: 'Custody', id: 'checkoutAsset', summary: 'Check out an asset', perm: 'asset:checkout', params: [ID], ifMatchOptional: true, idem: 'required',
  description: 'Opens a custody period to a person, a location or another asset. The asset must be in a `deployable` state and not already checked out (409 `asset-already-checked-out`). Sets the status to the tenant\'s deployed label and writes history, audit and outbox rows atomically.',
  body: jsonBody(S('CheckoutRequest'), true, { person_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91', expected_return: '2026-12-15', note: 'Loan for the exam week' }),
  // [M2-W1] 409 codes; the 50-way race on one asset yields exactly one 201 and 49 `asset-already-checked-out`
  problems: { 409: { codes: ['asset-already-checked-out', 'asset-not-deployable', 'conflict', 'idempotency-key-in-flight'], text: 'Already checked out, not in a deployable state (lost, archived, in repair, pending), or a request with the same Idempotency-Key is still running.' } },
  success: { 201: okResp(201, 'Checked out. Returns the updated asset and the new assignment; `ETag` is the new version of the asset and `Location` points at the assignment.', S('CustodyResult'), { etag: true, location: true }) },
});
addOp('/v1/assets/{id}/checkin', 'post', {
  tag: 'Custody', id: 'checkinAsset', summary: 'Check in an asset', perm: 'asset:checkin', params: [ID], ifMatchOptional: true, idem: 'required',
  description: 'Closes the open custody period (409 `asset-not-checked-out` if none) and optionally moves the asset and sets a new status.',
  body: jsonBody(S('CheckinRequest'), false),
  problems: { 409: { codes: ['asset-not-checked-out', 'conflict', 'idempotency-key-in-flight'], text: 'The asset has no open check-out, or a request with the same Idempotency-Key is still running.' } },
  success: { 200: okResp(200, 'Checked in. Returns the updated asset and the closed assignment; `ETag` is the new version of the asset.', S('CustodyResult'), { etag: true }) },
});
addOp('/v1/assets/{id}/transfer', 'post', {
  tag: 'Custody', id: 'transferAsset', summary: 'Transfer an asset to a new holder', perm: 'asset:transfer', params: [ID], ifMatchOptional: true, idem: 'required',
  description: 'Atomically closes the current assignment (if any) and opens a new one, and records a `Transfer`. User to user, user to location and location to user all work; an asset in stock (no open assignment) is handed out like a check-out and needs a `deployable` state. If either half fails the whole transfer rolls back: the asset is never left unassigned. One audit record and one `transferred` history event. The new holder must differ from the current one (422).',
  body: jsonBody(S('TransferRequest')),
  problems: { 409: { codes: ['asset-not-deployable', 'conflict', 'idempotency-key-in-flight'], text: 'The asset cannot be handed out in its current state, or a request with the same Idempotency-Key is still running.' } },
  success: { 201: okResp(201, 'Transferred. Returns the updated asset, the transfer record and the new assignment; `ETag` is the new version of the asset.', S('TransferResult'), { etag: true, location: true }) },
});

// [M2-UX-02] BEGIN - undo of a custody action (ED-23)
S_.UndoCustodyRequest = obj({ assignment_id: uuid('The `assignment.id` the action answered with: the new assignment of a check-out or transfer, the closed one of a check-in.') }, ['assignment_id'], { additionalProperties: false });
S_.UndoResult = obj({
  asset: S('Asset'),
  assignment: S('Assignment'),
  undone: en(['checkout', 'checkin', 'transfer']),
}, ['asset', 'assignment', 'undone'], { description: 'Result of an undo: the **updated asset** (new `ETag` also in the header), the assignment that is now in effect (the closed one after undoing a check-out or a transfer from stock, the re-opened one after undoing a check-in or a transfer between holders) and what was undone.' });
addOp('/v1/assets/{id}/undo-custody', 'post', {
  tag: 'Custody', id: 'undoAssetCustody', summary: 'Undo the last custody action of an asset', perm: 'asset:checkout', params: [ID], ifMatch: true, idem: 'required',
  description: 'Reverses the **last** check-out, check-in or transfer of the asset as an inverse action, in one transaction, never as a delete: a check-out is undone by closing its period and restoring the previous status; a check-in by re-opening custody for the same holder (a NEW assignment: a closed period is never re-opened) and restoring the previous status and location; a transfer by moving the asset back to the previous holder (or, for a transfer out of stock, like a check-out). The original event, assignment and audit row stay; the undo adds a `custody_undone` history event, an audit row `asset.custody_undone` and a new version of the asset.\n\nGuards: `If-Match` is required and must be the ETag the action answered with (412 when the asset changed in any way since); `assignment_id` must belong to the newest history event of the asset (409 `undo-asset-changed` otherwise, 409 `undo-not-possible` when that event is already an undo); the action is at most five minutes old (409 `undo-expired`); the caller needs the permission of the action it reverses (`asset:checkout`, `asset:checkin` or `asset:transfer`; 403 otherwise); and the previous holder and status must still be valid (409 `undo-not-possible`, for example the person was deactivated meanwhile). Loaner custody is not undone here. Requires an `Idempotency-Key`: a retry replays the stored answer.',
  body: jsonBody(S('UndoCustodyRequest'), true, { assignment_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d93' }),
  problems: { 409: { codes: ['undo-expired', 'undo-asset-changed', 'undo-not-possible', 'conflict', 'idempotency-key-in-flight'], text: 'Too late, the asset changed meanwhile, already undone, or the previous holder / status is gone.' } },
  success: { 200: okResp(200, 'Undone. Returns the updated asset and the assignment now in effect; `ETag` is the new version of the asset.', S('UndoResult'), { etag: true }) },
});
// [M2-UX-02] END

// ---------------------------------------------------------------- [M2-W1] moves, disposal, lost and found, person history
// Added by the wave-1 backend (M2-LOC-02, M2-LIFE-05, M2-LIFE-06): not part of the first contract draft.
S_.MoveRequest = obj({
  location_id: nuuid('Destination location; `null` clears the location (whereabouts unknown).'),
  note: str({ maxLength: 2000 }),
}, ['location_id'], { additionalProperties: false, description: 'Moves an asset to a location.' });
S_.BulkAssetMove = obj({
  ids: bulkIds(),
  location_id: nuuid('Destination location for every asset; `null` clears it.'),
  note: str({ maxLength: 2000 }),
}, ['ids', 'location_id'], { additionalProperties: false });
S_.DisposeRequest = obj({
  reason: en(['sold', 'donated', 'recycled', 'scrapped', 'stolen', 'returned_to_vendor', 'other']),
  note: str({ maxLength: 2000, description: 'Free text (buyer, recipient, certificate number...).' }),
  disposed_on: date({ description: 'Defaults to today (UTC).' }),
  status_id: uuid('An `archived`-type status label; default: the first one of the tenant.'),
}, ['reason'], { additionalProperties: false });
S_.MarkLostRequest = obj({
  note: str({ maxLength: 2000 }),
  status_id: uuid('A `lost`-type status label; default: the first one of the tenant.'),
}, [], { additionalProperties: false });
S_.MarkFoundRequest = obj({
  status_id: uuid('A `deployable`-type status label to return the asset to; default: the tenant default (or first deployable) label.'),
  location_id: nuuid('Where the asset was found / is now.'),
  note: str({ maxLength: 2000 }),
}, [], { additionalProperties: false });
const ASSET_ACTION_PROBLEMS = { 409: { codes: ['conflict', 'asset-already-checked-out', 'asset-not-deployable'], text: 'The asset is archived, or its state does not allow this action (see the description).' } };
addOp('/v1/assets/{id}/move', 'post', {
  tag: 'Assets', id: 'moveAsset', summary: 'Move an asset to a location', perm: 'asset:update', params: [ID], ifMatchOptional: true,
  description: 'Changes `location_id` and writes a `location_changed` history event with the note, an audit record and an outbox event. Allowed while the asset is checked out (the location is where it physically is). Archived assets cannot be moved. `If-Match` is optional; with it a stale version is `412`.',
  body: jsonBody(S('MoveRequest'), true, { location_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d92', note: 'Moved to the exam room' }),
  problems: { 409: { codes: ['conflict'], text: 'The asset is archived.' } },
  success: { 200: okResp(200, 'The moved asset; `ETag` is its new version.', S('Asset'), { etag: true }) },
});
addOp('/v1/assets/bulk-move', 'post', {
  tag: 'Assets', id: 'bulkMoveAssets', summary: 'Move many assets to a location', perm: 'asset:update', hasId: false, conflict: false,
  description: 'Moves every listed asset to `location_id` (same rules as `POST /v1/assets/{id}/move`).\n\n' + BULK_NOTE,
  body: jsonBody(S('BulkAssetMove')),
  success: { 200: okResp(200, 'Per-item results.', S('BulkAssetResult')) },
});
addOp('/v1/assets/{id}/dispose', 'post', {
  tag: 'Assets', id: 'disposeAsset', summary: 'Dispose of an asset', perm: 'asset:delete', params: [ID], ifMatchOptional: true,
  description: 'Retires the asset for good: sets an `archived`-type status, records the reason, the date and the note (`Asset.disposal`), and archives the asset so it leaves default lists and active counts. Not allowed while the asset is checked out (`409 asset-already-checked-out`: check it in first) or already archived. Writes an `archived` history event, an audit record and an outbox event. `POST /v1/assets/{id}/restore` takes a disposed asset back (the disposal record is cleared and the status returns to the tenant default).',
  body: jsonBody(S('DisposeRequest'), true, { reason: 'recycled', note: 'Certificate R-2210' }),
  problems: ASSET_ACTION_PROBLEMS,
  success: { 200: okResp(200, 'The disposed asset.', S('Asset'), { etag: true }) },
});
addOp('/v1/assets/{id}/mark-lost', 'post', {
  tag: 'Assets', id: 'markAssetLost', summary: 'Mark an asset lost or stolen', perm: 'asset:update', params: [ID], ifMatchOptional: true,
  description: 'Moves the asset to a `lost`-type status. An open custody period is closed (its `checkin_note` says the asset was lost). A lost asset cannot be checked out. Not allowed when the asset is already lost or archived. Writes a `status_changed` history event.',
  body: jsonBody(S('MarkLostRequest'), false),
  problems: ASSET_ACTION_PROBLEMS,
  success: { 200: okResp(200, 'The asset in its lost state.', S('Asset'), { etag: true }) },
});
addOp('/v1/assets/{id}/mark-found', 'post', {
  tag: 'Assets', id: 'markAssetFound', summary: 'Mark a lost asset found', perm: 'asset:update', params: [ID], ifMatchOptional: true,
  description: 'Returns a lost asset to a `deployable` status (and optionally a location). `409 conflict` when the asset is not lost. Writes a `status_changed` history event.',
  body: jsonBody(S('MarkFoundRequest'), false),
  problems: { 409: { codes: ['conflict'], text: 'The asset is not in a lost state.' } },
  success: { 200: okResp(200, 'The recovered asset.', S('Asset'), { etag: true }) },
});
addOp('/v1/people/{id}/history', 'get', {
  tag: 'People', id: 'listPersonHistory', summary: 'Chain of custody of a person', perm: 'person:read',
  description: 'Newest first: every custody event (check-out, check-in, transfer) that involved this person, across assets.',
  params: [ID, P('Cursor'), P('Limit')],
  success: { 200: okResp(200, 'A page of events.', S('HistoryEventList'), { replay: false }) },
});

// ---------------------------------------------------------------- ACCESSORIES
// [M2-W2 ACC]: BEGIN accessories (M2-ACC-01). Check-out and check-in use the same assignment table as assets.
crud({
  tag: 'Accessories', base: 'accessories', name: 'Accessory', plural: 'Accessories', singular: 'accessory', readPerm: 'accessory:read', writePerm: 'accessory:manage',
  filters: [qp('category_id', uuid(), 'Filter by category.'), qp('location_id', uuid(), 'Filter by location.'), qp('low_stock', bool(), 'true = only accessories with `min_qty > 0` and `qty_available <= min_qty`; false = all the others.')],
  sorts: ['name', 'qty_total', 'created_at'], defSort: ['name'],
});
// The generic operations get the accessory-specific problem codes.
{
  const upd = doc.paths['/v1/accessories/{id}'].patch.responses;
  upd['409'] = specificProblem('409', ['insufficient-stock', 'conflict'], 'The new `qty_total` is below the units that are checked out (`insufficient-stock`), or another uniqueness conflict.');
  upd['422'] = R('Unprocessable');
  doc.paths['/v1/accessories/{id}'].delete.responses['409'] = specificProblem('409', ['conflict'], 'Units are still checked out (`usage.open_assignments`); return them first.');
}
addOp('/v1/accessories/{id}/checkout', 'post', {
  tag: 'Accessories', id: 'checkoutAccessory', summary: 'Check out accessory units', perm: 'accessory:checkout', params: [ID], idem: 'required',
  description: 'Hands `quantity` units (default 1) to a person, a location or an asset: one assignment row with `quantity` and `quantity_returned = 0`. Fails with 409 `insufficient-stock` if the quantity exceeds what is available (`qty_total` minus the units still outstanding on open assignments); concurrent check-outs are serialised on the accessory, so the stock is never exceeded. The person must be active, the location and target asset live. Writes an audit record and the outbox event `accessory.checked_out` in the same transaction; when the check-out brings `qty_available` to or below `min_qty` the outbox event `accessory.low_stock` is emitted once per crossing.',
  problems: { 409: { codes: ['insufficient-stock', 'conflict', 'idempotency-key-in-flight'], text: 'Not enough units available (`insufficient-stock`), the accessory is archived, or a request with the same Idempotency-Key is still running.' } },
  body: jsonBody(S('AccessoryCheckoutRequest'), true, { person_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91', quantity: 2, note: 'Two chargers for the new starter' }),
  success: { 201: okResp(201, 'Checked out.', S('Assignment'), { location: true }) },
});
addOp('/v1/accessories/{id}/checkin', 'post', {
  tag: 'Accessories', id: 'checkinAccessory', summary: 'Return accessory units', perm: 'accessory:checkout', params: [ID], idem: 'required',
  problems: { 409: { codes: ['conflict', 'idempotency-key-in-flight'], text: 'The assignment is already fully returned, or a request with the same Idempotency-Key is still running.' } },
  description: 'Returns `quantity` units (default: everything still outstanding) of an open assignment. A partial return increases `quantity_returned` on the same assignment, which stays open; the return that completes it sets `checked_in_at`. The returned units are available again immediately. Returning more than the outstanding units is rejected with 422.',
  body: jsonBody(S('AccessoryCheckinRequest')),
  success: { 200: okResp(200, 'The assignment after the return: still open with a higher `quantity_returned` after a partial return, closed (`checked_in_at` set) after the last units come back.', S('Assignment')) },
});
addOp('/v1/accessories/{id}/assignments', 'get', {
  tag: 'Accessories', id: 'listAccessoryAssignments', summary: 'Who holds this accessory', perm: 'accessory:read',
  description: 'Newest first. Each row carries `quantity`, `quantity_returned` and `target_name`.',
  params: [ID, P('Cursor'), P('Limit'), qp('state', en(['open', 'closed', 'all']), 'Defaults to `open`.')],
  success: { 200: okResp(200, 'A page of assignments.', S('AssignmentList'), { replay: false }) },
});
// [M2-W2 ACC]: END

// ---------------------------------------------------------------- CONSUMABLES
// [M2-W2 ACC]: BEGIN consumables (M2-ACC-02, M2-ACC-03)
crud({
  tag: 'Consumables', base: 'consumables', name: 'Consumable', plural: 'Consumables', singular: 'consumable', readPerm: 'consumable:read', writePerm: 'consumable:manage',
  filters: [qp('category_id', uuid(), 'Filter by category.'), qp('location_id', uuid(), 'Filter by location.'), qp('low_stock', bool(), 'true = only consumables with `min_qty > 0` and `qty_on_hand <= min_qty`; false = all the others.')],
  sorts: ['name', 'qty_on_hand', 'created_at'], defSort: ['name'],
});
doc.paths['/v1/consumables'].post.description = 'A positive `initial_qty` is recorded as the first `receive` movement of the ledger (note: "Opening stock"), in the same transaction.\n\nRequires permission `consumable:manage`.';
doc.paths['/v1/consumables/{id}'].delete.responses['409'] = specificProblem('409', ['conflict'], 'Reserved for a uniqueness conflict; a consumable with stock can be archived (its ledger stays).');
addOp('/v1/consumables/{id}/movements', 'get', {
  tag: 'Consumables', id: 'listStockMovements', summary: 'Stock ledger of a consumable', perm: 'consumable:read',
  description: 'The consume log of one consumable, newest first; filter by reason and by the person the stock went to.',
  params: [ID, P('Cursor'), P('Limit'), arrQ('reason', en(['receive', 'issue', 'return', 'adjust', 'correction']), 'Filter by reason.'), qp('person_id', uuid(), 'Only movements issued to / returned by this person.')],
  success: { 200: okResp(200, 'A page of movements, newest first.', S('StockMovementList'), { replay: false }) },
});
addOp('/v1/consumables/{id}/movements', 'post', {
  tag: 'Consumables', id: 'createStockMovement', summary: 'Receive, issue or adjust stock', perm: 'consumable:adjust', params: [ID], idem: 'required',
  description: 'Appends to the ledger and updates `qty_on_hand` atomically; concurrent movements of one consumable are serialised, so stock can never go negative (409 `insufficient-stock`). The ledger is append-only: fix mistakes with a `correction` movement. Writes an audit record and the outbox event `consumable.stock_moved`; when the movement brings `qty_on_hand` to or below `min_qty` the outbox event `consumable.low_stock` is emitted once per crossing (ids only; re-armed when the stock rises above the minimum again). An archived consumable takes no movements (409 `conflict`).',
  problems: { 409: { codes: ['insufficient-stock', 'conflict', 'idempotency-key-in-flight'], text: 'The movement would make stock negative (`insufficient-stock`), the consumable is archived, or a request with the same Idempotency-Key is still running.' } },
  body: jsonBody(S('StockMovementCreate'), true, { qty_delta: -2, reason: 'issue', person_id: '0197a3c2-1b6e-7c3a-8d41-2f5b6a7c8d91', note: 'Printer on floor 2' }),
  success: { 201: okResp(201, 'Movement recorded.', S('StockMovement'), { location: true }) },
});
addOp('/v1/people/{id}/stock-movements', 'get', {
  tag: 'Consumables', id: 'listPersonStockMovements', summary: 'Consumption log of a person', perm: 'consumable:read',
  description: 'Every stock movement issued to or returned by this person, across consumables, newest first (M2-ACC-02: "consume log queryable per person").',
  params: [ID, P('Cursor'), P('Limit'), arrQ('reason', en(['receive', 'issue', 'return', 'adjust', 'correction']), 'Filter by reason.')],
  success: { 200: okResp(200, 'A page of movements, newest first.', S('StockMovementList'), { replay: false }) },
});
// [M2-W2 ACC]: END

// ---------------------------------------------------------------- LOANERS
// [LOAN] BEGIN - loaner pools (M2-LOAN-01, ED-20, ED-21, ADR 0011)
crud({
  tag: 'Loaners', base: 'loaner-pools', name: 'LoanerPool', plural: 'LoanerPools', singular: 'loaner pool', readPerm: 'loaner:read', writePerm: 'loaner:manage',
  filters: [qp('is_active', bool(), 'Only active / inactive pools.'), qp('home_location_id', uuid(), 'Pools whose home is this location.')], sorts: ['name', 'created_at'], defSort: ['name'],
});
doc.paths['/v1/loaner-pools'].get.description = 'Cursor-paginated list. `q` matches the name. Every pool carries its live counts (`member_count`, `available_count`, `checked_out_count`, `overdue_count`, `due_today_count`), so the pool list needs one call.';
doc.paths['/v1/loaner-pools'].post.description = 'Creates a pool. The name is unique among live pools, ignoring case (409 `conflict`, pointer `/name`); `home_location_id` must be a live location and `owner_user_id` an active user (422); `max_loan_days` must be >= `default_loan_days` (422).';
doc.paths['/v1/loaner-pools/{id}'].delete.description = 'Soft delete. `409 conflict` with `usage.open_loans` while a member is checked out; otherwise the pool is archived and its memberships are removed, so the assets can join another pool. Switch a pool off with `is_active: false` instead to keep its members.';
addOp('/v1/loaner-pools/{id}/members', 'get', {
  tag: 'Loaners', id: 'listLoanerPoolMembers', summary: 'List pool members', perm: 'loaner:read',
  description: 'The assets of the pool, in asset-tag order, with the full asset (status, location, `current_assignment`) and whether each can be lent right now.',
  params: [ID, P('Cursor'), P('Limit'), qp('available', bool(), 'true = can be lent right now (not archived, `deployable`, not checked out); false = every other member.')],
  success: { 200: okResp(200, 'A page of pool members.', S('LoanerPoolMemberList'), { replay: false }) },
});
addOp('/v1/loaner-pools/{id}/members', 'post', {
  tag: 'Loaners', id: 'addLoanerPoolMember', summary: 'Add an asset to the pool', perm: 'loaner:manage', params: [ID],
  description: 'An asset belongs to at most one pool (409 `conflict` if it is in another one; adding it to the pool it is in answers 200 with the existing member). Archived assets cannot join (422). A member can still be checked out the regular way.',
  body: jsonBody(obj({ asset_id: uuid() }, ['asset_id'], { additionalProperties: false })),
  problems: { 409: { codes: ['conflict', 'idempotency-key-in-flight'], text: 'The asset is a member of another pool.' } },
  success: { 201: okResp(201, 'Added.', S('LoanerPoolMember')), 200: okResp(200, 'Already a member of this pool.', S('LoanerPoolMember')) },
});
addOp('/v1/loaner-pools/{id}/members/{asset_id}', 'delete', {
  tag: 'Loaners', id: 'removeLoanerPoolMember', summary: 'Remove an asset from the pool', perm: 'loaner:manage', params: [ID, P('AssetIdPath')],
  description: 'Rejected with 409 while the asset is on loan from this pool (`usage.open_loans`); a regular check-out of a member does not block removal.',
  success: { 204: okResp(204, 'Removed.') },
});
addOp('/v1/loaner-pools/{id}/members/bulk-add', 'post', {
  tag: 'Loaners', id: 'bulkAddLoanerPoolMembers', summary: 'Add many assets to the pool', perm: 'loaner:manage', params: [ID], conflict: false,
  description: 'Adds every listed asset (same rules as `POST /v1/loaner-pools/{id}/members`). At most 100 ids; the response is `200` with one result per id, in request order, and a failing item does not roll back the others. Idempotent with `Idempotency-Key`.',
  body: jsonBody(S('LoanerPoolMembersBulk')),
  success: { 200: okResp(200, 'Per-item results.', S('LoanerPoolMemberBulkResult')) },
});
addOp('/v1/loaner-pools/{id}/members/bulk-remove', 'post', {
  tag: 'Loaners', id: 'bulkRemoveLoanerPoolMembers', summary: 'Remove many assets from the pool', perm: 'loaner:manage', params: [ID], conflict: false,
  description: 'Removes every listed asset (same rules as `DELETE /v1/loaner-pools/{id}/members/{asset_id}`). At most 100 ids; `200` with one result per id (status 204 on success, no `data`), a failing item does not roll back the others.',
  body: jsonBody(S('LoanerPoolMembersBulk')),
  success: { 200: okResp(200, 'Per-item results.', S('LoanerPoolMemberBulkResult')) },
});
addOp('/v1/loaner-pools/{id}/checkout', 'post', {
  tag: 'Loaners', id: 'checkoutLoaner', summary: 'Quick loan from the pool', perm: 'loaner:checkout', params: [ID], idem: 'required',
  description: 'Checks out a specific pool member, or the next available one (lowest asset tag first), to a person with a due date: `expected_return`, else today (UTC) + the pool\'s `default_loan_days`, else + the organisation\'s `default_expected_return_days`, else + 7 days (ED-24; never beyond the pool\'s `max_loan_days`). Without `asset_id` the device is the member that has been idle the longest (earliest return of its last custody period, a device never lent first), ties by the lowest asset tag. Return it with `POST /v1/assets/{id}/checkin` or `POST /v1/loans/return`. 409 `no-loaner-available` when the pool is empty, `loaner-pool-inactive` when it is switched off, `loan-limit-reached` when the borrower is at the pool\'s limit; 422 when the person is inactive or of a kind the pool does not serve (`not-eligible`) or the due date is past the pool\'s `max_loan_days`. Like a normal check-out it returns the updated asset (the client may not have known which pool member was chosen) and the assignment, which carries `loaner_pool_id`.',
  body: jsonBody(S('LoanerCheckoutRequest')),
  problems: { 409: { codes: ['no-loaner-available', 'loaner-pool-inactive', 'loan-limit-reached', 'asset-already-checked-out', 'asset-not-deployable', 'conflict', 'idempotency-key-in-flight'], text: 'The pool has nothing to lend, is switched off, or the borrower is at the limit; or (with `asset_id`) the device is out or not deployable.' } },
  success: { 201: okResp(201, 'Loan opened. Returns the updated asset and the new assignment; `ETag` is the new version of the asset.', S('CustodyResult'), { etag: true, location: true }) },
});
addOp('/v1/loaner-pools/{id}/quick-checkout', 'post', {
  tag: 'Loaners', id: 'quickCheckoutLoaners', summary: 'Quick loan by scanning: one borrower, many devices', perm: 'loaner:checkout', params: [ID], idem: 'required', conflict: false,
  description: 'The quick check-out screen in one call: the borrower (`person_id`, or `borrower` = the scanned email / badge, see `QuickLoanRequest`) and the scanned devices (`codes`: label code or URL, asset tag, serial). The due date is `expected_return`, else today (UTC) + the pool\'s `default_loan_days`, else + the organisation\'s `default_expected_return_days`, else + 7 days (ED-24). The borrower is validated once (whole request `422`: unknown, inactive, not eligible; `409 loaner-pool-inactive`); then every code is a loan of its own, in order, answered per item (`results[].status`, `results[].error`): unknown code `404`, ambiguous serial `409 conflict`, not a member of this pool `422` (`not-in-pool`, pointer `/codes/<i>`), already out `409 asset-already-checked-out`, not deployable `409 asset-not-deployable`, past the borrower\'s limit `409 loan-limit-reached`. A failing item does not roll back the others. Every loan is a normal check-out (one open custody per asset, history, audit, outbox) with the pool on the assignment. Unknown codes count towards the scan-resolve throttle (429 once exceeded). Replaying the same `Idempotency-Key` answers the stored result.',
  body: jsonBody(S('QuickLoanRequest')),
  problems: { 404: { codes: ['not-found'], text: 'No such pool.' }, 409: { codes: ['loaner-pool-inactive', 'conflict', 'idempotency-key-in-flight'], text: 'The pool is switched off, the borrower text matches two people, or a request with the same Idempotency-Key is still running.' }, 422: { codes: ['validation', 'idempotency-key-reuse'], text: 'Bad body, unknown / inactive / ineligible borrower, or due date past the pool\'s maximum.' } },
  success: { 200: okResp(200, 'Per-device results (HTTP 200 whenever the request itself was valid).', S('QuickLoanResult')) },
});
// [LOAN] END

// [LOAN] BEGIN - loans: list, return, extend, overdue, dashboard (M2-LOAN-02..04)
addOp('/v1/loans', 'get', {
  tag: 'Loaners', id: 'listLoans', summary: 'List loans', perm: 'loaner:read', hasId: false,
  description: 'Loans from loaner pools (assignments with a `loaner_pool_id`): the click-through lists behind the dashboard. By default the open ones (`on_loan`, `due_today`, `overdue`); add `returned` to include closed ones. `q` matches the asset tag and name and the borrower\'s name.',
  params: [P('Cursor'), P('Limit'), P('IncludeTotal'), P('Q'), qp('loaner_pool_id', uuid(), 'Only this pool.'), qp('person_id', uuid(), 'Only this borrower.'), qp('asset_id', uuid(), 'Only this device.'), arrQ('state', en(['on_loan', 'due_today', 'overdue', 'returned']), 'Only these states. Default: `on_loan,due_today,overdue`.'), qp('due_within_days', int({ minimum: 0, maximum: 366 }), 'Open loans due on or before today + N days (0 = due today or earlier).'), sortParam(['expected_return', 'checked_out_at'], ['expected_return'])],
  success: { 200: okResp(200, 'A page of loans.', S('LoanList'), { replay: false }) },
});
addOp('/v1/loans/overdue', 'get', {
  tag: 'Loaners', id: 'listOverdueCheckouts', summary: 'Overdue check-outs', perm: 'loaner:read', hasId: false,
  description: 'Open asset check-outs past `expected_return` (before today, UTC), loaner or not, to anyone or anywhere: the data behind the overdue view. Only loans from a loaner pool raise alerts (see ED-21). `days_overdue` counts whole days.',
  params: [P('Cursor'), P('Limit'), qp('loaner_pool_id', uuid(), 'Only this pool.'), qp('person_id', uuid(), 'Only this borrower.'), sortParam(['expected_return', 'days_overdue'], ['expected_return'])],
  success: { 200: okResp(200, 'A page of overdue check-outs.', S('OverdueCheckoutList'), { replay: false }) },
});
addOp('/v1/loans/return', 'post', {
  tag: 'Loaners', id: 'returnLoans', summary: 'Quick return by scanning (one or many devices)', perm: 'loaner:checkout', hasId: false, idem: 'required', conflict: false,
  description: 'The bulk check-in screen in one call: the scanned devices (`codes`, at most 100) are checked in one after the other, answered per item in request order. A device must be a member of a loaner pool (of `loaner_pool_id` when given): else `422` (`not-in-pool`, pointer `/codes/<i>`); not checked out `409 asset-not-checked-out`; unknown code `404`. Each return is a normal check-in (history, audit, outbox, status back to deployable) and moves the device to `checkin_location_id`, or to the pool\'s `home_location_id`. A failing item does not roll back the others; unknown codes count towards the scan-resolve throttle. Replaying the same `Idempotency-Key` answers the stored result; returning a device twice with different keys is a per-item `409 asset-not-checked-out`.',
  body: jsonBody(S('LoanReturnRequest')),
  problems: { 409: { codes: ['idempotency-key-in-flight'], text: 'A request with the same Idempotency-Key is still running.' }, 422: { codes: ['validation', 'idempotency-key-reuse'], text: 'Bad body, unknown location or status.' } },
  success: { 200: okResp(200, 'Per-device results (HTTP 200 whenever the request itself was valid).', S('LoanReturnResult')) },
});
addOp('/v1/loans/{id}', 'get', {
  tag: 'Loaners', id: 'getLoan', summary: 'Get a loan', perm: 'loaner:read', params: [ID],
  description: 'One loan by its assignment id (open or returned).',
  success: { 200: okResp(200, 'The loan.', S('Loan'), { replay: false }) },
});
addOp('/v1/loans/{id}/extend', 'post', {
  tag: 'Loaners', id: 'extendLoan', summary: 'Extend a loan', perm: 'loaner:checkout', params: [ID],
  description: 'Moves the due date of an open loan to a later date: not before today (UTC) and within the pool\'s `max_loan_days` counted from the day the loan started (422 `/expected_return`). A closed loan is `409 conflict`. Extending is a logged action: an audit record (`loan.extended`, with the old and new date and the note), an outbox event and an entry in the asset\'s history (event type `updated`, `payload.loan_extended`). The asset\'s ETag changes (its `current_assignment` did). The "due soon" and "overdue" alerts re-arm for the new date.',
  body: jsonBody(S('LoanExtendRequest')),
  success: { 200: okResp(200, 'The loan with its new due date.', S('Loan')) },
});
addOp('/v1/loaners/dashboard', 'get', {
  tag: 'Loaners', id: 'getLoanerDashboard', summary: 'Loaner dashboard', perm: 'loaner:read', hasId: false, mutate: false,
  description: 'Per-pool counts (pool size, available, out, overdue, due today, due soon) with their totals, and the latest check-outs and returns. Counts cover live (not archived) pools and members; "today" is the UTC date (`as_of`). Inactive pools are listed (with `is_active: false`) and counted.',
  success: { 200: okResp(200, 'The dashboard.', S('LoanerDashboard'), { replay: false }) },
});
// [LOAN] END
// [LOAN] BEGIN - tenant custody settings (M2-LIFE-09)
addOp('/v1/settings/custody', 'get', {
  tag: 'Custody', id: 'getCustodySettings', summary: 'Get the custody settings', perm: 'catalog:read', hasId: false,
  description: 'Organisation-wide custody defaults: `default_expected_return_days` (the web app pre-fills the expected return of check-out and transfer dialogs with today + N days; the API never applies it to an ordinary check-out, but a loaner loan whose pool has no `default_loan_days` takes it, ED-24) and `loan_reminder_days` (lead time of the "due soon" reminder of loaner loans).',
  success: { 200: okResp(200, 'The settings.', S('CustodySettings'), { etag: true, replay: false }) },
});
addOp('/v1/settings/custody', 'put', {
  tag: 'Custody', id: 'putCustodySettings', summary: 'Replace the custody settings', perm: 'catalog:manage', ifMatch: true, conflict: false, hasId: false,
  description: 'Replaces both settings (an omitted one is reset to its default). `If-Match` is the ETag of `GET` (the tenant settings version). Audited like the other settings.',
  body: jsonBody(S('CustodySettingsUpdate')),
  success: { 200: okResp(200, 'The new settings.', S('CustodySettings'), { etag: true }) },
});
// [LOAN] END

// ---------------------------------------------------------------- REPAIRS
crud({
  tag: 'Repairs', base: 'repairs', name: 'Repair', plural: 'Repairs', singular: 'repair record', readPerm: 'repair:read', writePerm: 'repair:manage',
  filters: [qp('asset_id', uuid(), 'Repairs of this asset.'), arrQ('status', en(['open', 'in_progress', 'completed', 'cancelled']), 'Filter by status.'), arrQ('kind', en(['repair', 'maintenance', 'inspection', 'upgrade']), 'Filter by kind.'), qp('vendor_id', uuid(), 'Filter by vendor.'), qp('reported_from', dt(), 'Reported at or after.'), qp('reported_to', dt(), 'Reported before.')],
  sorts: ['reported_at', 'completed_at', 'created_at'], defSort: ['-reported_at'], supportsQ: false,
});
addOp('/v1/repairs/{id}/complete', 'post', {
  tag: 'Repairs', id: 'completeRepair', summary: 'Complete a repair', perm: 'repair:manage', params: [ID], ifMatch: true,
  description: 'Sets `completed_at` and status `completed`, records cost and resolution, and restores the asset status (`restore_status_id`).',
  body: jsonBody(S('RepairCompleteRequest'), false),
  success: { 200: okResp(200, 'The completed repair.', S('Repair'), { etag: true }) },
});

// ---------------------------------------------------------------- LABELS
// [M2-W2 LABELS] BEGIN - M2-TAG-02 (see ADR 0007)
addOp('/v1/labels/templates', 'get', {
  tag: 'Labels', id: 'listLabelTemplates', summary: 'List fixed label templates', perm: 'asset:label', hasId: false,
  description: 'The fixed sheet templates: US Letter 30-up (Avery 5160 layout), A4 21-up (L7160) and 24-up 3 x 8 (L7159), US Letter 10-up (5163), and two single-label pages for roll and thermal printers (50 x 25 mm and 2 x 1 inch). Geometry is fixed in the MVP (the editor arrives in v1.1); only the calibration offsets can change.',
  success: { 200: okResp(200, 'All templates.', S('LabelTemplateList'), { replay: false }) },
});
addOp('/v1/labels/templates/{id}', 'get', {
  tag: 'Labels', id: 'getLabelTemplate', summary: 'Get a label template', perm: 'asset:label', params: [ID],
  success: { 200: okResp(200, 'The template.', S('LabelTemplate'), { etag: true, replay: false }) },
});
addOp('/v1/labels/templates/{id}', 'patch', {
  tag: 'Labels', id: 'updateLabelTemplate', summary: 'Calibrate a label template', perm: 'catalog:manage', params: [ID], ifMatch: true,
  description: 'Sets the calibration offsets of a template after a test print on real label stock (M2-TAG-04). The geometry itself cannot be changed.',
  body: jsonBody(S('LabelTemplateUpdate')),
  success: { 200: okResp(200, 'The calibrated template.', S('LabelTemplate'), { etag: true }) },
});
addOp('/v1/labels/batches', 'post', {
  tag: 'Labels', id: 'createLabelBatch', summary: 'Request a PDF label sheet', perm: 'asset:label', hasId: false, idem: 'required',
  description: 'Queues a worker job that renders QR and/or Code128 labels for the assets (explicit `asset_ids`, or the current list `filter`) into a PDF on the chosen template, starting at `start_position` on the first sheet. Answers `202` with the batch; poll `GET /v1/labels/batches/{id}` until `status` is `ready`, then download the PDF from the short-lived `download_url`. Each QR encodes `<web base url>/s/<label_code>`, each Code128 the asset tag. A `label_printed` event is added to the history of every asset when the file is ready, and a `label.batch.ready` event (ids only) is published.',
  problems: { 422: { codes: ['validation'], text: 'Validation failed: unknown template or asset, `start_position` beyond the template\'s slots, neither or both of `asset_ids` and `filter`, a filter that matches nothing or more than 2000 assets, more than 2000 labels, a tag that cannot be a readable Code128 (`barcode-unprintable`), or a logo that is not a clean PNG/JPEG.' } },
  body: jsonBody(S('LabelBatchCreate')),
  success: { 202: okResp(202, 'Accepted: the batch is queued.', S('LabelBatch'), { location: true }) },
});
addOp('/v1/labels/batches', 'get', {
  tag: 'Labels', id: 'listLabelBatches', summary: 'List my label batches', perm: 'asset:label',
  description: 'The label batches the caller requested, newest first. Nobody sees another user\'s batches.',
  params: [P('Cursor'), P('Limit'), P('IncludeTotal'), arrQ('status', en(['queued', 'ready', 'failed', 'expired']), 'Filter by status.'), sortParam(['created_at'], ['-created_at'])],
  success: { 200: okResp(200, 'A page of batches.', S('LabelBatchList'), { replay: false }) },
});
addOp('/v1/labels/batches/{id}', 'get', {
  tag: 'Labels', id: 'getLabelBatch', summary: 'Get a label batch', perm: 'asset:label', params: [ID],
  description: 'The status of a batch (poll this) and, once `ready`, a fresh presigned `download_url` (valid for a couple of minutes; read again for a new one). `404` for a batch someone else requested.',
  success: { 200: okResp(200, 'The batch.', S('LabelBatch'), { replay: false }) },
});
// [M2-W2 LABELS] END

// ---------------------------------------------------------------- ATTACHMENTS
addOp('/v1/attachments', 'get', {
  tag: 'Attachments', id: 'listAttachments', summary: 'List attachments of a record', perm: 'attachment:read',
  params: [P('Cursor'), P('Limit'), { name: 'entity_type', in: 'query', required: true, schema: en(['asset', 'asset_model', 'accessory', 'consumable', 'location', 'person', 'maintenance_record', 'assignment', 'import_job']) }, { name: 'entity_id', in: 'query', required: true, schema: uuid() }, qp('kind', en(['photo', 'document', 'signature', 'import_file', 'other']), 'Filter by kind.')],
  success: { 200: okResp(200, 'A page of attachments.', S('AttachmentList'), { replay: false }) },
});
addOp('/v1/attachments', 'post', {
  tag: 'Attachments', id: 'createAttachment', summary: 'Start an upload', perm: 'attachment:write',
  description: 'Creates the metadata row (`scan_status=pending`) and returns a presigned PUT URL with size and content-type conditions and a tenant-prefixed key. After the PUT, call `POST /v1/attachments/{id}/complete`.\n\nThe declared `content_type` must be on the allow-list (JPEG, PNG, WebP, GIF, PDF, Office documents, ODF, CSV; never SVG or HTML) and match the file name extension. An `import_file` may also be a `.txt` or `.tsv` text file declared as `text/csv`, `text/plain` or `text/tab-separated-values`; it is stored as `text/csv` and sniffed as CSV text (ED-40). The size must be within the organisation\'s cap. The owner (`entity_type` + `entity_id`) must exist in your organisation (`422` otherwise, also for an owner type that is not available yet). To attach photos to a record that does not exist yet (a check-in), upload them against the asset and send their ids with the check-in.',
  problems: { 413: { codes: ['payload-too-large'], text: 'The file is larger than the organisation\'s upload cap.' }, 415: { codes: ['unsupported-media-type'], text: 'The file type is not allowed, or does not match the file name extension.' } },
  body: jsonBody(S('AttachmentCreate')),
  success: { 201: okResp(201, 'Upload prepared.', S('AttachmentUpload'), { location: true }) },
});
addOp('/v1/attachments/{id}', 'get', {
  tag: 'Attachments', id: 'getAttachment', summary: 'Get an attachment', perm: 'attachment:read', params: [ID],
  description: 'Returns a short-lived `download_url` only when the virus scan has finished clean.',
  success: { 200: okResp(200, 'The attachment.', S('Attachment'), { replay: false }) },
});
addOp('/v1/attachments/{id}/complete', 'post', {
  tag: 'Attachments', id: 'completeAttachment', summary: 'Confirm an upload', perm: 'attachment:write', params: [ID],
  description: 'Verifies the object exists with exactly the declared size, checks that its first bytes are really of the declared type, and queues the virus scan. Idempotent: confirming twice returns the same attachment. A rejected upload (wrong size, content that does not match its type) is archived with `scan_status=error` and its object deleted.',
  problems: {
    409: { codes: ['upload-missing'], text: 'No object was uploaded yet.' },
    413: { codes: ['payload-too-large'], text: 'The uploaded object is larger than declared or allowed.' },
    415: { codes: ['unsupported-media-type'], text: 'The content does not match the declared type.' },
    422: { codes: ['validation'], text: 'The uploaded size differs from the declared size.' },
  },
  success: { 200: okResp(200, 'Upload confirmed; scan queued.', S('Attachment')) },
});
addOp('/v1/attachments/{id}', 'delete', {
  tag: 'Attachments', id: 'archiveAttachment', summary: 'Archive an attachment', perm: 'attachment:write', params: [ID],
  description: 'Soft delete. `409` while the attachment is the primary picture of an asset or model (clear it there first).',
  success: { 204: okResp(204, 'Archived.') },
});

// M2 wave 1b (files): BEGIN - organisation file settings and the local-storage "presigned URL" endpoints.
addOp('/v1/settings/files', 'get', {
  tag: 'Attachments', id: 'getFilesSettings', summary: 'Get the file settings', perm: 'catalog:read', hasId: false,
  description: 'Upload cap (tier default, override, effective) and the EXIF-stripping option of the organisation.',
  success: { 200: okResp(200, 'The settings.', S('FilesSettings'), { etag: true, replay: false }) },
});
addOp('/v1/settings/files', 'put', {
  tag: 'Attachments', id: 'putFilesSettings', summary: 'Replace the file settings', perm: 'catalog:manage', ifMatch: true, conflict: false, hasId: false,
  description: 'Replaces `strip_exif_original` and `max_upload_bytes`. The override can only lower the cap that the plan allows.',
  body: jsonBody(S('FilesSettingsUpdate')),
  success: { 200: okResp(200, 'The new settings.', S('FilesSettings'), { etag: true }) },
});
addOp('/v1/files/{token}', 'put', {
  tag: 'Attachments', id: 'uploadLocalFile', summary: 'Upload a file to local storage (presigned)', anon: true, mutate: true, idem: 'none', conflict: false, hasId: false,
  description: 'Only with the **local filesystem** storage driver (the self-hosted fallback): the "presigned PUT" URL returned by `POST /v1/attachments`. The signed token is the credential (no cookie or API key is read). Send exactly the promised content type and byte count as the raw request body. With the S3 driver the upload URL points at the object store and this route answers `404`.',
  params: [{ name: 'token', in: 'path', required: true, description: 'Signed, short-lived upload token from the presigned URL.', schema: str() }],
  problems: {
    400: { codes: ['bad-request'], text: 'The body has fewer bytes than the URL was issued for.' },
    404: { codes: ['token-invalid', 'not-found'], text: 'The token is malformed, forged or not an upload token, or this deployment does not use local storage.' },
    409: { codes: ['conflict'], text: 'This upload URL was already used.' },
    410: { codes: ['token-expired'], text: 'The upload URL expired.' },
    413: { codes: ['payload-too-large'], text: 'More bytes than the URL was issued for.' },
    415: { codes: ['unsupported-media-type'], text: 'The Content-Type differs from the one the URL was issued for.' },
  },
  success: { 200: okResp(200, 'Stored. Now call `POST /v1/attachments/{id}/complete`.', undefined, { replay: false }) },
});
addOp('/v1/files/{token}', 'get', {
  tag: 'Attachments', id: 'downloadLocalFile', summary: 'Download a file from local storage (presigned)', anon: true, hasId: false,
  description: 'Only with the **local filesystem** storage driver: the short-lived URL returned as `download_url` / `thumbnail_url`. The signed token is the credential; no cookie is read or set. The response carries `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src \'none\'; sandbox`, `Cache-Control: private, no-store`, `Cross-Origin-Resource-Policy: cross-origin`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, a content type from the allow-list and `Content-Disposition: attachment` for everything except raster images.',
  params: [{ name: 'token', in: 'path', required: true, description: 'Signed, short-lived download token from the presigned URL.', schema: str() }],
  problems: {
    404: { codes: ['token-invalid', 'not-found'], text: 'The token is malformed, forged or not a download token, the file is gone, or this deployment does not use local storage.' },
    410: { codes: ['token-expired'], text: 'The download URL expired; fetch the attachment again for a new one.' },
  },
  success: { 200: { description: 'The file bytes.', headers: { 'X-Request-Id': H('RequestId'), 'Content-Disposition': { description: 'inline for raster images, attachment otherwise.', schema: str() }, 'X-Content-Type-Options': { description: 'nosniff', schema: str() }, 'Content-Security-Policy': { description: "default-src 'none'; sandbox", schema: str() } }, content: { 'application/octet-stream': { schema: str({ format: 'binary' }) } } } },
});
// M2 wave 1b (files): END

// ---------------------------------------------------------------- AUDIT
addOp('/v1/audit-log', 'get', {
  tag: 'Audit', id: 'listAuditLog', summary: 'Query the audit log', perm: 'audit:read', hasId: false,
  description: 'Newest first. Retention depends on the plan tier. Responses are also available as CSV with `Accept: text/csv`.',
  params: [P('Cursor'), P('Limit'), qp('entity_type', str(), 'Filter by entity type.'), qp('entity_id', uuid(), 'Filter by entity id.'), qp('actor_user_id', uuid(), 'Filter by acting user.'), qp('action', str(), 'Exact action, e.g. `asset.checkout`.'), qp('request_id', str(), 'Everything done by one request.'), qp('from', dt(), 'At or after.'), qp('to', dt(), 'Before.')],
  success: { 200: { description: 'A page of audit entries.', headers: { 'X-Request-Id': H('RequestId') }, content: { 'application/json': { schema: S('AuditEntryList') }, 'text/csv': { schema: str() } } } },
});

// ================================================================ [M2-W2 NOT] BEGIN
// M2 wave 2, repairs / notifications / saved views / export / MFA policy (stories M2-MNT-01, M2-NOT-01,
// M2-REG-01, M2-REG-02, M2-AUTH-01). Everything of this wave lives in this block so parallel branches merge cleanly.
doc.tags.push(
  { name: 'Notifications', description: 'In-app notifications, per-user delivery preferences, tenant notification rules and the delivery log.' },
  { name: 'Views', description: 'Saved list views (filters, columns, sort), private or shared tenant-wide.' },
  { name: 'Exports', description: 'CSV exports of lists, produced by a background job and downloaded through a short-lived link.' },
);

// ---- M2-AUTH-01: the MFA policy of the organisation, as it applies to the caller
S_.Me.properties.mfa_policy = obj({
  required: bool({ description: 'True when the policy requires THIS user to have two-step verification (always false for API keys). While true, "Turn off" is refused with `403 mfa-required-by-policy`.' }),
  scope: en(['off', 'admins', 'all'], { description: 'Who the organisation requires to use two-step verification: nobody, administrators (roles holding `*` or `user:manage`), or everybody.' }),
}, ['required', 'scope'], { description: 'The organisation\'s MFA policy and whether it applies to the caller (M2-AUTH-01).' });
S_.Me.required.push('mfa_policy');

// ---- M2-MNT-01: repairs and maintenance
{
  const attachmentIds = arr(uuid(), { maxItems: 10, uniqueItems: true, description: 'Ids of attachments (photos, invoices) uploaded against the asset beforehand: they are re-pointed at this repair record.' });
  S_.RepairCreate.properties.attachment_ids = attachmentIds;
  S_.RepairCreate.properties.force_checkin = bool({ default: false, description: 'The asset is checked out: close its custody period (a check-in) and open the repair in one step. Needs `asset:checkin` as well as `repair:manage`, and `force_note`. Without it a checked-out asset is refused with `409 asset-already-checked-out` (check it in first).' });
  S_.RepairCreate.properties.force_note = str({ minLength: 1, maxLength: 500, description: 'Why the custody period is closed (recorded on the check-in, the history and the audit log). Required with `force_checkin`.' });
  S_.RepairCreate.properties.status = en(['open', 'in_progress'], { default: 'open', description: 'Initial status (`in_progress` also sets `started_at`). A record is closed by `POST /v1/repairs/{id}/complete` or by cancelling it.' });
  S_.RepairCreate.properties.set_status_id.description += ' Required with `force_checkin`.';
  // Sorting by the nullable `completed_at` is not supported (keyset cursors cannot carry a NULL).
  {
    const sortIndex = doc.paths['/v1/repairs'].get.parameters.findIndex((p) => p.name === 'sort');
    doc.paths['/v1/repairs'].get.parameters[sortIndex] = sortParam(['reported_at', 'created_at'], ['-reported_at']);
  }
  // The asset of a record never changes: open a new record for another asset.
  delete S_.RepairUpdate.properties.asset_id;
  S_.RepairUpdate.properties.status = en(['open', 'in_progress', 'cancelled'], { description: 'Move to `in_progress`, or `cancelled` (restores the asset status like a completion). A closed record (`completed`, `cancelled`) keeps its status.' });
  Object.assign(S_.Repair.properties, {
    set_status_id: ro(nuuid('The status label the asset was moved to when the repair opened (null when the repair did not move it).')),
    asset_tag: ro(nstr({ description: 'Tag of the asset, so lists can label their rows.' })),
    asset_name: ro(nstr()),
    vendor_name: ro(nstr()),
  });
  S_.RepairCompleteRequest.properties.attachment_ids = attachmentIds;
  S_.RepairSummary = obj({
    asset_id: uuid(),
    open_count: int({ description: 'Records in status `open` or `in_progress`.' }),
    total_count: int({ description: 'Records that are not cancelled or archived.' }),
    total_cost: arr(S('Money'), { description: 'Total recorded cost of the non-cancelled records, one entry per currency (amounts in different currencies are never added together).' }),
  }, ['asset_id', 'open_count', 'total_count', 'total_cost']);

  doc.paths['/v1/repairs'].post.description = [
    'Opens a repair or maintenance record for an asset.',
    '`set_status_id` (typically an `undeployable` label such as "In repair") moves the asset to that status and so blocks its check-out; the status the asset had before (or the tenant\'s default deployable one, when it was checked out) is remembered as `restore_status_id` and put back when the record is completed or cancelled. Only one open record at a time may move an asset\'s status (`409 conflict` otherwise). An asset whose status is already `undeployable` and that no open record holds (the status was set by hand) is asked to take the same status: the new record adopts it (`set_status_id` = that label) and puts the tenant\'s default deployable label back when it is completed or cancelled.',
    'A checked-out asset goes to repair through check-in first; with `force_checkin` and `force_note` (and the `asset:checkin` permission) the custody period is closed in the same transaction. A lost or retired asset, or an archived one, cannot be repaired (`409`).',
    'Writes a `repair_opened` history event, an audit row and the outbox event `repair.opened`. Requires permission `repair:manage`.',
  ].join('\n\n');
  doc.paths['/v1/repairs'].post.responses['409'] = specificProblem('409', ['asset-already-checked-out', 'conflict', 'idempotency-key-in-flight'], 'The asset is checked out (check it in or use `force_checkin`), is lost, retired or archived, or another open repair already moved its status.');
  doc.paths['/v1/repairs/{id}'].patch.description = 'Edit a record (RFC 7396 merge). `status` may move to `in_progress` or `cancelled`; cancelling restores the asset status. The asset cannot change. Closed records stay editable except for their status. Requires permission `repair:manage`.';
  doc.paths['/v1/repairs/{id}'].delete.description = 'Soft delete. `409` while the record is open or in progress (cancel or complete it first).\n\nRequires permission `repair:manage`.';
  doc.paths['/v1/repairs/{id}/complete'].post.description = 'Sets `completed_at` and status `completed`, records cost and resolution, and restores the asset status: the explicit `restore_status_id` of the request, else the one remembered when the repair opened, but only when the asset still has the status the repair moved it to (a status someone chose meanwhile is left alone). Writes a `repair_completed` history event, an audit row and the outbox event `repair.completed`. `409` when the record is already closed.\n\nRequires permission `repair:manage`.';
  addOp('/v1/assets/{id}/repair-summary', 'get', {
    tag: 'Repairs', id: 'getAssetRepairSummary', summary: 'Repair totals of an asset', perm: 'repair:read', params: [ID],
    description: 'Counts and the total recorded cost per currency of the asset\'s repair and maintenance records (cancelled and archived records excluded).',
    success: { 200: okResp(200, 'The totals.', S('RepairSummary'), { replay: false }) },
  });
}

// ---- M2-NOT-01: notifications
{
  const TYPE_PARAM = { name: 'type', in: 'path', required: true, description: 'Notification type, e.g. `attachment.infected` (see `GET /v1/notification-preferences`).', schema: str({ pattern: '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$', maxLength: 64 }) };
  const EMAIL_MODE = en(['immediate', 'digest', 'off'], { description: '`immediate`: one email per notification (more than a handful per hour are folded into the digest); `digest`: collected into one daily email (at most 50 items listed); `off`: no email.' });
  S_.Notification = obj({
    id: uuid(),
    type: str({ description: 'Notification type (the domain event it comes from), e.g. `attachment.infected`.' }),
    title: str(),
    body: nstr(),
    link: nstr({ description: 'Path inside the web app that shows the subject, e.g. `/assets/view?id=...`.' }),
    entity_type: nstr(),
    entity_id: nuuid(),
    created_at: dt(),
    read_at: ndt(),
  }, ['id', 'type', 'title', 'body', 'link', 'entity_type', 'entity_id', 'created_at', 'read_at']);
  S_.NotificationList = obj({ data: arr(S('Notification')), page: S('PageInfo') }, ['data', 'page']);
  S_.NotificationUnreadCount = obj({ count: int({ minimum: 0 }) }, ['count']);
  S_.NotificationReadAllResult = obj({ updated: int({ minimum: 0, description: 'Notifications that were unread and are now read.' }) }, ['updated']);
  S_.NotificationPreference = obj({
    type: str(),
    label: str(),
    description: str(),
    in_app: bool({ description: 'Show in the notification bell.' }),
    email: EMAIL_MODE,
    is_default: bool({ description: 'True while the user has not chosen: the values are the type\'s defaults.' }),
  }, ['type', 'label', 'description', 'in_app', 'email', 'is_default']);
  S_.NotificationPreferenceList = obj({ data: arr(S('NotificationPreference')) }, ['data']);
  S_.NotificationPreferenceUpdate = obj({ in_app: bool(), email: EMAIL_MODE }, [], { additionalProperties: false, description: 'At least one field.' });
  S_.NotificationRule = obj({
    type: str(),
    label: str(),
    description: str(),
    enabled: bool({ description: 'When false the type produces no notification for anybody in this organisation.' }),
    recipients: str({ description: 'Who gets it by default, in words.' }),
    role_configurable: bool({ description: 'True when `recipient_roles` can replace the default recipients (types addressed to users that hold a permission).' }),
    recipient_roles: { type: ['array', 'null'], items: str(), description: 'Role keys that receive it instead of the default recipients; null = the default.' },
    updated_at: ndt(),
  }, ['type', 'label', 'description', 'enabled', 'recipients', 'role_configurable', 'recipient_roles', 'updated_at']);
  S_.NotificationRuleList = obj({ data: arr(S('NotificationRule')) }, ['data']);
  S_.NotificationRuleUpdate = obj({
    enabled: bool(),
    recipient_roles: { type: ['array', 'null'], items: str({ pattern: '^[a-z][a-z0-9_]{1,62}$' }), maxItems: 20, description: 'Role keys, or null to go back to the default recipients. Only for `role_configurable` types.' },
  }, [], { additionalProperties: false, description: 'At least one field.' });
  S_.NotificationDelivery = obj({
    id: uuid(),
    notification_id: nuuid(),
    user_id: uuid(),
    type: str(),
    channel: en(['in_app', 'email']),
    status: en(['delivered', 'queued', 'deferred', 'skipped', 'failed']),
    reason: nstr({ description: 'Why a delivery was skipped or deferred, e.g. `preference-off`, `no-email`, `throttled`, `digest`.' }),
    created_at: dt(),
  }, ['id', 'notification_id', 'user_id', 'type', 'channel', 'status', 'reason', 'created_at'], { description: '`queued` = handed to the mail queue (the mail job has its own retries and dead-letter list).' });
  S_.NotificationDeliveryList = obj({ data: arr(S('NotificationDelivery')), page: S('PageInfo') }, ['data', 'page']);

  const SELF = { 403: { codes: ['forbidden'], text: 'Needs a browser session, not an API key.' } };
  const SELF_MUTATE = { 403: { codes: ['forbidden', 'csrf-invalid'], text: 'Needs a browser session with a valid `X-CSRF-Token`.' } };
  addOp('/v1/notifications', 'get', {
    tag: 'Notifications', id: 'listNotifications', summary: 'My notifications', selfService: true, hasId: false,
    description: 'The caller\'s in-app notifications, newest first.',
    params: [P('Cursor'), P('Limit'), qp('unread', bool(), 'true = only unread ones.')],
    problems: SELF,
    success: { 200: okResp(200, 'A page of notifications.', S('NotificationList'), { replay: false }) },
  });
  addOp('/v1/notifications/unread-count', 'get', {
    tag: 'Notifications', id: 'getNotificationUnreadCount', summary: 'Number of unread notifications', selfService: true, hasId: false,
    problems: SELF,
    success: { 200: okResp(200, 'The count (for the bell badge).', S('NotificationUnreadCount'), { replay: false }) },
  });
  addOp('/v1/notifications/read-all', 'post', {
    tag: 'Notifications', id: 'markAllNotificationsRead', summary: 'Mark every notification read', selfService: true, hasId: false, conflict: false,
    problems: SELF_MUTATE,
    success: { 200: okResp(200, 'How many were updated.', S('NotificationReadAllResult')) },
  });
  addOp('/v1/notifications/{id}/read', 'post', {
    tag: 'Notifications', id: 'markNotificationRead', summary: 'Mark a notification read', selfService: true, params: [ID], conflict: false,
    description: 'Idempotent: an already-read notification keeps its first `read_at`. Another user\'s notification is `404`.',
    problems: SELF_MUTATE,
    success: { 200: okResp(200, 'The notification.', S('Notification')) },
  });
  addOp('/v1/notification-preferences', 'get', {
    tag: 'Notifications', id: 'listNotificationPreferences', summary: 'My notification preferences', selfService: true, hasId: false,
    description: 'One entry per notification type, with the caller\'s choice (or the default).',
    problems: SELF,
    success: { 200: okResp(200, 'Preferences.', S('NotificationPreferenceList'), { replay: false }) },
  });
  addOp('/v1/notification-preferences/{type}', 'put', {
    tag: 'Notifications', id: 'updateNotificationPreference', summary: 'Set my preference for a type', selfService: true, params: [TYPE_PARAM], conflict: false, hasId: true,
    description: 'Chooses in-app and email delivery (`immediate`, `digest`, `off`) for one notification type. Omitted fields keep their current value (or the default).',
    body: jsonBody(S('NotificationPreferenceUpdate')),
    problems: SELF_MUTATE,
    success: { 200: okResp(200, 'The preference.', S('NotificationPreference')) },
  });
  addOp('/v1/notification-rules', 'get', {
    tag: 'Notifications', id: 'listNotificationRules', summary: 'Notification rules of the organisation', perm: 'notification:manage', hasId: false,
    description: 'Every notification type with whether it is enabled and who receives it.',
    success: { 200: okResp(200, 'Rules.', S('NotificationRuleList'), { replay: false }) },
  });
  addOp('/v1/notification-rules/{type}', 'put', {
    tag: 'Notifications', id: 'updateNotificationRule', summary: 'Enable, disable or re-address a type', perm: 'notification:manage', params: [TYPE_PARAM], conflict: false, hasId: true,
    body: jsonBody(S('NotificationRuleUpdate')),
    success: { 200: okResp(200, 'The rule.', S('NotificationRule')) },
  });
  addOp('/v1/notification-deliveries', 'get', {
    tag: 'Notifications', id: 'listNotificationDeliveries', summary: 'Delivery log', perm: 'notification:manage', hasId: false,
    description: 'What was delivered, queued, deferred (digest) or skipped, newest first.',
    params: [P('Cursor'), P('Limit'), qp('user_id', uuid(), 'Recipient.'), qp('type', str(), 'Notification type.'), qp('channel', en(['in_app', 'email']), 'Channel.'), arrQ('status', en(['delivered', 'queued', 'deferred', 'skipped', 'failed']), 'Status.'), qp('from', dt(), 'At or after.'), qp('to', dt(), 'Before.')],
    success: { 200: okResp(200, 'A page of deliveries.', S('NotificationDeliveryList'), { replay: false }) },
  });
}

// ---- M2-REG-01: saved views
{
  S_.SavedView = obj({
    id: uuid(),
    resource: en(['assets'], { description: 'The list the view belongs to.' }),
    name: str({ minLength: 1, maxLength: 100 }),
    filters: { type: 'object', additionalProperties: true, description: 'The list filters as the client keeps them (opaque to the server apart from the id references checked for `warnings`).' },
    columns: arr(str({ maxLength: 64 }), { maxItems: 40, description: 'Visible column ids in display order.' }),
    sort: nstr({ maxLength: 64, description: 'Sort key with `-` for descending, or null for the default.' }),
    is_shared: bool({ description: 'Visible to everybody in the organisation.' }),
    is_owner: bool({ description: 'The caller created it (only the owner edits it).' }),
    owner: obj({ id: uuid(), display_name: str() }, ['id', 'display_name']),
    warnings: arr(obj({ field: str(), id: uuid(), reason: en(['not-found', 'archived']) }, ['field', 'id', 'reason']), { description: 'Id references in `filters` (status, category, location, model, vendor, person) that no longer resolve: the client applies the rest of the view and shows a warning.' }),
    created_at: dt(),
    updated_at: dt(),
  }, ['id', 'resource', 'name', 'filters', 'columns', 'sort', 'is_shared', 'is_owner', 'owner', 'warnings', 'created_at', 'updated_at']);
  S_.SavedViewList = obj({ data: arr(S('SavedView')), page: S('PageInfo') }, ['data', 'page']);
  const viewProps = {
    name: str({ minLength: 1, maxLength: 100 }),
    filters: { type: 'object', additionalProperties: true, description: 'At most 16 KiB of JSON.' },
    columns: arr(str({ maxLength: 64 }), { maxItems: 40 }),
    sort: nstr({ maxLength: 64 }),
  };
  S_.SavedViewCreate = obj({ resource: en(['assets'], { default: 'assets' }), ...viewProps }, ['name'], { additionalProperties: false });
  S_.SavedViewUpdate = obj({ ...viewProps }, [], { additionalProperties: false, description: 'Partial update (RFC 7396 merge semantics).' });
  S_.SavedViewShare = obj({ shared: bool() }, ['shared'], { additionalProperties: false });
  const VIEW_403 = { 403: { codes: ['forbidden', 'csrf-invalid'], text: 'Needs a browser session with a valid `X-CSRF-Token`.' } };
  addOp('/v1/saved-views', 'get', {
    tag: 'Views', id: 'listSavedViews', summary: 'Saved views I can use', selfService: true, hasId: false,
    description: 'The caller\'s own views plus the views shared in the organisation, ordered by name (`is_owner` tells them apart).',
    params: [P('Cursor'), P('Limit'), qp('resource', en(['assets']), 'The list (default `assets`).'), qp('scope', en(['all', 'mine', 'shared']), '`mine` = created by the caller, `shared` = shared by anybody, `all` (default) = both.')],
    problems: { 403: { codes: ['forbidden'], text: 'Needs a browser session, not an API key.' } },
    success: { 200: okResp(200, 'A page of views.', S('SavedViewList'), { replay: false }) },
  });
  addOp('/v1/saved-views', 'post', {
    tag: 'Views', id: 'createSavedView', summary: 'Save a view', selfService: true, hasId: false,
    description: 'Creates a private view. The name is unique among the caller\'s views of the list (`409`); at most 50 per user and list. Share it afterwards with `PUT /v1/saved-views/{id}/sharing`.',
    body: jsonBody(S('SavedViewCreate')),
    problems: VIEW_403,
    success: { 201: okResp(201, 'View saved.', S('SavedView'), { etag: true, location: true }) },
  });
  addOp('/v1/saved-views/{id}', 'get', {
    tag: 'Views', id: 'getSavedView', summary: 'Get a saved view', selfService: true, params: [ID],
    description: 'An own view or a shared one; anybody else\'s private view is `404`.',
    problems: { 403: { codes: ['forbidden'], text: 'Needs a browser session, not an API key.' } },
    success: { 200: okResp(200, 'The view.', S('SavedView'), { etag: true, replay: false }) },
  });
  addOp('/v1/saved-views/{id}', 'patch', {
    tag: 'Views', id: 'updateSavedView', summary: 'Rename or change a view', selfService: true, params: [ID], ifMatch: true,
    description: 'Only the owner (`404` for anybody else, also for a shared view). A shared view stays shared.',
    body: jsonBody(S('SavedViewUpdate')),
    problems: VIEW_403,
    success: { 200: okResp(200, 'The view.', S('SavedView'), { etag: true }) },
  });
  addOp('/v1/saved-views/{id}', 'delete', {
    tag: 'Views', id: 'deleteSavedView', summary: 'Delete a view', selfService: true, params: [ID], ifMatch: true, conflict: false,
    description: 'Deletes the view for good. Only the owner (`404` for anybody else).',
    problems: VIEW_403,
    success: { 204: okResp(204, 'Deleted.') },
  });
  addOp('/v1/saved-views/{id}/sharing', 'put', {
    tag: 'Views', id: 'shareSavedView', summary: 'Share a view with the organisation, or stop sharing', perm: 'view:share', params: [ID], ifMatch: true,
    description: 'Owner only. A shared view is visible to every user of the organisation (read only, they can copy it). The name must be unique among the shared views of the list (`409`).',
    body: jsonBody(S('SavedViewShare')),
    success: { 200: okResp(200, 'The view.', S('SavedView'), { etag: true }) },
  });
}

// ---- M2-REG-02: CSV export of lists
{
  const FILTER_NOTE = 'The same query parameters as the list endpoint (`GET /v1/assets`, `/v1/people` or `/v1/locations`) without paging (`limit`, `cursor`, `include_total`, `fields`, `expand`), as a flat object: arrays are sent as arrays of strings, booleans and numbers as such; custom-field filters as `"cf[key]": "value"`.';
  S_.ExportCreate = obj({
    resource: en(['assets', 'people', 'locations']),
    format: en(['csv'], { default: 'csv' }),
    filters: { type: 'object', additionalProperties: { oneOf: [str(), { type: 'number' }, bool(), arr(str())] }, description: FILTER_NOTE },
  }, ['resource'], { additionalProperties: false });
  S_.Export = obj({
    id: uuid(),
    resource: en(['assets', 'people', 'locations']),
    format: en(['csv']),
    status: en(['queued', 'running', 'succeeded', 'failed', 'expired']),
    filters: { type: 'object', additionalProperties: true, description: 'The filters the export was requested with (normalised to query-string form).' },
    row_count: { type: ['integer', 'null'], minimum: 0 },
    size_bytes: { type: ['integer', 'null'], minimum: 0 },
    filename: nstr(),
    error: nstr({ description: 'Why a failed export failed (a sentence without internals).' }),
    requested_by: uuid(),
    created_at: dt(),
    started_at: ndt(),
    completed_at: ndt(),
    expires_at: ndt({ description: 'The file is deleted at this time (24 hours after completion).' }),
    download_url: nstr({ format: 'uri', description: 'Short-lived link to the CSV file; only while `status=succeeded`. A new link is issued by every `GET /v1/exports/{id}` and each issue is audited as a sensitive read.' }),
    download_expires_at: ndt(),
  }, ['id', 'resource', 'format', 'status', 'filters', 'row_count', 'size_bytes', 'filename', 'error', 'requested_by', 'created_at', 'started_at', 'completed_at', 'expires_at', 'download_url', 'download_expires_at']);
  S_.ExportList = obj({ data: arr(S('Export')), page: S('PageInfo') }, ['data', 'page']);
  addOp('/v1/exports', 'post', {
    tag: 'Exports', id: 'createExport', summary: 'Export a list to CSV', perm: 'export:run', hasId: false,
    description: [
      'Queues a background job that writes every row matching `filters` to a UTF-8 CSV file (with a byte order mark, CRLF line ends, a header row) and stores it for 24 hours. Poll `GET /v1/exports/{id}` until `status=succeeded`, then use `download_url`.',
      'The caller also needs the read permission of the list (`asset:read`, `person:read` or `location:read`, `403` otherwise). Cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return get a leading apostrophe so spreadsheets never run them as formulas. Asset exports include one `cf:<key>` column per custom field. At most 100,000 rows. Requested and downloaded exports are audited (sensitive read).',
      FILTER_NOTE,
    ].join('\n\n'),
    body: jsonBody(S('ExportCreate')),
    problems: { 403: { codes: ['forbidden', 'csrf-invalid'], text: 'Missing `export:run` or the read permission of the list.' } },
    success: { 202: { description: 'Export queued.', headers: { 'X-Request-Id': H('RequestId'), Location: H('Location'), 'Retry-After': H('RetryAfter'), 'Idempotent-Replayed': H('IdempotentReplayed') }, content: { 'application/json': { schema: S('Export') } } } },
  });
  addOp('/v1/exports', 'get', {
    tag: 'Exports', id: 'listExports', summary: 'My exports', perm: 'export:run', hasId: false,
    description: 'The caller\'s exports, newest first. `download_url` is never set in a list; fetch one export for a link.',
    params: [P('Cursor'), P('Limit'), arrQ('status', en(['queued', 'running', 'succeeded', 'failed', 'expired']), 'Filter by status.')],
    success: { 200: okResp(200, 'A page of exports.', S('ExportList'), { replay: false }) },
  });
  addOp('/v1/exports/{id}', 'get', {
    tag: 'Exports', id: 'getExport', summary: 'Get an export', perm: 'export:run', params: [ID],
    description: 'Status of one export. For a succeeded one it issues a fresh short-lived `download_url` (audited as a sensitive read). Another user\'s export is `404`.',
    success: { 200: okResp(200, 'The export.', S('Export'), { replay: false }) },
  });
}
// ================================================================ [M2-W2 NOT] END

// ================================================================ [M2-W3 IMP] BEGIN
// M2-IMP-01..07: CSV / XLSX import with a mandatory dry run (ED-18, ADR 0010). Replaces the contract-only
// placeholders of the first drafts (states draft..committed, source snipe_it, `match_on` options).
{
  const ENTITY = ['asset', 'person', 'location', 'department'];
  const STATES = ['draft', 'uploaded', 'analyzing', 'analyzed', 'mapped', 'dry_running', 'dry_run_done', 'committing', 'completed', 'failed', 'cancelled'];
  const REFS = ['category', 'manufacturer', 'model', 'status', 'location', 'department', 'vendor', 'person'];
  const DATE_FORMATS = ['auto', 'iso', 'dmy', 'mdy'];
  const optionProps = {
    match_on: en(['auto', 'asset_tag', 'serial', 'external_id'], { default: 'auto', description: 'Assets: how an existing asset is found. `auto` = the tag when the row has one, else the serial number (a tag and a serial that name different assets is a row error).' }),
    on_match: en(['skip', 'update', 'error'], { default: 'skip', description: 'What to do with a row whose record exists already, and with a row that repeats an earlier row of the file (same tag, serial, email, path or name): leave it, update it with the cells of the file, or report an error.' }),
    blank_cells: en(['ignore', 'clear'], { default: 'ignore', description: 'Update only: an empty cell leaves the field alone, or empties it.' }),
    date_format: en(DATE_FORMATS, { default: 'auto', description: '`auto` reads ISO dates, month names and unambiguous day/month dates; `03/04/2024` needs `dmy` or `mdy`.' }),
    number_format: en(['auto', 'dot', 'comma'], { default: 'auto', description: 'The decimal separator of numbers in the file; `auto` decides where the text is unambiguous (`1.234,50`, `1,234.50`) and reads `1,234` as a thousand.' }),
    default_currency: str({ pattern: '^[A-Z]{3}$', description: 'Currency of costs that name none; else the organisation\'s base currency.' }),
    external_source: str({ maxLength: 100, description: 'Source recorded with a mapped external id (default `import`; the Google preset uses `google_admin`).' }),
    references: { type: 'object', additionalProperties: en(['create', 'must_exist']), description: 'Per reference kind (`category`, `manufacturer`, `model`, `status`, `location`, `department`, `vendor`, `person`): create what is missing, or require it to exist. Defaults: `create`, except `status` and `person` (`must_exist`; a status label is never created).' },
    defaults: obj({ category: uuid(), status: uuid(), location: uuid(), department: uuid(), vendor: uuid() }, [], { additionalProperties: false, description: 'Ids used when a row\'s own cell is empty.' }),
    location_kind: en(['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'], { default: 'other', description: 'Kind of the locations the import creates.' }),
    assign: bool({ default: true, description: 'Assets: check an asset out to the person in `assigned_to` (only when it can be checked out; otherwise a warning).' }),
    detect_changes: bool({ default: true, description: 'Update only: a record edited after the dry run is not touched (row error `changed-since-dry-run`).' }),
  };
  S_.ImportOptions = obj(optionProps, [], { additionalProperties: false });
  S_.ImportMappingColumn = obj({
    index: int({ minimum: 0, maximum: 499, description: '0-based column of the file.' }),
    target: nstr({ maxLength: 80, description: 'A field of the entity (`GET /v1/imports/presets` lists them), `cf:<custom field key>` for an asset custom field, or null to ignore the column.' }),
    date_format: en(DATE_FORMATS, { description: 'Overrides the job\'s date format for this column.' }),
  }, ['index', 'target'], { additionalProperties: false });
  S_.ImportMapping = obj({
    columns: arr(S('ImportMappingColumn')),
    constants: { type: 'object', additionalProperties: str({ minLength: 1, maxLength: 300 }), description: 'Text for a target that has no column (`{"category": "Chromebook"}`), used for every row whose own cell is empty.' },
  }, ['columns'], { additionalProperties: false });
  S_.ImportValueEntry = {
    oneOf: [
      obj({ id: uuid() }, ['id'], { additionalProperties: false, description: 'Use this existing record.' }),
      obj({ create: { const: true }, name: str({ minLength: 1, maxLength: 200 }) }, ['create'], { additionalProperties: false, description: 'Create it (under this name, default the text of the cell).' }),
      obj({ skip: { const: true } }, ['skip'], { additionalProperties: false, description: 'Treat the cell as empty.' }),
    ],
  };
  S_.ImportValueMap = { type: 'object', additionalProperties: { type: 'object', additionalProperties: S('ImportValueEntry') }, description: 'By reference kind, then by the NORMALISED source value (trimmed, spaces collapsed, lower case): what that value of the file means.' };
  S_.ImportParse = obj({
    format: nstr({ description: '`csv` or `xlsx`.' }),
    encoding: nstr({ description: 'CSV: `utf-8`, `utf-16le`, `utf-16be` or `windows-1252` (detected).' }),
    delimiter: nstr({ description: 'CSV: `,` `;` tab or `|` (detected).' }),
    sheet: nstr({ description: 'XLSX: the sheet that is read (default: the first visible one).' }),
    sheets: { type: ['array', 'null'], items: str(), description: 'XLSX: the visible sheets.' },
    header_line: { type: ['integer', 'null'], description: 'Row (XLSX) or line (CSV) number of the header row.' },
  }, ['format', 'encoding', 'delimiter', 'sheet', 'sheets', 'header_line']);
  S_.ImportColumnProfile = obj({
    index: int(), header: str(), non_blank: int(), blank: int(), distinct: int(),
    distinct_capped: bool({ description: 'More than 10,000 distinct values: `distinct` is a lower bound.' }),
    duplicates: int({ description: 'Non-blank cells that repeat an earlier value.' }),
    type: en(['empty', 'integer', 'number', 'date', 'boolean', 'email', 'text']),
    date_order: { type: ['string', 'null'], enum: ['iso', 'dmy', 'mdy', 'ambiguous', 'mixed', null], description: 'Date columns: the order the data allows; `ambiguous` needs an explicit date format.' },
    max_length: int(), samples: arr(str(), { description: 'Up to five distinct values.' }),
  }, ['index', 'header', 'non_blank', 'blank', 'distinct', 'distinct_capped', 'duplicates', 'type', 'date_order', 'max_length', 'samples']);
  S_.RowIssue = obj({
    field: nstr({ description: 'The target field the problem belongs to (`serial`, `cf:os_version`), or null for the row as a whole.' }),
    message: str(), code: str({ description: 'Stable code: `required`, `not-found`, `ambiguous-date`, `number`, `exists`, `duplicate-in-file`, `changed-since-dry-run`, `will-create`, `validated-at-commit`, `unchanged`...' }),
  }, ['field', 'message', 'code']);
  S_.ImportJob = obj({
    id: uuid(),
    entity_type: en(ENTITY),
    source: en(['csv', 'xlsx', 'google_admin_csv']),
    preset_key: nstr({ description: 'The built-in preset the import was created from (`GET /v1/imports/presets`).' }),
    state: en(STATES, { description: 'draft (no file yet) -> uploaded -> analyzing -> analyzed -> mapped -> dry_running -> dry_run_done -> committing -> completed; `failed` and `cancelled` end it. Editing the mapping or options returns `dry_run_done` to `mapped`.' }),
    filename: nstr(),
    file_attachment_id: nuuid('The uploaded file: an attachment of kind `import_file` owned by this import.'),
    parse: S('ImportParse'),
    headers: { type: ['array', 'null'], items: str(), description: 'Header names of the file, after analysis.' },
    mapping: S('ImportMapping'),
    options: S('ImportOptions'),
    rows_total: int({ description: 'Data rows of the file.' }),
    counts: obj({
      dry_run: obj({ create: int(), update: int(), skip: int(), error: int() }, ['create', 'update', 'skip', 'error']),
      commit: obj({ created: int(), updated: int(), skipped: int(), error: int() }, ['created', 'updated', 'skipped', 'error']),
    }, ['dry_run', 'commit']),
    progress: obj({
      phase: { type: ['string', 'null'], enum: ['analyze', 'dry_run', 'commit', null] },
      processed: int(), total: int(), percent: int({ minimum: 0, maximum: 100 }),
    }, ['phase', 'processed', 'total', 'percent']),
    dry_run_digest: nstr({ description: 'Digest of the reviewed dry run (file, parse settings, mapping, options, value map and every row\'s outcome). Quote it in the commit request.' }),
    dry_run_at: ndt(), committed_at: ndt(), started_at: ndt(), finished_at: ndt(),
    data_purged_at: ndt({ description: 'When the retention job removed the rows of the file, the profile, the sample rows, the value map and the uploaded file of this finished import (ED-25); null while they are kept. The counts, summary, mapping and options stay.' }),
    cancel_requested: bool(),
    error: nstr({ description: 'Why a failed import failed (a sentence; for a bad file it names the line).' }),
    summary: { type: ['object', 'null'], additionalProperties: true, description: 'After a dry run: `counts`, `errors_by_code`, `skipped_by_code` (why rows are skipped, `[{ code, n }]`: `exists`, `unchanged`, `duplicate-in-file`, `summary-row`; ED-40), `will_create` (references the commit would create, with counts) and `validated_at_commit` (rows whose last checks wait for the commit: a location below a parent the same import creates, ED-29). On a preset import: `setup` (what creating the import created).' },
    requested_by: uuid(),
    created_at: dt(), updated_at: dt(),
    profile: { type: ['array', 'null'], items: S('ImportColumnProfile'), description: 'Per-column statistics (only on a single import, not in lists). Without `import:run` the `samples` of each column are empty.' },
    samples: { type: ['array', 'null'], items: arr(str()), description: 'The first 50 data rows (only on a single import; null without `import:run`: they are cells of the file).' },
    confidence: { type: ['object', 'null'], additionalProperties: { type: 'number' }, description: 'How sure the suggested mapping is per column index (1 = exact header match).' },
    value_map: { ...S('ImportValueMap'), description: 'Empty without `import:run` (its keys are values of the file).' },
  }, ['id', 'entity_type', 'source', 'preset_key', 'state', 'filename', 'file_attachment_id', 'parse', 'headers', 'mapping', 'options', 'rows_total', 'counts', 'progress', 'dry_run_digest', 'dry_run_at', 'committed_at', 'started_at', 'finished_at', 'data_purged_at', 'cancel_requested', 'error', 'summary', 'requested_by', 'created_at', 'updated_at']);
  S_.ImportList = obj({ data: arr(S('ImportJob')), page: S('PageInfo') }, ['data', 'page']);
  S_.ImportCreate = obj({
    entity_type: en(ENTITY),
    preset_key: str({ minLength: 1, maxLength: 64, description: 'A built-in preset of the same entity type. `google_admin_chromeos` creates the Chromebook category and its custom fields when they do not exist (needs `catalog:manage` then); it maps the org unit path to the department (one value-map entry per unit, created when missing: `department:manage`) and Disabled / Deprovisioned devices to the archived (Retired) status (ED-29).' }),
    options: S('ImportOptions'),
  }, ['entity_type'], { additionalProperties: false });
  S_.ImportUpdate = obj({
    mapping: S('ImportMapping'),
    options: { ...S('ImportOptions'), description: 'Only the options to change; `references` and `defaults` are merged by key.' },
    value_map: { ...S('ImportValueMap'), description: 'Replaces the entries of each reference kind given (send `{}` for a kind to clear it).' },
  }, [], { additionalProperties: false, description: 'Any change returns a `dry_run_done` import to `mapped` and invalidates the digest. Allowed in `draft`, `uploaded`, `analyzed`, `mapped` and `dry_run_done`.' });
  S_.ImportAnalyze = obj({
    file_attachment_id: uuid('Attachment of kind `import_file` owned by this import, uploaded and completed. Omit to analyse the file again.'),
    parse: obj({
      encoding: en(['utf-8', 'utf-16le', 'utf-16be', 'windows-1252']), delimiter: en([',', ';', '\t', '|']),
      sheet: str({ minLength: 1, maxLength: 100 }), header_line: int({ minimum: 1, maximum: 100000 }),
    }, [], { additionalProperties: false, description: 'Overrides of what the analysis detects.' }),
  }, [], { additionalProperties: false });
  S_.ImportCommit = obj({ dry_run_digest: str({ pattern: '^[0-9a-f]{64}$', description: 'The `dry_run_digest` of the dry run the user reviewed.' }) }, ['dry_run_digest'], { additionalProperties: false });
  S_.ImportRow = obj({
    row_no: int({ minimum: 1, description: 'Position among the data rows.' }),
    line_no: int({ minimum: 1, description: 'Line (CSV) or row (XLSX) of the file; shown in error messages.' }),
    phase: en(['dry_run', 'commit']),
    outcome: nstr({ description: 'Dry run: `create` / `update` / `skip` / `error`. Commit: `created` / `updated` / `skipped` / `error`.' }),
    plan: { type: ['string', 'null'], enum: ['create', 'update', 'skip', 'error', null] },
    result: { type: ['string', 'null'], enum: ['created', 'updated', 'skipped', 'error', null] },
    entity_id: nuuid('The existing record an update changes.'),
    created_id: nuuid('The record the commit created.'),
    duplicate_of: { type: ['integer', 'null'], description: 'Row number of the first row of the file with the same key.' },
    errors: arr(S('RowIssue')), warnings: arr(S('RowIssue')),
    source: { type: 'object', additionalProperties: str(), description: 'The non-empty cells of the row by header.' },
    mapped: { type: ['object', 'null'], additionalProperties: true, description: 'The typed record the mapping produced (`f` fields, `r` references, `c` custom fields).' },
    before_image: { type: ['object', 'null'], additionalProperties: true, description: 'Commit of an update: the values it replaced (kept for import undo, v1.1).' },
  }, ['row_no', 'line_no', 'phase', 'outcome', 'plan', 'result', 'entity_id', 'created_id', 'duplicate_of', 'errors', 'warnings', 'source', 'mapped', 'before_image']);
  S_.ImportRowList = obj({ data: arr(S('ImportRow')), page: S('PageInfo') }, ['data', 'page']);
  S_.ImportValue = obj({
    value: str({ description: 'A distinct value of the column (trimmed).' }), count: int(),
    suggestion: { type: ['object', 'null'], properties: { id: uuid(), name: str() }, required: ['id', 'name'], description: 'The existing record the value resolves to by name, by the rules of the dry run (a model inside the category of its rows; a bare location name counting the locations this import creates). Null when nothing matches (the import creates it or reports the rows, by the kind\'s policy) and when `issue` is set.' },
    issue: { type: ['object', 'null'], properties: { code: str({ description: '`ambiguous` (a bare location name that several locations have, counting those the import creates) or `invalid` (a model that exists only in another category than its rows\').' }), message: str(), rows: int({ minimum: 0, description: '[ED-40] How many of the value\'s rows will fail (at most `count`): for a model only the rows whose category it is not in.' }), categories: arr(str(), { description: '[ED-40] For a model: the categories, as the file writes them, of the rows that will fail. Empty otherwise.' }) }, required: ['code', 'message', 'rows', 'categories'], description: '[ED-37] Why the rows of this value will fail the dry run although a record of that name exists: they need a decision (map the value, or the category, or write the full path). Null otherwise.' },
    entry: { oneOf: [S('ImportValueEntry'), { type: 'null' }], description: 'What the value map says now.' },
  }, ['value', 'count', 'suggestion', 'issue', 'entry']);
  S_.ImportValues = obj({ field: en(REFS), column: nstr(), distinct: int({ description: 'Distinct values in the column (`data` is capped by `limit`).' }), data: arr(S('ImportValue')) }, ['field', 'column', 'distinct', 'data']);
  S_.ImportPresetColumn = obj({ column: str(), target: str(), description: str(), required: str(), example: str() }, ['column', 'target', 'description', 'required', 'example']);
  S_.ImportPreset = obj({
    key: str(), label: str(), description: str(), entity_type: en(ENTITY), source: en(['csv', 'google_admin_csv']),
    notes: arr(str()),
    sets_up: { type: ['object', 'null'], properties: { category: str(), custom_fields: arr(str()) }, required: ['category', 'custom_fields'], description: 'Reference data creating an import from this preset creates when it is missing.' },
    columns: arr(S('ImportPresetColumn'), { description: 'The columns of the template with their data dictionary.' }),
  }, ['key', 'label', 'description', 'entity_type', 'source', 'notes', 'sets_up', 'columns']);
  S_.ImportPresetList = obj({ data: arr(S('ImportPreset')) }, ['data']);
  S_.ImportTemplateColumn = obj({ header: str({ minLength: 1, maxLength: 200 }), target: nstr({ maxLength: 80 }), date_format: en(DATE_FORMATS) }, ['header', 'target'], { additionalProperties: false });
  S_.ImportTemplate = obj({
    id: uuid(), name: str(), description: nstr(), entity_type: en(ENTITY),
    columns: arr(S('ImportTemplateColumn')), options: S('ImportOptions'),
    created_at: dt(), updated_at: dt(), created_by: nuuid(),
  }, ['id', 'name', 'description', 'entity_type', 'columns', 'options', 'created_at', 'updated_at', 'created_by']);
  S_.ImportTemplateList = obj({ data: arr(S('ImportTemplate')), page: S('PageInfo') }, ['data', 'page']);
  S_.ImportTemplateCreate = obj({
    name: str({ minLength: 1, maxLength: 100 }), description: nstr({ maxLength: 1000 }), entity_type: en(ENTITY),
    columns: arr(S('ImportTemplateColumn')), options: S('ImportOptions'),
    from_import_id: uuid('Copy the mapping (by header) and the options of this import instead of `entity_type` and `columns`.'),
  }, ['name'], { additionalProperties: false, description: 'Either `from_import_id`, or `entity_type` and `columns`.' });
  S_.ImportTemplateUpdate = obj({
    name: str({ minLength: 1, maxLength: 100 }), description: nstr({ maxLength: 1000 }),
    columns: arr(S('ImportTemplateColumn')), options: S('ImportOptions'),
  }, [], { additionalProperties: false });
  S_.ImportTemplateApply = obj({ template_id: uuid() }, ['template_id'], { additionalProperties: false });

  const importProblems = {
    409: { codes: ['import-wrong-state', 'import-stale-dry-run', 'conflict'], text: 'The import is not in a state that allows this (`import-wrong-state`, with `state` and `allowed`), or the digest is not the reviewed dry run (`import-stale-dry-run`).' },
    429: { codes: ['import-quota-exceeded', 'too-many-requests'], text: 'Too many imports are running at once (`import-quota-exceeded`, see `Retry-After`) or the general rate limit.' },
  };
  const queued = (text) => ({ 202: { description: text, headers: { 'X-Request-Id': H('RequestId'), Location: H('Location'), 'Retry-After': H('RetryAfter') }, content: { 'application/json': { schema: S('ImportJob') } } } });
  const IMPORT_NOTE = 'Every long step is a background job: poll `GET /v1/imports/{id}` (`state`, `progress`, `counts`) until it leaves the running state. Nothing is written to the registry before the commit; a dry run changes no registry data.';

  addOp('/v1/imports/presets', 'get', {
    tag: 'Imports', id: 'listImportPresets', summary: 'Built-in import presets', perm: 'import:read', hasId: false,
    description: 'The templates for assets, people, locations and departments and the Google Admin ChromeOS preset, each with its data dictionary (column, target field, description, example). Pass `preset_key` when creating an import to apply one. Recommended order of imports: locations, departments, people, assets.',
    success: { 200: okResp(200, 'The presets.', S('ImportPresetList'), { replay: false }) },
  });
  addOp('/v1/imports/presets/{key}/template', 'get', {
    tag: 'Imports', id: 'downloadImportTemplate', summary: 'Download a template file', perm: 'import:read', hasId: true,
    description: 'A CSV (UTF-8 with byte order mark) or XLSX template with the header row of the preset and example rows; the XLSX has the data dictionary on a second sheet. The asset templates also carry one `cf:<key>` column per custom field of the organisation.',
    params: [{ name: 'key', in: 'path', required: true, schema: str(), description: 'Preset key.' }, qp('format', en(['csv', 'xlsx'], { default: 'csv' }), 'File format.')],
    success: { 200: { description: 'The template file.', headers: { 'X-Request-Id': H('RequestId'), 'Content-Disposition': { description: 'attachment', schema: str() } }, content: { 'text/csv': { schema: str() }, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: str({ format: 'binary' }) } } } },
  });
  addOp('/v1/imports', 'get', {
    tag: 'Imports', id: 'listImports', summary: 'List imports', perm: 'import:read', hasId: false,
    description: 'Newest first. Without the heavy members (`profile`, `samples`, `value_map`, `confidence`): fetch one import for those.',
    params: [P('Cursor'), P('Limit'), arrQ('state', en(STATES), 'Filter by state.'), qp('entity_type', en(ENTITY), 'Filter by entity type.')],
    success: { 200: okResp(200, 'A page of imports.', S('ImportList'), { replay: false }) },
  });
  addOp('/v1/imports', 'post', {
    tag: 'Imports', id: 'createImport', summary: 'Create an import', perm: 'import:run', hasId: false,
    description: [
      'Creates a `draft` import. Then upload the file through the attachments API (`POST /v1/attachments` with `entity_type: "import_job"`, `entity_id` = this import, `kind: "import_file"`, content type `text/csv` or the XLSX type; a CSV may be UTF-8, UTF-16 or Windows-1252, comma-, semicolon- or tab-delimited, and named `.csv`, `.tsv` or `.txt` such as Excel\'s "Unicode text"), complete the upload, and call `POST /v1/imports/{id}/analyze`.',
      'The caller needs the write permission of the entity type (`asset:create`, `person:manage`, `location:manage`, `department:manage`). `preset_key: google_admin_chromeos` also creates the Chromebook category and its custom fields when missing.',
      IMPORT_NOTE,
    ].join('\n\n'),
    body: jsonBody(S('ImportCreate')),
    success: { 201: okResp(201, 'The import.', S('ImportJob'), { etag: true, location: true, replay: false }) },
  });
  addOp('/v1/imports/{id}', 'get', {
    tag: 'Imports', id: 'getImport', summary: 'Get an import', perm: 'import:read', params: [ID],
    success: { 200: okResp(200, 'The import, with column profile, sample rows, mapping and value map.', S('ImportJob'), { etag: true, replay: false }) },
  });
  addOp('/v1/imports/{id}', 'patch', {
    tag: 'Imports', id: 'updateImport', summary: 'Edit mapping, options and value mapping', perm: 'import:run', params: [ID], ifMatch: true,
    description: 'Unknown or repeated targets are `422`. Missing essentials (no category column and no default category, ...) are reported when the dry run is requested.',
    body: jsonBody(S('ImportUpdate')),
    problems: { 409: importProblems[409] },
    success: { 200: okResp(200, 'The import.', S('ImportJob'), { etag: true }) },
  });
  addOp('/v1/imports/{id}/analyze', 'post', {
    tag: 'Imports', id: 'analyzeImport', summary: 'Read and profile the uploaded file', perm: 'import:run', params: [ID], idem: 'none',
    description: [
      'Queues the analysis: the file (which must have passed the upload scan) is read once as a stream; its format, encoding, delimiter and header row are detected, every data row is stored, each column is profiled (distinct values, blanks, duplicates, detected type, date order), 50 rows are kept as a sample and a mapping is suggested (or the preset\'s applied). A malformed file ends the analysis as `failed` with `error` naming the line. At most 100,000 data rows.',
      IMPORT_NOTE,
    ].join('\n\n'),
    body: jsonBody(S('ImportAnalyze'), false),
    problems: importProblems,
    success: queued('Analysis queued.'),
  });
  addOp('/v1/imports/{id}/apply-template', 'post', {
    tag: 'Imports', id: 'applyImportTemplate', summary: 'Apply a saved mapping template', perm: 'import:run', params: [ID], idem: 'none',
    description: 'Maps the columns of the analysed file by header text and takes the template\'s options. Returns the import in state `mapped`.',
    body: jsonBody(S('ImportTemplateApply')),
    problems: { 409: importProblems[409] },
    success: { 200: okResp(200, 'The import.', S('ImportJob'), { etag: true }) },
  });
  addOp('/v1/imports/{id}/values', 'get', {
    tag: 'Imports', id: 'listImportValues', summary: 'Distinct values of a reference column', perm: 'import:run', extraErrors: [422], params: [ID, { name: 'field', in: 'query', required: true, schema: en(REFS), description: 'The reference kind (the column mapped to it, or the preset constant).' }, P('Limit'), P('Q')],
    description: 'For the value mapping step: the distinct values of the column mapped to the reference with their row counts, the existing record that matches each by name, and the current value-map entry. [ED-37] A value is resolved by the same rules as the dry run, so a value shown as matched never fails the dry run for its name: a model is looked up in the category (and manufacturer) of its rows, and a bare location name counts the locations the import itself creates from the paths of the same column; when a record of that name exists but the rows will still fail, `issue` says why.',
    success: { 200: okResp(200, 'The values.', S('ImportValues'), { replay: false }) },
  });
  addOp('/v1/imports/{id}/dry-run', 'post', {
    tag: 'Imports', id: 'startImportDryRun', summary: 'Run the import without writing', perm: 'import:run', params: [ID], idem: 'none', extraErrors: [422],
    description: [
      'Queues the dry run: every row is parsed with the mapping, its references are resolved, de-duplicated within the file and against the registry, and validated by the very code behind the API (`POST /v1/assets` ... in a mode that stops before the first write; people, locations and departments run the service in a transaction that is rolled back), then classified `create`, `update`, `skip` or `error` with per-row messages. The references the commit would create (category, model, location, department, person...) are created for real inside a savepoint that is rolled back after each batch, so a row that needs one is checked like any other row (ED-29); only a location below a parent the same import creates is left to the commit (counted in `summary.validated_at_commit`, row warning `validated-at-commit`). **No registry data is changed.** When it is done the import is `dry_run_done` with `dry_run_digest`, `counts.dry_run` and `summary`.',
      'The caller needs the permissions the commit would use (the write permission of the entity, `asset:update` when `on_match` is `update`, `catalog:manage` and the like when missing references are created).',
      IMPORT_NOTE,
    ].join('\n\n'),
    problems: { 403: { codes: ['forbidden'], text: 'The import needs permissions the caller does not hold.' }, ...importProblems },
    success: queued('Dry run queued.'),
  });
  addOp('/v1/imports/{id}/rows', 'get', {
    tag: 'Imports', id: 'listImportRows', summary: 'Per-row results', perm: 'import:run', params: [ID, P('Limit'), P('Cursor'), qp('phase', en(['dry_run', 'commit']), 'Defaults to the latest phase.'), arrQ('outcome', en(['create', 'update', 'skip', 'error', 'created', 'updated', 'skipped']), 'Filter by outcome (dry run: create/update/skip/error; commit: created/updated/skipped/error).'), qp('has_warnings', bool(), 'Only rows with (or without) warnings.')],
    description: 'Rows in file order with their errors and warnings (field + message) and the non-empty source cells. Raw file content: needs `import:run`, not just `import:read`.',
    success: { 200: okResp(200, 'A page of rows.', S('ImportRowList'), { replay: false }) },
  });
  addOp('/v1/imports/{id}/errors.csv', 'get', {
    tag: 'Imports', id: 'downloadImportErrors', summary: 'Download the error report', perm: 'import:run', params: [ID],
    description: 'A CSV (UTF-8 with byte order mark) with one line per row that has errors: `Row`, `Line`, `Fields`, `Problems`, `Warnings`, then the original cells under their headers, so it can be corrected and uploaded again. After a commit it lists the rows that failed; before, the rows the dry run rejected. Cells that could be read as formulas get a leading apostrophe (the importer removes it again).',
    success: { 200: { description: 'The report.', headers: { 'X-Request-Id': H('RequestId'), 'Content-Disposition': { description: 'attachment', schema: str() } }, content: { 'text/csv': { schema: str() } } } },
  });
  addOp('/v1/imports/{id}/commit', 'post', {
    tag: 'Imports', id: 'commitImport', summary: 'Commit a reviewed dry run', perm: 'import:run', params: [ID], idem: 'required',
    description: [
      'Only valid in `dry_run_done`, and only with the `dry_run_digest` the user reviewed (`409 import-stale-dry-run` otherwise). The rows classified `create` and `update` are written in batches, one short transaction per batch, through the same services as the API, so validation, history, audit rows and events are never bypassed; every audit entry carries the `import_job_id`. A row that fails is recorded (`result: error`) and does not stop the import; a record edited after the dry run is left alone (`changed-since-dry-run`). The commit can be cancelled between batches and survives a worker restart without creating duplicates. On completion the requester is notified (`import.completed`). Rolling a commit back is v1.1 (the before-image of every update is stored already).',
      IMPORT_NOTE,
    ].join('\n\n'),
    body: jsonBody(S('ImportCommit')),
    problems: { 403: { codes: ['forbidden'], text: 'The import needs permissions the caller does not hold.' }, ...importProblems },
    success: { 202: { description: 'Commit queued.', headers: { 'X-Request-Id': H('RequestId'), Location: H('Location'), 'Retry-After': H('RetryAfter'), 'Idempotent-Replayed': H('IdempotentReplayed') }, content: { 'application/json': { schema: S('ImportJob') } } } },
  });
  addOp('/v1/imports/{id}/cancel', 'post', {
    tag: 'Imports', id: 'cancelImport', summary: 'Cancel an import', perm: 'import:run', params: [ID], idem: 'none',
    description: 'Before a dry run or commit starts: `cancelled` at once. While one runs: `cancel_requested` is set and the job stops after its current batch (rows already written stay). A completed or cancelled import is `409`.',
    problems: { 409: importProblems[409] },
    success: { 200: okResp(200, 'The import.', S('ImportJob'), { replay: false }) },
  });
  addOp('/v1/import-templates', 'get', {
    tag: 'Imports', id: 'listImportTemplates', summary: 'Saved mapping templates', perm: 'import:read', hasId: false,
    params: [P('Cursor'), P('Limit'), qp('entity_type', en(ENTITY), 'Filter by entity type.')],
    success: { 200: okResp(200, 'A page of templates, by name.', S('ImportTemplateList'), { replay: false }) },
  });
  addOp('/v1/import-templates', 'post', {
    tag: 'Imports', id: 'createImportTemplate', summary: 'Save a mapping as a template', perm: 'import:run', hasId: false,
    description: 'From an import (`from_import_id`: its mapped columns by header, and its options) or from explicit `columns`. Names are unique per entity type (ignoring case).',
    body: jsonBody(S('ImportTemplateCreate')),
    success: { 201: okResp(201, 'The template.', S('ImportTemplate'), { etag: true, location: true, replay: false }) },
  });
  addOp('/v1/import-templates/{id}', 'get', {
    tag: 'Imports', id: 'getImportTemplate', summary: 'Get a mapping template', perm: 'import:read', params: [ID],
    success: { 200: okResp(200, 'The template.', S('ImportTemplate'), { etag: true, replay: false }) },
  });
  addOp('/v1/import-templates/{id}', 'patch', {
    tag: 'Imports', id: 'updateImportTemplate', summary: 'Edit a mapping template', perm: 'import:run', params: [ID], ifMatch: true,
    body: jsonBody(S('ImportTemplateUpdate')),
    success: { 200: okResp(200, 'The template.', S('ImportTemplate'), { etag: true }) },
  });
  addOp('/v1/import-templates/{id}', 'delete', {
    tag: 'Imports', id: 'deleteImportTemplate', summary: 'Delete a mapping template', perm: 'import:run', params: [ID], ifMatch: true,
    success: { 204: okResp(204, 'Deleted.', null, { replay: false }) },
  });
}
// ================================================================ [M2-W3 IMP] END

// ================================================================ [M2-LOC-03] BEGIN
// Location scoping of role assignments (story M2-LOC-03, ED-26). A role assignment with
// `scope_type=location` limits the principal to that location subtree for the permissions of the role.
{
  doc.info.description = doc.info.description.replace(
    'Role assignments can be scoped to the tenant, a company or a location subtree; reads and writes outside the scope behave as `404`.',
    'Role assignments can be scoped to the tenant, a company or a location subtree (ED-26). A **location-scoped** assignment limits the principal, for the permissions of that role, to records inside the subtree: assets, accessories and consumables by their location, people by their home location, loaner pools by their home location, repairs, loans, custody records and attachments through their asset or item, locations themselves. A record outside the scope behaves exactly like one that does not exist: `404` on a path id, an empty list, and `422` (`not-found` at the field) when a request names it as a target (a check-out to a person or a location outside the scope, a move there). A record with no location is outside every scope. Writes by a scoped principal must keep the record inside its scope (`422` code `required` at `/location_id`, `/home_location_id` or `/parent_id`). An org-wide assignment that grants the same permission lifts the limit for that permission. A location-scoped assignment never grants the org-only permissions `user:read`, `user:manage`, `role:read`, `apikey:manage`, `audit:read`, `catalog:manage`, `department:manage` and `notification:manage` (`403`). Exports, imports and label batches of a scoped principal are its own only. `GET /v1/auth/me` returns the scope in `location_scope`.',
  );
  S_.RoleAssignment.properties.scope_type.description =
    '`tenant`: the whole organisation. `location`: the location named by `location_id` and everything below it (ED-26); the org-only permissions of the role (`user:*`, `role:read`, `apikey:manage`, `audit:read`, `catalog:manage`, `department:manage`, `notification:manage`) do not apply. `company`: accepted, enforced like `tenant` until company scoping ships.';
  S_.RoleAssignment.properties.location_id.description =
    'Required when scope_type=location: an existing, active location; the grant covers it and its whole subtree. A missing or archived location is `422` (`not-found` at `/role_assignments/<n>/location_id`).';
  S_.ScopeLocation = obj({
    id: uuid(),
    name: str(),
    path: str({ description: 'The names from the top of the tree down to this location, joined with " / ".' }),
  }, ['id', 'name', 'path']);
  S_.Me.properties.location_scope = {
    oneOf: [
      obj({
        locations: arr(S('ScopeLocation'), { description: 'The roots of the subtrees the principal is limited to, by path. Empty when the scoped assignments name no location any more.' }),
      }, ['locations']),
      { type: 'null' },
    ],
    description: '[M2-LOC-03] `null` when the principal holds at least one org-wide role assignment; otherwise the location subtrees it is limited to (the web shell shows "Scoped to: ..."). A principal with both kinds is limited per permission: see the Permissions section.',
  };
  S_.Me.required.push('location_scope');

  const note = (path, method, text) => {
    const op = doc.paths[path][method];
    op.description = op.description ? `${op.description} ${text}` : text;
  };
  note('/v1/exports', 'post', 'A location-scoped requester (ED-26) gets only the rows inside its scope: the scope at request time is stored with the export and applied by the worker.');
  note('/v1/exports', 'get', 'Every principal lists its own exports only.');
  note('/v1/imports', 'get', 'A location-scoped principal (ED-26) lists only the imports it started itself.');
  note('/v1/imports/{id}/commit', 'post', 'A location-scoped principal (ED-26) imports only inside its scope: rows match existing records inside the scope only, and a location, person or parent outside it is reported like one that does not exist. The scope at commit time travels with the job.');
  note('/v1/labels/batches', 'post', 'For a location-scoped principal (ED-26) an asset outside its scope is reported like a missing one (`422` at `/asset_ids/<n>`), and a filter selects inside the scope only.');
  note('/v1/loaners/dashboard', 'get', 'For a location-scoped principal (ED-26) the pools, counts and activity inside its scope.');
  note('/v1/search', 'get', 'For a location-scoped principal (ED-26) assets, people and locations inside its scope only; models and categories are the tenant-wide catalogue.');
  note('/v1/scan/resolve', 'get', 'A code of a record outside the scope of a location-scoped principal answers `404`, like an unknown code (ED-26).');
  note('/v1/users', 'post', 'A role assignment can be limited to a location subtree with `scope_type=location` and `location_id` (ED-26).');
}
// ================================================================ [M2-LOC-03] END

// ---------------------------------------------------------------- prune unused components, order, emit
const text =() => JSON.stringify({ paths: doc.paths, security: doc.security });
function prune() {
  const used = { schemas: new Set(), parameters: new Set(), responses: new Set(), headers: new Set() };
  const scan = (node) => {
    const s = JSON.stringify(node);
    for (const m of s.matchAll(/#\/components\/(schemas|parameters|responses|headers)\/([A-Za-z0-9_]+)/g)) {
      const [, kind, name] = m;
      if (!used[kind].has(name)) { used[kind].add(name); if (C[kind][name]) scan(C[kind][name]); }
    }
  };
  scan(doc.paths);
  for (const kind of Object.keys(used)) {
    for (const name of Object.keys(C[kind])) if (!used[kind].has(name)) { delete C[kind][name]; }
  }
}
prune();

// stable ordering of paths
doc.paths = Object.fromEntries(Object.entries(doc.paths).sort(([a], [b]) => a.localeCompare(b)));

const ydoc = new YAML.Document(doc, { aliasDuplicateObjects: false });
YAML.visit(ydoc, { Scalar(key, node) { if (typeof node.value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(node.value)) node.type = 'QUOTE_DOUBLE'; } });
const yaml = ydoc.toString({ lineWidth: 0 });
fs.writeFileSync(OUT, yaml);

// stats
let ops = 0; const byMethod = {};
for (const p of Object.values(doc.paths)) for (const m of Object.keys(p)) { ops++; byMethod[m] = (byMethod[m] || 0) + 1; }
console.log(JSON.stringify({ paths: Object.keys(doc.paths).length, operations: ops, byMethod, schemas: Object.keys(C.schemas).length, bytes: yaml.length }));
