import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the loaner endpoints (openapi `LoanerPool*`, `LoanerCheckoutRequest`,
 * `QuickLoanRequest`, `LoanReturnRequest`, `LoanExtendRequest`, `CustodySettings*`). Bodies are strict;
 * the update schema has no defaults (RFC 7396 merge semantics).
 */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
export const uuidParam = z.uuid();

/** A calendar date PostgreSQL accepts (year 0000 passes the format check but not the database). */
export const isoDate = z.iso
  .date()
  .refine((v) => new Date(`${v}T00:00:00Z`).getUTCFullYear() >= 1, 'year must be 1 or later');

/** `a,b` in a query string -> validated list. */
const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(2000)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1).max(20));

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

export const PERSON_KINDS = ['employee', 'student', 'contractor', 'external'] as const;
export const LOAN_STATES = ['on_loan', 'due_today', 'overdue', 'returned'] as const;
export type LoanState = (typeof LOAN_STATES)[number];
export const OPEN_LOAN_STATES: readonly LoanState[] = ['on_loan', 'due_today', 'overdue'];

// ------------------------------------------------------------------------------------- pools

const eligibleKinds = z
  .array(z.enum(PERSON_KINDS))
  .min(1)
  .max(4)
  .transform((kinds) => [...new Set(kinds)])
  .nullable();

const poolShape = {
  name: trimmed(1, 200),
  description: nullableText(2000),
  home_location_id: z.uuid().nullable(),
  default_loan_days: z.number().int().min(1).max(3660),
  max_loan_days: z.number().int().min(1).max(3660).nullable(),
  max_loans_per_person: z.number().int().min(1).max(1000).nullable(),
  eligible_person_kinds: eligibleKinds,
  owner_user_id: z.uuid().nullable(),
  is_active: z.boolean(),
};

export const poolCreateSchema = z.strictObject({
  name: poolShape.name,
  description: poolShape.description.optional(),
  home_location_id: poolShape.home_location_id.optional(),
  default_loan_days: poolShape.default_loan_days.optional(),
  max_loan_days: poolShape.max_loan_days.optional(),
  max_loans_per_person: poolShape.max_loans_per_person.optional(),
  eligible_person_kinds: poolShape.eligible_person_kinds.optional(),
  owner_user_id: poolShape.owner_user_id.optional(),
  is_active: poolShape.is_active.optional(),
});
export type PoolCreate = z.output<typeof poolCreateSchema>;

export const poolUpdateSchema = z.strictObject({
  name: poolShape.name.optional(),
  description: poolShape.description.optional(),
  home_location_id: poolShape.home_location_id.optional(),
  default_loan_days: poolShape.default_loan_days.optional(),
  max_loan_days: poolShape.max_loan_days.optional(),
  max_loans_per_person: poolShape.max_loans_per_person.optional(),
  eligible_person_kinds: poolShape.eligible_person_kinds.optional(),
  owner_user_id: poolShape.owner_user_id.optional(),
  is_active: poolShape.is_active.optional(),
});
export type PoolUpdate = z.output<typeof poolUpdateSchema>;

export const poolListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  is_active: boolParam.optional(),
  home_location_id: z.uuid().optional(),
});
export type PoolListQuery = z.output<typeof poolListSchema>;

export const memberListSchema = listQuerySchema.pick({ limit: true, cursor: true }).extend({
  available: boolParam.optional(),
});
export type MemberListQuery = z.output<typeof memberListSchema>;

export const addMemberSchema = z.strictObject({ asset_id: z.uuid() });
export type AddMemberBody = z.output<typeof addMemberSchema>;

export const bulkMembersSchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .transform((ids) => [...new Set(ids.map((i) => i.toLowerCase()))]),
});
export type BulkMembersBody = z.output<typeof bulkMembersSchema>;

export const assetIdParams = z.object({ id: z.uuid(), asset_id: z.uuid() });

// ------------------------------------------------------------------------------------- loans

export const loanerCheckoutSchema = z.strictObject({
  person_id: z.uuid(),
  asset_id: z.uuid().optional(),
  expected_return: isoDate.optional(),
  note: str().trim().max(2000).optional(),
});
export type LoanerCheckoutBody = z.output<typeof loanerCheckoutSchema>;

const code = trimmed(1, 200);

export const quickLoanSchema = z
  .strictObject({
    person_id: z.uuid().optional(),
    borrower: trimmed(1, 254).optional(),
    codes: z.array(code).min(1).max(50),
    expected_return: isoDate.optional(),
    note: str().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    const given = [v.person_id, v.borrower].filter((x) => x !== undefined).length;
    if (given !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: [v.person_id !== undefined ? 'person_id' : 'borrower'],
        message:
          given === 0
            ? 'exactly one of person_id and borrower is required'
            : 'send only one of person_id and borrower',
      });
    }
  });
export type QuickLoanBody = z.output<typeof quickLoanSchema>;

export const loanReturnSchema = z.strictObject({
  codes: z.array(code).min(1).max(100),
  loaner_pool_id: z.uuid().optional(),
  checkin_location_id: z.uuid().nullable().optional(),
  status_id: z.uuid().nullable().optional(),
  condition: z.enum(['good', 'fair', 'poor', 'damaged']).optional(),
  note: str().trim().max(2000).optional(),
});
export type LoanReturnBody = z.output<typeof loanReturnSchema>;

export const loanExtendSchema = z.strictObject({
  expected_return: isoDate,
  note: str().trim().max(500).optional(),
});
export type LoanExtendBody = z.output<typeof loanExtendSchema>;

export const LOAN_SORTS = ['expected_return', 'checked_out_at'] as const;
export const loanListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  loaner_pool_id: z.uuid().optional(),
  person_id: z.uuid().optional(),
  asset_id: z.uuid().optional(),
  state: csv(z.enum(LOAN_STATES)).optional(),
  due_within_days: z.coerce.number().int().min(0).max(366).optional(),
});
export type LoanListQuery = z.output<typeof loanListSchema>;

export const overdueListSchema = listQuerySchema
  .pick({ limit: true, cursor: true, sort: true })
  .extend({
    loaner_pool_id: z.uuid().optional(),
    person_id: z.uuid().optional(),
  });
export type OverdueListQuery = z.output<typeof overdueListSchema>;
