import { z } from 'zod';
import { generateToken, hashToken } from '../identity/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { asBytes, isUniqueViolation, type TenancyService, type Tx } from '../tenancy/index.js';

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
    trx.tenant_directory.findUnique({ where: { slug }, select: { tenant_id: true } }),
  );
  const tenantId = existing?.tenant_id ?? uuidv7();
  const created = !existing;

  return tenancy.withTenantTx({ tenantId }, async (trx) => {
    if (created) {
      await trx.$executeRaw`select app.provision_tenant(${tenantId}::uuid, ${input.name}, ${slug}, ${input.baseCurrency}, 'us-1')`;
    }
    await ensureDefaultCategories(trx, tenantId);
    // M2-TAG-02: the fixed label templates (own function, idempotent; also fills a tenant that lacks them)
    await trx.$executeRaw`select app.seed_label_templates(${tenantId}::uuid)`;
    const admin = await ensureAdmin(trx, tenantId, input.adminEmail, input.adminName);

    if (created) {
      // audit_log is a partitioned table: written with a tagged-template raw statement.
      const diff = JSON.stringify({
        after: { name: input.name, slug, adminEmail: input.adminEmail },
      });
      await trx.$executeRaw`
        insert into app.audit_log (id, tenant_id, actor_type, action, entity_type, entity_id, diff)
        values (${uuidv7()}::uuid, ${tenantId}::uuid, 'system', 'tenant.bootstrap', 'tenant',
                ${tenantId}::uuid, ${diff}::jsonb)`;
      await trx.outbox_event.create({
        data: {
          id: uuidv7(),
          tenant_id: tenantId,
          event_type: 'tenant.created',
          aggregate_type: 'tenant',
          aggregate_id: tenantId,
          payload: { slug },
        },
      });
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
      await trx.category.findMany({
        where: { kind: 'asset', archived_at: null },
        select: { name: true },
      })
    ).map((r) => r.name.toLowerCase()),
  );
  const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.name.toLowerCase()));
  if (missing.length === 0) return;
  await trx.category.createMany({
    data: missing.map((c) => ({ id: uuidv7(), tenant_id: tenantId, kind: 'asset', ...c })),
  });
}

/** Adds a login-capable user with one role at tenant scope (and its login identity). Returns the user id. */
export async function addUser(
  trx: Tx,
  tenantId: string,
  user: { email: string; displayName: string; roleKey: string; status: 'invited' | 'active' },
): Promise<string> {
  const email = user.email.trim().toLowerCase();
  const role = await trx.role.findFirstOrThrow({
    where: { key: user.roleKey },
    select: { id: true },
  });
  const userId = uuidv7();
  await trx.user_account.create({
    data: {
      id: userId,
      tenant_id: tenantId,
      email,
      display_name: user.displayName,
      status: user.status,
    },
  });
  await trx.role_assignment.create({
    data: {
      id: uuidv7(),
      tenant_id: tenantId,
      user_id: userId,
      role_id: role.id,
      scope_type: 'tenant',
    },
  });
  await trx.login_identity.create({
    data: { tenant_id: tenantId, user_id: userId, email_lower: email },
  });
  return userId;
}

async function ensureAdmin(
  trx: Tx,
  tenantId: string,
  email: string,
  displayName: string | undefined,
): Promise<{ userId: string; invitationToken?: string }> {
  // lower(email) is an expression Prisma cannot filter on: a tagged-template raw query does it.
  const [existing] = await trx.$queryRaw<Array<{ id: string }>>`
    select id::text as id from app.user_account
    where lower(email) = ${email} and archived_at is null limit 1`;
  if (existing) return { userId: existing.id };

  const userId = await addUser(trx, tenantId, {
    email,
    displayName: displayName ?? email.split('@')[0]!,
    roleKey: 'tenant_admin',
    status: 'invited',
  });

  const role = await trx.role.findFirstOrThrow({
    where: { key: 'tenant_admin' },
    select: { id: true },
  });
  const invitationId = uuidv7();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);
  await trx.invitation.create({
    data: {
      id: invitationId,
      tenant_id: tenantId,
      user_id: userId,
      email,
      role_id: role.id,
      expires_at: expiresAt,
    },
  });
  const invitationToken = generateToken();
  await trx.invitation_token.create({
    data: {
      token_hash: asBytes(hashToken(invitationToken)),
      tenant_id: tenantId,
      invitation_id: invitationId,
      expires_at: expiresAt,
    },
  });
  return { userId, invitationToken };
}
