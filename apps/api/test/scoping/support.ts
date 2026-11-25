import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  Client,
  type TenantFixture,
  mailToken,
  newPassword,
  testPorts,
  uniq,
} from '../auth/support.js';

/**
 * M2-LOC-03 (ED-26): a login whose role assignment is limited to a location subtree, created the way
 * an administrator does it (Settings > Users: `POST /v1/users` with `scope_type=location`), invitation
 * accepted through the mailed token.
 */
export function createScopedUser(
  app: NestFastifyApplication,
  tenant: TenantFixture,
  roleKey: string,
  locationIds: string[],
  label = `${roleKey}-scoped`,
): Promise<{ id: string; email: string; client: Client }> {
  return createUserWith(
    app,
    tenant,
    locationIds.map((id) => ({
      role_id: tenant.roles[roleKey]!,
      scope_type: 'location',
      location_id: id,
    })),
    label,
  );
}

/** A login with exactly these role assignments (any mix of org-wide and location-scoped). */
export async function createUserWith(
  app: NestFastifyApplication,
  tenant: TenantFixture,
  assignments: Array<{ role_id: string; scope_type?: string; location_id?: string }>,
  label: string,
): Promise<{ id: string; email: string; password: string; client: Client }> {
  const email = `${label}-${uniq()}@${tenant.slug}.example`;
  const before = testPorts.mail.sent.length;
  const created = await tenant.admin.post('/v1/users', {
    email,
    display_name: `Scoped ${label}`,
    role_assignments: assignments,
  });
  if (created.status !== 201) {
    throw new Error(`create scoped user failed: ${created.status} ${created.raw}`);
  }
  const mail = testPorts.mail.sent
    .slice(before)
    .find((m) => m.to === email && m.template === 'auth.invitation');
  if (!mail) throw new Error('no invitation mail captured');
  const client = new Client(app);
  const password = newPassword();
  const res = await client.post('/v1/auth/invitations/accept', {
    token: mailToken(mail),
    password,
    display_name: `Scoped ${label}`,
  });
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${res.raw}`);
  client.csrf = res.body.csrf_token;
  return { id: created.body.id, email, password, client };
}
