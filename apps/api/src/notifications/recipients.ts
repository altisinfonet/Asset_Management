import type { OutboxDelivery } from '../outbox/index.js';
import { locationScopeFor, type GrantedRole } from '../auth/index.js';
import type { Tx } from '../tenancy/index.js';

/**
 * Who a subscription notifies, resolved under RLS in the relay's transaction. A resolver returns USER
 * ids (login accounts); an empty list means "nobody to tell" and is not an error. Combine the
 * constructors below in `subscriptions.ts`.
 */
export type RecipientResolver = (event: OutboxDelivery, tx: Tx) => Promise<string[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

/** The user named by one of the payload keys (the first present one wins). */
export const payloadUser =
  (...keys: string[]): RecipientResolver =>
  async (event) => {
    for (const key of keys) {
      const id = idOf(event.payload[key]);
      if (id) return [id];
    }
    return [];
  };

/** The login of the person named by a payload key (a person without a login is nobody to notify). */
export const loginOfPerson =
  (key: string): RecipientResolver =>
  async (event, tx) => {
    const personId = idOf(event.payload[key]);
    if (!personId) return [];
    const person = await tx.person.findUnique({
      where: { id: personId },
      select: { user_id: true },
    });
    return person?.user_id ? [person.user_id] : [];
  };

/** Active users that hold `permission` through any role (`*` and `resource:*` count). */
export const holdersOf =
  (permission: string): RecipientResolver =>
  (_event, tx) =>
    usersWithPermission(tx, permission);

export async function usersWithPermission(tx: Tx, permission: string): Promise<string[]> {
  const grants = ['*', permission, `${permission.split(':')[0]}:*`];
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select distinct u.id
      from app.user_account u
      join app.role_assignment ra on ra.tenant_id = u.tenant_id and ra.user_id = u.id
      join app.role r on r.tenant_id = ra.tenant_id and r.id = ra.role_id
     where u.status = 'active' and u.archived_at is null
       and r.permissions && ${grants}::text[]`;
  return rows.map((r) => r.id);
}

/** Active users that hold one of the roles (by role key); used when an administrator re-addresses a type. */
export async function usersWithRoles(tx: Tx, roleKeys: readonly string[]): Promise<string[]> {
  if (roleKeys.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select distinct u.id
      from app.user_account u
      join app.role_assignment ra on ra.tenant_id = u.tenant_id and ra.user_id = u.id
      join app.role r on r.tenant_id = ra.tenant_id and r.id = ra.role_id
     where u.status = 'active' and u.archived_at is null
       and r.key = any(${[...roleKeys]}::text[])`;
  return rows.map((r) => r.id);
}

/**
 * The users to tell about a loaner pool's loans (ED-21): the pool's owner when it has an active one,
 * otherwise everybody who holds `loaner:manage`. The pool is named by a payload key.
 */
export const poolManagers =
  (key = 'poolId'): RecipientResolver =>
  async (event, tx) => {
    const poolId = idOf(event.payload[key]);
    if (poolId) {
      const pool = await tx.loaner_pool.findUnique({
        where: { id: poolId },
        select: { owner_user_id: true },
      });
      if (pool?.owner_user_id) {
        const owner = await tx.user_account.findUnique({
          where: { id: pool.owner_user_id },
          select: { id: true, status: true, archived_at: true },
        });
        if (owner && owner.status === 'active' && !owner.archived_at) return [owner.id];
      }
    }
    return usersWithPermission(tx, 'loaner:manage');
  };

/** A recipient list that is the union of several resolvers (duplicates folded). */
export const anyOf =
  (...resolvers: RecipientResolver[]): RecipientResolver =>
  async (event, tx) => {
    const all = new Set<string>();
    for (const resolve of resolvers) for (const id of await resolve(event, tx)) all.add(id);
    return [...all];
  };

/** An address that is not a login account (ED-24). */
export interface EmailRecipient {
  email: string;
  locale?: string | null;
}

/** Who gets mail although they have no login: see `loanBorrowerWithoutLogin`. */
export type EmailRecipientResolver = (event: OutboxDelivery, tx: Tx) => Promise<EmailRecipient[]>;

/**
 * The borrower of a loaner loan who has NO login account but has an e-mail address, when the pool
 * wants them told (ED-24). The pool's `email_borrowers_without_login` decides: true = always, false =
 * never, null (automatic) = every kind of person except students (a child's address is not written to
 * by default). A borrower with a login is told through the in-app / user path instead, never twice.
 */
export const loanBorrowerWithoutLogin =
  (personKey = 'personId', poolKey = 'poolId'): EmailRecipientResolver =>
  async (event, tx) => {
    const personId = idOf(event.payload[personKey]);
    if (!personId) return [];
    const person = await tx.person.findUnique({
      where: { id: personId },
      select: { user_id: true, email: true, kind: true, archived_at: true },
    });
    if (!person || person.user_id || person.archived_at || !person.email?.trim()) return [];
    const poolId = idOf(event.payload[poolKey]);
    const pool = poolId
      ? await tx.loaner_pool.findUnique({
          where: { id: poolId },
          select: { email_borrowers_without_login: true },
        })
      : null;
    if (!pool) return [];
    const wanted = pool.email_borrowers_without_login ?? person.kind !== 'student';
    return wanted ? [{ email: person.email.trim() }] : [];
  };

/**
 * M2-LOC-03 (ED-26): drops the recipients whose location scope does not contain the subject of the
 * notification (an asset, accessory or consumable, by its location). Org-wide users keep everything;
 * the ids in `exempt` (the subject's own holder, for example) are always kept. Subjects that are not
 * location-bound (a user's own export, import or label batch) are not filtered.
 */
export async function keepInScope(
  tx: Tx,
  recipients: readonly string[],
  entity: { type: string; id: string } | undefined,
  exempt: ReadonlySet<string>,
): Promise<string[]> {
  if (!entity || recipients.length === 0) return [...recipients];
  let locationId: string | null;
  if (entity.type === 'asset') {
    locationId =
      (await tx.asset.findUnique({ where: { id: entity.id }, select: { location_id: true } }))
        ?.location_id ?? null;
  } else if (entity.type === 'accessory') {
    locationId =
      (await tx.accessory.findUnique({ where: { id: entity.id }, select: { location_id: true } }))
        ?.location_id ?? null;
  } else if (entity.type === 'consumable') {
    locationId =
      (await tx.consumable.findUnique({ where: { id: entity.id }, select: { location_id: true } }))
        ?.location_id ?? null;
  } else {
    return [...recipients];
  }
  const ancestors = locationId
    ? ((await tx.location.findUnique({ where: { id: locationId }, select: { ancestor_ids: true } }))
        ?.ancestor_ids ?? [])
    : [];
  const rows = await tx.role_assignment.findMany({
    where: { user_id: { in: [...recipients] } },
    include: { role: { select: { key: true, permissions: true } } },
  });
  const grants = new Map<string, GrantedRole[]>();
  for (const r of rows) {
    const list = grants.get(r.user_id) ?? [];
    list.push({
      assignmentId: r.id,
      roleId: r.role_id,
      roleKey: r.role.key,
      permissions: r.role.permissions,
      scopeType: r.scope_type as GrantedRole['scopeType'],
      scopeCompanyId: r.scope_company_id,
      scopeLocationId: r.scope_location_id,
    });
    grants.set(r.user_id, list);
  }
  return recipients.filter((id) => {
    const held = grants.get(id);
    // the holder the event is about, and a user without any role (only ever addressed personally)
    if (exempt.has(id) || !held) return true;
    const roots = locationScopeFor(held);
    return roots === null || roots.some((root) => ancestors.includes(root));
  });
}
