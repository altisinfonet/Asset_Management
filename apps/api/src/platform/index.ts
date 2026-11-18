// Public facade of the platform kernel's HTTP conventions (M1-PLAT-02). Other modules import from
// here only; the kernel never imports a domain module.
export {
  DEFAULT_BULK_MAX,
  runBulk,
  type BulkItemResult,
  type BulkOptions,
  type BulkResponse,
} from './bulk.js';
export {
  OptionalIfMatch,
  RequiredIfMatch,
  assertIfMatch,
  etagFor,
  ifMatchSatisfied,
  notModified,
  parseIfMatch,
  requireIfMatch,
  setEtag,
  type IfMatch,
} from './etag.js';
export {
  DEFAULT_IDEMPOTENCY_OPTIONS,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAYED_HEADER,
  IdempotencyInterceptor,
  IdempotencyRequired,
  canonicalJson,
  requestHash,
  type IdempotencyOptions,
} from './idempotency.js';
export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  bindingFor,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  listPage,
  listQuerySchema,
  parseFields,
  parseSort,
  toOrderBy,
  type ListPageArgs,
  type ListQuery,
  type ListSpec,
  type Page,
  type PageInfo,
  type SortTerm,
} from './pagination.js';
export { PlatformModule } from './platform.module.js';
export { Principal, type RequestPrincipal } from './principal.js';
export {
  ApiProblem,
  DEFAULT_PROBLEM_TYPE_BASE,
  PROBLEM_CATALOG,
  PROBLEM_CONTENT_TYPE,
  codeForStatus,
  problem,
  toProblemBody,
  type FieldError,
  type ProblemBody,
  type ProblemCode,
} from './problem.js';
export { ProblemFilter, PROBLEM_TYPE_BASE } from './problem.filter.js';
export { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';
export {
  ZodValidationPipe,
  fieldErrorsFromZod,
  type ValidationSource,
} from './zod-validation.pipe.js';
