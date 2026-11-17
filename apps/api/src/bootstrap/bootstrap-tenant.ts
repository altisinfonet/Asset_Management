import { z } from 'zod';
import { generateToken, hashToken } from '../identity/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { sql, type TenancyService, type Tx } from '../tenancy/index.js';

export const DEFAULT_CATEGORIES = [
  { name: 'Laptops', tag_prefix: 'LAP' },
  { name: 'Desktops', tag_prefix: 'DSK' },
  { name: 'Monitors', tag_prefix: 'MON' },
  { name: 'Phones and tablets', tag_prefix: 'MOB' },
  { name: 'Peripherals', tag_prefix: 'PER' },
  { name: 'Network equipment', tag_prefix: 'NET' },
] as const;

const INVITATION_TTL_DAYS = 7;

const inputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  adminEmail: z.string().trim().toLowerCase().pipe(z.email()),
  adminName: z.string().trim().min(1).max(200).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'slug must be 3-40 chars of a-z, 0-9 and -')
    .optional(),
  baseCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
});
export type BootstrapTenantInput = z.input<typeof inputSchema>;

export interface BootstrapTenantResult {
  tenantId: string;
  slug: string;
  /** false when the tenant (same slug) already existed: the call only filled in what was missing. */
  created: boolean;
  adminUserId: string;
  adminEmail: string;
  /**
   * Single-use invitation secret for the admin (only the hash is stored). Present only when this
   * call created the invitation; the mail sender (M1-AUTH) delivers it. Never log it in production.
   */
  invitationToken?: string;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length >= 3 ? slug : `${slug}-org`.replace(/^-/, '');
}

/**
 * Creates a tenant with everything it needs to be usable (M1-TEN-09): tenant row, default company,
 * built-in roles and status labels (app.provision_tenant), default categories, and the first
 * administrator (invited, role tenant_admin, invitation token). One transaction, so a failure
 * leaves nothing behind. Idempotent per slug: a second call returns the existing tenant and only
 * adds what is missing. This is the ONE code path for Cloud signup, the CLI and the Self-hosted
 * first run.
 */
export async function bootstrapTenant(
  tenancy: TenancyService,
  rawInput: BootstrapTenantInput,
): Promise<BootstrapTenantResult> {
  const input = inputSchema.parse(rawInput);
  const slug = input.slug ?? slugify(input.name);
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    throw new Error(`cannot derive a valid slug from "${input.name}"; pass an explicit slug`);
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await bootstrapOnce(tenancy, input, slug);
    } catch (err) {
      // Two concurrent bootstraps of the same slug: the loser retries as "already exists".
      if (attempt === 0 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

async function bootstrapOnce(
  tenancy: TenancyService,
  input: z.output<typeof inputSchema>,
  slug: string,
): Promise<BootstrapTenantResult> {
  const existing = await tenancy.withPreTenantTx((trx) =>
    trx
      .selectFrom('identity.tenant_directory')
      .select('tenant_id')
      .where('slug', '=', slug)
      .executeTakeFirst(),
  );
  const tenantId = existing?.tenant_id ?? uuidv7();
  const created = !existing;

  return tenancy.withTenantTx({ tenantId }, async (trx) => {
    if (created) {
      await sql`select app.provision_tenant(${tenantId}::uuid, ${input.name}, ${slug}, ${input.baseCurrency}, 'us-1')`.execute(
        trx,
      );
    }
    await ensureDefaultCategories(trx, tenantId);
    const admin = await ensureAdmin(trx, tenantId, input.adminEmail, input.adminName);

    if (created) {
      await trx
        .insertInto('app.audit_log')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          actor_type: 'system',
          action: 'tenant.bootstrap',
          entity_type: 'tenant',
          entity_id: tenantId,
          diff: JSON.stringify({ after: { name: input.name, slug, adminEmail: input.adminEmail } }),
        })
        .execute();
      await trx
        .insertInto('app.outbox_event')
        .values({
          id: uuidv7(),
          tenant_id: tenantId,
          event_type: 'tenant.created',
          aggregate_type: 'tenant',
          aggregate_id: tenantId,
          payload: { slug },
        })
        .execute();
    }

    return {
      tenantId,
      slug,
      created,
      adminUserId: admin.userId,
      adminEmail: input.adminEmail,
      ...(admin.invitationToken ? { invitationToken: admin.invitationToken } : {}),
    };
  });
}

export async function ensureDefaultCategories(trx: Tx, tenantId: string): Promise<void> {
  const have = new Set(
    (
      await trx
        .selectFrom('app.category')
        .select('name')
        .where('kind', '=', 'asset')
        .where('archived_at', 'is', null)
        .execute()
    ).map((r) => r.name.toLowerCase()),
  );
  const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.name.toLowerCase()));
  if (missing.length === 0) return;
  await trx
    .insertInto('app.category')
    .values(
      missing.map((c) => ({ id: uuidv7(), tenant_id: tenantId, kind: 'asset' as const, ...c })),
    )
    .execute();
}

/** Adds a login-capable user with one role at tenant scope (and its login identity). Returns the user id. */
export async function addUser(
  trx: Tx,
  tenantId: string,
  user: { email: string; displayName: string; roleKey: string; status: 'invited' | 'active' },
): Promise<string> {
  const email = user.email.trim().toLowerCase();
  const role = await trx
    .selectFrom('app.role')
    .select('id')
    .where('key', '=', user.roleKey)
    .executeTakeFirstOrThrow();
  const userId = uuidv7();
  await trx
    .insertInto('app.user_account')
    .values({
      id: userId,
      tenant_id: tenantId,
      email,
      display_name: user.displayName,
      status: user.status,
    })
    .execute();
  await trx
    .insertInto('app.role_assignment')
    .values({
      id: uuidv7(),
      tenant_id: tenantId,
      user_id: userId,
      role_id: role.id,
      scope_type: 'tenant',
    })
    .execute();
  await trx
    .insertInto('identity.login_identity')
    .values({ tenant_id: tenantId, user_id: userId, email_lower: email })
    .execute();
  return userId;
}

async function ensureAdmin(
  trx: Tx,
  tenantId: string,
  email: string,
  displayName: string | undefined,
): Promise<{ userId: string; invitationToken?: string }> {
  const existing = await trx
    .selectFrom('app.user_account')
    .select('id')
    .where(sql<boolean>`lower(email) = ${email}`)
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  if (existing) return { userId: existing.id };

  const userId = await addUser(trx, tenantId, {
    email,
    displayName: displayName ?? email.split('@')[0]!,
    roleKey: 'tenant_admin',
    status: 'invited',
  });

  const role = await trx
    .selectFrom('app.role')
    .select('id')
    .where('key', '=', 'tenant_admin')
    .executeTakeFirstOrThrow();
  const invitationId = uuidv7();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);
  await trx
    .insertInto('app.invitation')
    .values({
      id: invitationId,
      tenant_id: tenantId,
      user_id: userId,
      email,
      role_id: role.id,
      expires_at: expiresAt,
    })
    .execute();
  const invitationToken = generateToken();
  await trx
    .insertInto('identity.invitation_token')
    .values({
      token_hash: hashToken(invitationToken),
      tenant_id: tenantId,
      invitation_id: invitationId,
      expires_at: expiresAt,
    })
    .execute();
  return { userId, invitationToken };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
