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
  Accessories: 'Quantity-tracked items that are checked out and returned.',
  Consumables: 'Quantity-tracked items that are used up, with a stock ledger.',
  Loaners: 'Loaner pools: spare devices with quick check-out, due dates and overdue tracking.',
  Repairs: 'Repair and maintenance log.',
  Labels: 'Fixed label templates and PDF label sheets.',
  Imports: 'CSV/XLSX/Snipe-IT/Google Admin imports with a mandatory dry run.',
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
  // [M2-W1 locations, people, custody]
  'asset-not-deployable': [[409], 'The asset\'s status does not allow this custody action: check-out (and a transfer out of stock) need a `deployable` state, so lost, archived, in-repair and pending assets cannot be checked out.'],
  'insufficient-stock': [[409], 'Not enough quantity on hand.'],
  'no-loaner-available': [[409], 'The loaner pool has no available member.'],
  'import-stale-dry-run': [[409], 'The dry run being committed is not the one reviewed.'],
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
  copy_fields: arr(en(['name', 'model_id', 'status_id', 'vendor_id', 'location_id', 'parent_asset_id', 'purchase_date', 'purchase_cost', 'order_number', 'warranty_end', 'notes', 'custom_data']), { description: 'Fields to copy from the source. Default - all of them.' }),
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
S_.Address = obj({ line1: nstr(), line2: nstr(), city: nstr(), region: nstr(), postal_code: nstr(), country: nstr({ description: 'ISO 3166-1 alpha-2.' }) });
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
    department: nstr(),
    job_title: nstr(),
    location_id: nuuid('Primary or home location.'),
    company_id: uuid(),
    status: en(['active', 'inactive'], { default: 'active' }),
    notes: nstr(),
  },
  required: ['display_name'],
  readOnly: {
    user_id: ro(nuuid('Linked login account, if this person can sign in.')),
    // [M2-W1] computed per request
    assets_held: ro(int({ minimum: 0, description: 'Number of assets currently checked out to this person.' })),
  },
});
// [M2-W1] Deactivating a person who still holds assets is refused (409 with `usage.open_assignments`) unless
// the update says `force: true` together with a `reason` (recorded in the audit trail). Not stored on the person.
S_.PersonUpdate.properties.force = bool({ default: false, description: 'With `status: "inactive"`: deactivate even though the person still holds assets. Needs `reason`. Not stored on the person.' });
S_.PersonUpdate.properties.reason = str({ minLength: 1, maxLength: 500, description: 'Why a forced deactivation is justified (audit trail). Ignored without `force`.' });
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
  props: {
    name: str({ minLength: 1, maxLength: 200 }),
    description: nstr(),
    home_location_id: nuuid(),
    default_loan_days: int({ minimum: 1, default: 7 }),
    max_loan_days: { type: ['integer', 'null'], minimum: 1, description: 'Must be >= default_loan_days.' },
    is_active: bool({ default: true }),
  },
  required: ['name'],
  readOnly: { member_count: ro(int()), checked_out_count: ro(int()), overdue_count: ro(int()) },
});
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
  expanded: ro(obj({}, [], { additionalProperties: true, description: 'Related objects requested through `expand` (model, category, location, vendor).' })),
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
  event_type: en(['created', 'updated', 'status_changed', 'location_changed', 'checked_out', 'checked_in', 'transferred', 'repair_opened', 'repair_completed', 'archived', 'restored', 'label_printed', 'imported']),
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
    '- `checked_out`: `{assignment_id, target_type: "person"|"location"|"asset", target_id, target_name, expected_return, status: {from, to}, note?, attachment_ids?}`',
    '- `checked_in`: `{assignment_id, target_type, target_id, target_name, status: {from, to}, location?: {from, to}, condition?: "good"|"fair"|"poor"|"damaged", note?, attachment_ids?}`',
    '- `transferred`: `{from: {type, id, name} | null, to: {type, id, name}, from_assignment_id, to_assignment_id, location?: {from, to}, reason?, note?, attachment_ids?}`',
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
S_.LoanerPoolMember = obj({ asset_id: uuid(), loaner_pool_id: uuid(), added_at: dt(), available: bool({ description: 'Not currently checked out.' }), asset: S('Asset') }, ['asset_id', 'loaner_pool_id', 'added_at', 'available']);
S_.LoanerPoolMemberList = obj({ data: arr(S('LoanerPoolMember')), page: S('PageInfo') }, ['data', 'page']);
S_.LoanerCheckoutRequest = obj({
  person_id: uuid(),
  asset_id: uuid('A specific pool member. If omitted, the next available member is chosen.'),
  expected_return: date({ description: 'Defaults to today + pool.default_loan_days; must not exceed pool.max_loan_days.' }),
  note: str({ maxLength: 2000 }),
}, ['person_id'], { additionalProperties: false });
S_.OverdueCheckout = obj({
  assignment_id: uuid(),
  asset_id: uuid(),
  person_id: nuuid(),
  location_id: nuuid(),
  target_asset_id: nuuid(),
  loaner_pool_id: nuuid(),
  expected_return: date(),
  days_overdue: int({ minimum: 1 }),
}, ['assignment_id', 'asset_id', 'expected_return', 'days_overdue']);
S_.OverdueCheckoutList = obj({ data: arr(S('OverdueCheckout')), page: S('PageInfo') }, ['data', 'page']);

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

// imports
S_.ImportJob = obj({
  id: ro(uuid()),
  source: en(['csv', 'xlsx', 'snipe_it', 'google_admin_csv']),
  entity_type: en(['asset', 'accessory', 'consumable', 'location', 'person', 'manufacturer', 'asset_model', 'category']),
  state: ro(en(['draft', 'dry_run_queued', 'dry_run_running', 'dry_run_complete', 'commit_queued', 'committing', 'committed', 'failed', 'cancelled'])),
  file_attachment_id: nuuid('Uploaded file (kind `import_file`).'),
  original_filename: nstr(),
  mapping: { type: 'object', additionalProperties: str(), description: 'Source column -> target field key (use `custom_data.<key>` for custom fields).' },
  options: obj({
    match_on: en(['asset_tag', 'serial', 'external_id'], { default: 'asset_tag' }),
    on_duplicate: en(['skip', 'update', 'error'], { default: 'skip' }),
    create_missing_references: bool({ default: true, description: 'Create missing categories, manufacturers, models, locations referenced by name.' }),
    delimiter: str({ maxLength: 1, default: ',' }),
    date_format: str({ default: 'YYYY-MM-DD' }),
  }, [], { additionalProperties: true }),
  rows_total: ro(int()), rows_create: ro(int()), rows_update: ro(int()), rows_skip: ro(int()), rows_error: ro(int()),
  dry_run_digest: ro(nstr({ description: 'Hash of file + mapping + options at dry-run time; quote it in the commit request.' })),
  dry_run_completed_at: ro(ndt()),
  committed_at: ro(ndt()),
  error: ro(nstr()),
  created_at: ro(dt()),
  updated_at: ro(dt()),
  created_by: ro(nuuid()),
}, ['id', 'source', 'entity_type', 'state', 'mapping', 'options']);
S_.ImportJobCreate = obj({
  source: en(['csv', 'xlsx', 'snipe_it', 'google_admin_csv']),
  entity_type: en(['asset', 'accessory', 'consumable', 'location', 'person', 'manufacturer', 'asset_model', 'category']),
  file_attachment_id: uuid('Required for file sources; omit for `snipe_it` (credentials are passed in `options.snipe_it`).'),
  mapping: { type: 'object', additionalProperties: str() },
  options: { type: 'object', additionalProperties: true },
}, ['source', 'entity_type'], { additionalProperties: false });
S_.ImportJobUpdate = obj({
  mapping: { type: 'object', additionalProperties: str() },
  options: { type: 'object', additionalProperties: true },
}, [], { additionalProperties: false, description: 'Editing mapping/options is allowed in `draft` and `dry_run_complete` (the latter returns the job to `draft` and invalidates the digest).' });
S_.ImportJobList = obj({ data: arr(S('ImportJob')), page: S('PageInfo') }, ['data', 'page']);
S_.ImportCommitRequest = obj({ dry_run_digest: str({ description: 'Digest of the reviewed dry run; if the file, mapping or options changed since, commit fails with 409.' }) }, ['dry_run_digest'], { additionalProperties: false });
S_.ImportRow = obj({
  row_no: int({ minimum: 1 }),
  phase: en(['dry_run', 'commit']),
  outcome: en(['create', 'update', 'skip', 'error']),
  entity_id: nuuid(),
  errors: arr(S('FieldError')),
  warnings: arr(S('FieldError')),
  source_data: { type: ['object', 'null'], additionalProperties: true },
}, ['row_no', 'phase', 'outcome', 'errors', 'warnings']);
S_.ImportRowList = obj({ data: arr(S('ImportRow')), page: S('PageInfo') }, ['data', 'page']);

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
  readOnly: { mfa_enabled: ro(bool()), last_login_at: ro(ndt()), person_id: ro(nuuid()) },
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
  filters: [arrQ('kind', en(['employee', 'student', 'contractor', 'external']), 'Filter by kind.'), qp('status', en(['active', 'inactive']), 'Filter by status.'), qp('department', str(), 'Exact department.'), qp('location_id', uuid(), 'Home location.'), qp('employee_ref', str(), 'Exact employee / student number.'), qp('has_login', bool(), 'Only people with (true) or without (false) a login account.')],
  sorts: ['display_name', 'created_at', 'employee_ref'], defSort: ['display_name'],
});
// [M2-W1] People rules (M2-USR-01)
doc.paths['/v1/people'].post.description = 'Creates an assignable person (no login). `email` and `employee_ref` are unique per tenant among live people (409 `conflict`). A login account (`POST /v1/users`) gets its person automatically; a person created here with the same email is linked to the account when it is created. People never receive login emails. Requires permission `person:manage`.';
doc.paths['/v1/people/{id}'].patch.description = 'Merge semantics. Setting `status: "inactive"` while the person still holds assets is `409 conflict` with `usage.open_assignments`, unless `force: true` and a `reason` are sent (the reason lands in the audit trail; the custody stays open). An inactive person cannot receive new check-outs. Requires permission `person:manage`.';
doc.paths['/v1/people/{id}'].delete.description = 'Soft delete. `409 conflict` with `usage.open_assignments` while the person still holds assets, and for a person linked to a login account (archive the account first). Requires permission `person:manage`.';
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
  qp('include_sublocations', bool({ default: true }), 'With `location_id`: include the whole subtree.'),
  qp('company_id', uuid(), 'Filter by company.'),
  qp('vendor_id', uuid(), 'Filter by vendor.'),
  qp('parent_asset_id', uuid(), 'Children of this asset.'),
  qp('assigned_person_id', uuid(), 'Currently checked out to this person.'),
  qp('assigned', bool(), 'true = checked out, false = in stock.'),
  qp('overdue', bool(), '[M2-W1] true = checked out with an `expected_return` before today (UTC); false = every other asset.'),
  qp('loaner_pool_id', uuid(), 'Members of this loaner pool.'),
  qp('warranty_end_before', date(), 'Warranty ends on or before.'),
  qp('warranty_end_after', date(), 'Warranty ends on or after.'),
  qp('purchase_date_from', date(), 'Purchased on or after.'),
  qp('purchase_date_to', date(), 'Purchased on or before.'),
  qp('updated_since', dt(), 'Changed at or after (incremental sync).'),
  { name: 'cf', in: 'query', style: 'deepObject', explode: true, description: 'Custom field filters, e.g. `cf[warranty_tier]=gold`. Exact match on the JSONB value.', schema: { type: 'object', additionalProperties: str() } },
  arrQ('expand', en(['model', 'category', 'location', 'vendor']), 'Embed related objects under `expanded`.'),
  arrQ('fields', str(), 'Sparse fieldset: return only these top-level properties (`id` is always included).'),
];
addOp('/v1/assets', 'get', {
  tag: 'Assets', id: 'listAssets', summary: 'List and search assets', perm: 'asset:read',
  description: 'The main registry query. `q` searches tag, serial and name (trigram); `tag` / `serial` are exact. Soft-deleted assets are excluded unless `archived` says otherwise.',
  params: listParams([...assetFilters, sortParam(['created_at', 'updated_at', 'asset_tag', 'name', 'purchase_date', 'warranty_end'], ['-created_at'])]),
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
  params: [ID, arrQ('expand', en(['model', 'category', 'location', 'vendor']), 'Embed related objects under `expanded`.')],
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
  description: 'Applies the same `changes` (status, category, model, vendor, `custom_data` merge) to every listed asset.\n\n' + BULK_NOTE,
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
  params: [ID, P('Cursor'), P('Limit'), arrQ('event_type', en(['created', 'updated', 'status_changed', 'location_changed', 'checked_out', 'checked_in', 'transferred', 'repair_opened', 'repair_completed', 'archived', 'restored', 'label_printed', 'imported']), 'Filter by event type.'), qp('from', dt(), 'Events at or after.'), qp('to', dt(), 'Events before.')],
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
crud({
  tag: 'Loaners', base: 'loaner-pools', name: 'LoanerPool', plural: 'LoanerPools', singular: 'loaner pool', readPerm: 'loaner:read', writePerm: 'loaner:manage',
  filters: [qp('is_active', bool(), 'Only active / inactive pools.')], sorts: ['name', 'created_at'], defSort: ['name'],
});
addOp('/v1/loaner-pools/{id}/members', 'get', {
  tag: 'Loaners', id: 'listLoanerPoolMembers', summary: 'List pool members', perm: 'loaner:read',
  params: [ID, P('Cursor'), P('Limit'), qp('available', bool(), 'true = not currently checked out.')],
  success: { 200: okResp(200, 'A page of pool members.', S('LoanerPoolMemberList'), { replay: false }) },
});
addOp('/v1/loaner-pools/{id}/members', 'post', {
  tag: 'Loaners', id: 'addLoanerPoolMember', summary: 'Add an asset to the pool', perm: 'loaner:manage', params: [ID],
  description: 'An asset belongs to at most one pool (409 if it is in another).',
  body: jsonBody(obj({ asset_id: uuid() }, ['asset_id'], { additionalProperties: false })),
  success: { 201: okResp(201, 'Added.', S('LoanerPoolMember')) },
});
addOp('/v1/loaner-pools/{id}/members/{asset_id}', 'delete', {
  tag: 'Loaners', id: 'removeLoanerPoolMember', summary: 'Remove an asset from the pool', perm: 'loaner:manage', params: [ID, P('AssetIdPath')],
  description: 'Rejected with 409 while the asset is on loan.',
  success: { 204: okResp(204, 'Removed.') },
});
addOp('/v1/loaner-pools/{id}/checkout', 'post', {
  tag: 'Loaners', id: 'checkoutLoaner', summary: 'Quick loan from the pool', perm: 'loaner:checkout', params: [ID], idem: 'required',
  description: 'Checks out a specific pool member, or the next available one, to a person with a due date. Return it with `POST /v1/assets/{id}/checkin`. 409 `no-loaner-available` when the pool is empty. Like a normal check-out it returns the updated asset (the client may not have known which pool member was chosen) and the assignment.',
  body: jsonBody(S('LoanerCheckoutRequest')),
  success: { 201: okResp(201, 'Loan opened. Returns the updated asset and the new assignment; `ETag` is the new version of the asset.', S('CustodyResult'), { etag: true, location: true }) },
});
addOp('/v1/loans/overdue', 'get', {
  tag: 'Loaners', id: 'listOverdueCheckouts', summary: 'Overdue check-outs', perm: 'loaner:read', hasId: false,
  description: 'Open asset check-outs past `expected_return`, loaner or not (the data behind overdue alerts).',
  params: [P('Cursor'), P('Limit'), qp('loaner_pool_id', uuid(), 'Only this pool.'), qp('person_id', uuid(), 'Only this borrower.'), sortParam(['expected_return', 'days_overdue'], ['expected_return'])],
  success: { 200: okResp(200, 'A page of overdue check-outs.', S('OverdueCheckoutList'), { replay: false }) },
});

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
  description: 'Creates the metadata row (`scan_status=pending`) and returns a presigned PUT URL with size and content-type conditions and a tenant-prefixed key. After the PUT, call `POST /v1/attachments/{id}/complete`.\n\nThe declared `content_type` must be on the allow-list (JPEG, PNG, WebP, GIF, PDF, Office documents, ODF, CSV; never SVG or HTML) and match the file name extension; the size must be within the organisation\'s cap. The owner (`entity_type` + `entity_id`) must exist in your organisation (`422` otherwise, also for an owner type that is not available yet). To attach photos to a record that does not exist yet (a check-in), upload them against the asset and send their ids with the check-in.',
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

// ---------------------------------------------------------------- IMPORTS
addOp('/v1/imports', 'get', {
  tag: 'Imports', id: 'listImports', summary: 'List import jobs', perm: 'import:read',
  params: [P('Cursor'), P('Limit'), arrQ('state', en(['draft', 'dry_run_queued', 'dry_run_running', 'dry_run_complete', 'commit_queued', 'committing', 'committed', 'failed', 'cancelled']), 'Filter by state.'), qp('entity_type', str(), 'Filter by entity type.')],
  success: { 200: okResp(200, 'A page of import jobs, newest first.', S('ImportJobList'), { replay: false }) },
});
addOp('/v1/imports', 'post', {
  tag: 'Imports', id: 'createImport', summary: 'Create an import job', perm: 'import:run',
  description: 'Creates a `draft` job. Upload the file first (`POST /v1/attachments` with kind `import_file`), then reference it here. Nothing is written to the registry until a dry run has completed and the job is committed.',
  body: jsonBody(S('ImportJobCreate')),
  success: { 201: okResp(201, 'Job created.', S('ImportJob'), { etag: true, location: true }) },
});
addOp('/v1/imports/{id}', 'get', {
  tag: 'Imports', id: 'getImport', summary: 'Get an import job', perm: 'import:read', params: [ID],
  success: { 200: okResp(200, 'The job.', S('ImportJob'), { etag: true, replay: false }) },
});
addOp('/v1/imports/{id}', 'patch', {
  tag: 'Imports', id: 'updateImport', summary: 'Edit mapping and options', perm: 'import:run', params: [ID], ifMatch: true,
  body: jsonBody(S('ImportJobUpdate')),
  success: { 200: okResp(200, 'Updated job.', S('ImportJob'), { etag: true }) },
});
addOp('/v1/imports/{id}/dry-run', 'post', {
  tag: 'Imports', id: 'startImportDryRun', summary: 'Run the import without writing', perm: 'import:run', params: [ID],
  description: 'Queues a dry run that validates every row, matches existing records and reports per-row outcomes (`create` / `update` / `skip` / `error`) without touching the registry. Poll `GET /v1/imports/{id}` until `state=dry_run_complete`.',
  success: { 202: { description: 'Dry run queued.', headers: { 'X-Request-Id': H('RequestId'), Location: H('Location'), 'Retry-After': H('RetryAfter') }, content: { 'application/json': { schema: S('ImportJob') } } } },
});
addOp('/v1/imports/{id}/rows', 'get', {
  tag: 'Imports', id: 'listImportRows', summary: 'Per-row results', perm: 'import:read',
  params: [ID, P('Cursor'), P('Limit'), qp('phase', en(['dry_run', 'commit']), 'Defaults to the latest phase.'), arrQ('outcome', en(['create', 'update', 'skip', 'error']), 'Filter by outcome.')],
  success: { 200: okResp(200, 'A page of rows.', S('ImportRowList'), { replay: false }) },
});
addOp('/v1/imports/{id}/commit', 'post', {
  tag: 'Imports', id: 'commitImport', summary: 'Commit a reviewed dry run', perm: 'import:run', params: [ID], idem: 'required',
  description: 'Only valid in state `dry_run_complete`, and only with the `dry_run_digest` the caller reviewed (409 `import-stale-dry-run` otherwise). Writes through the normal registry services, so validation, history and audit are not bypassed. Rollback of a committed import is v1.1.',
  body: jsonBody(S('ImportCommitRequest')),
  success: { 202: { description: 'Commit queued.', headers: { 'X-Request-Id': H('RequestId'), Location: H('Location'), 'Retry-After': H('RetryAfter'), 'Idempotent-Replayed': H('IdempotentReplayed') }, content: { 'application/json': { schema: S('ImportJob') } } } },
});
addOp('/v1/imports/{id}/cancel', 'post', {
  tag: 'Imports', id: 'cancelImport', summary: 'Cancel an import job', perm: 'import:run', params: [ID],
  description: 'Allowed before commit starts; a running commit finishes its current batch and stops (rows already written stay).',
  success: { 200: okResp(200, 'Cancelled job.', S('ImportJob')) },
});

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
    '`set_status_id` (typically an `undeployable` label such as "In repair") moves the asset to that status and so blocks its check-out; the status the asset had before (or the tenant\'s default deployable one, when it was checked out) is remembered as `restore_status_id` and put back when the record is completed or cancelled. Only one open record at a time may move an asset\'s status (`409 conflict` otherwise).',
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
