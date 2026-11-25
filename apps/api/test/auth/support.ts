import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApiApp } from '../../src/app.js';
import { bootstrapTenant } from '../../src/bootstrap/bootstrap-tenant.js';
import { loadConfig } from '../../src/config/env.js';
import { base32Decode, hotp, totpStep } from '../../src/auth/totp.js';
import { dbEnabled, env, jobsSchema, newTenancy, withClient } from '../support/db.js';
import { observe } from '../support/contract-observer.js';
import { testPorts, TestPortsModule } from '../support/test-ports.js';
import type { TenancyService } from '../../src/tenancy/index.js';

export { dbEnabled, env, testPorts, withClient };

export const COOKIE = '__Host-at_session';
/** Cookie name when the app runs with SESSION_COOKIE_SECURE=false (ED-30). */
export const COOKIE_INSECURE = 'at_session';

export interface Resp {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string | string[] | number | undefined>;
  raw: string;
}

let ipCounter = Math.floor(Math.random() * 200) + 20;
/** A unique client address per test client: per-IP throttling must not couple unrelated tests. */
export const freshIp = () =>
  `10.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}.${Math.floor(Math.random() * 250) + 1}`;

export const uniq = () => randomBytes(5).toString('hex');
export const newPassword = () => `Pw-${randomBytes(9).toString('base64url')}-ok`;

/**
 * `realPorts: true` leaves the capturing fakes out so the platform ports (PgAuditWriter,
 * QueuedMailSender, pg-boss, EnvelopeSecretBox) serve the auth module, as in production.
 */
export async function startApp(
  extra: Record<string, string> = {},
  options: { realPorts?: boolean; ports?: Type<unknown> } = {},
) {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: env.databaseUrl!,
    // E2E_LOG_LEVEL=error shows the server side of an unexpected 500 while diagnosing a run
    LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'silent',
    GIT_SHA: 'e2e',
    // Cheap argon2 so the suite is fast; the production defaults are covered by a unit test.
    ARGON2_MEMORY_KIB: '64',
    ARGON2_TIME_COST: '1',
    WEB_BASE_URL: 'http://web.test',
    JOBS_SCHEMA: jobsSchema,
    // app.inject connects from loopback; trusting only it lets each test client pick its address
    // through X-Forwarded-For (per-IP throttling must not couple unrelated tests).
    TRUST_PROXY: '127.0.0.1',
    IDEMPOTENCY_LOCK_TIMEOUT_MS: '500',
    // the real local storage adapter (unused: the test ports bind fakes) must not write into the repo
    FILES_LOCAL_DIR: join(tmpdir(), 'at-api-e2e-files'),
    ...extra,
  });
  const app = await createApiApp(
    config,
    options.realPorts ? [] : [options.ports ?? TestPortsModule],
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, config };
}

/** A cookie-jar HTTP client over `app.inject` that behaves like the browser: cookie in, CSRF header on mutations. */
export class Client {
  cookie: string | undefined;
  /** Name of the session cookie the server uses; learned from the first Set-Cookie (secure mode by default). */
  cookieName: string = COOKIE;
  csrf: string | undefined;
  constructor(
    readonly app: NestFastifyApplication,
    readonly ip: string = freshIp(),
  ) {}

  clone(): Client {
    const c = new Client(this.app, this.ip);
    c.cookie = this.cookie;
    c.cookieName = this.cookieName;
    c.csrf = this.csrf;
    return c;
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    opts: {
      body?: unknown;
      headers?: Record<string, string>;
      /** send the CSRF header on non-GET (default true when this client has a token) */
      csrf?: boolean | string;
      /** send the cookie (default true) */
      cookie?: boolean | string;
    } = {},
  ): Promise<Resp> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip, ...opts.headers };
    const cookie =
      opts.cookie === false
        ? undefined
        : typeof opts.cookie === 'string'
          ? opts.cookie
          : this.cookie;
    if (cookie) headers.cookie = cookie.includes('=') ? cookie : `${this.cookieName}=${cookie}`;
    if (method !== 'GET' && opts.csrf !== false) {
      const token = typeof opts.csrf === 'string' ? opts.csrf : this.csrf;
      if (token) headers['x-csrf-token'] = token;
    }
    const res = await this.app.inject({
      method,
      url,
      headers,
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    observe(method, url, res.statusCode);
    const set = res.headers['set-cookie'];
    const lines = Array.isArray(set) ? set : set ? [set] : [];
    for (const line of lines) {
      const [pair] = line.split(';');
      const [name, ...rest] = pair!.split('=');
      if (name === COOKIE || name === COOKIE_INSECURE) {
        this.cookieName = name;
        const value = rest.join('=');
        this.cookie = /Max-Age=0/i.test(line) || value === '' ? undefined : `${name}=${value}`;
      }
    }
    let body: unknown;
    try {
      body = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.statusCode, body, headers: res.headers, raw: res.body };
  }

  get = (url: string, o?: Parameters<Client['request']>[2]) => this.request('GET', url, o);
  post = (url: string, body?: unknown, o?: Parameters<Client['request']>[2]) =>
    this.request('POST', url, { ...o, body });
  patch = (url: string, body: unknown, o?: Parameters<Client['request']>[2]) =>
    this.request('PATCH', url, { ...o, body });
  put = (url: string, body: unknown, o?: Parameters<Client['request']>[2]) =>
    this.request('PUT', url, { ...o, body });
  del = (url: string, body?: unknown, o?: Parameters<Client['request']>[2]) =>
    this.request('DELETE', url, { ...o, body });

  /** Raw cookie token value (what the browser holds). */
  get token(): string | undefined {
    return this.cookie?.slice(this.cookieName.length + 1);
  }

  async login(email: string, password: string, extra: Record<string, unknown> = {}): Promise<Resp> {
    const res = await this.post('/v1/auth/login', { email, password, ...extra });
    if (res.body?.csrf_token) this.csrf = res.body.csrf_token;
    return res;
  }
}

export interface TenantFixture {
  tenantId: string;
  slug: string;
  name: string;
  adminEmail: string;
  adminPassword: string;
  admin: Client;
  roles: Record<string, string>;
}

/** Bootstraps a tenant through the real code path, accepts the admin invitation through the API. */
export async function createTenant(
  app: NestFastifyApplication,
  tenancy: TenancyService,
  label: string,
  opts: { adminEmail?: string } = {},
): Promise<TenantFixture> {
  const id = uniq();
  const slug = `a-${label.toLowerCase()}-${id}`;
  const adminEmail = opts.adminEmail ?? `admin-${id}@${slug}.example`;
  const boot = await bootstrapTenant(tenancy, {
    name: `Tenant ${label} ${id}`,
    slug,
    adminEmail,
    adminName: `Admin ${label}`,
  });
  const adminPassword = newPassword();
  const admin = new Client(app);
  const res = await admin.post('/v1/auth/invitations/accept', {
    token: boot.invitationToken,
    password: adminPassword,
    display_name: `Admin ${label}`,
  });
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${res.raw}`);
  admin.csrf = res.body.csrf_token;
  const roles = await admin.get('/v1/roles');
  return {
    tenantId: boot.tenantId,
    slug,
    name: `Tenant ${label} ${id}`,
    adminEmail,
    adminPassword,
    admin,
    roles: Object.fromEntries(
      roles.body.data.map((r: { key: string; id: string }) => [r.key, r.id]),
    ),
  };
}

export interface UserFixture {
  id: string;
  email: string;
  password: string;
  client: Client;
}

/** Invites a user through the admin API, accepts the mailed token and returns the signed-in client. */
export async function createUser(
  app: NestFastifyApplication,
  tenant: TenantFixture,
  roleKey: string,
  label = roleKey,
): Promise<UserFixture> {
  const email = `${label}-${uniq()}@${tenant.slug}.example`;
  const before = testPorts.mail.sent.length;
  const created = await tenant.admin.post('/v1/users', {
    email,
    display_name: `User ${label}`,
    role_assignments: [{ role_id: tenant.roles[roleKey] }],
  });
  if (created.status !== 201)
    throw new Error(`create user failed: ${created.status} ${created.raw}`);
  const mail = testPorts.mail.sent
    .slice(before)
    .find((m) => m.to === email && m.template === 'auth.invitation');
  if (!mail) throw new Error('no invitation mail captured');
  const password = newPassword();
  const client = new Client(app);
  const res = await client.post('/v1/auth/invitations/accept', {
    token: mailToken(mail),
    password,
    display_name: `User ${label}`,
  });
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${res.raw}`);
  client.csrf = res.body.csrf_token;
  return { id: created.body.id, email, password, client };
}

/** Enrols TOTP for the client's user; returns the secret and recovery codes. Leaves the session rotated. */
export async function enrolMfa(
  client: Client,
): Promise<{ secret: Uint8Array; recoveryCodes: string[] }> {
  const enrol = await client.post('/v1/auth/mfa/enrol', {});
  if (enrol.status !== 200) throw new Error(`enrol failed ${enrol.status} ${enrol.raw}`);
  const secret = base32Decode(enrol.body.secret);
  const confirm = await client.post('/v1/auth/mfa/enrol/confirm', { code: codeAt(secret, 0) });
  if (confirm.status !== 200) throw new Error(`confirm failed ${confirm.status} ${confirm.raw}`);
  client.csrf = confirm.body.csrf_token;
  return { secret, recoveryCodes: confirm.body.recovery_codes };
}

/** The TOTP code for the current step plus `offset` steps. */
export const codeAt = (secret: Uint8Array, offset: number) =>
  hotp(secret, totpStep(Date.now()) + offset);

/** The single-use token inside a captured invitation / password-reset mail (it travels only as a link). */
export const mailToken = (mail: { data: Record<string, unknown> }): string => {
  const url = String(mail.data.acceptUrl ?? mail.data.resetUrl);
  const token = new URL(url).searchParams.get('token');
  if (!token) throw new Error(`no token in mail link ${url}`);
  return token;
};

export const mailsTo = (email: string, template?: string) =>
  testPorts.mail.sent.filter((m) => m.to === email && (!template || m.template === template));

/** Runs raw SQL as the schema owner (no RLS bypass: tenant tables still need a tenant; identity tables do not). */
export async function ownerSql(sql: string, params: unknown[] = []) {
  return withClient(env.migratorUrl!, (c) => c.query(sql, params));
}

/** Owner SQL inside a tenant context (FORCE RLS binds the owner too): for aging rows, planting fixtures. */
export async function ownerTenantSql(tenantId: string, sql: string, params: unknown[] = []) {
  return withClient(env.migratorUrl!, async (c) => {
    await c.query('begin');
    try {
      await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = await c.query(sql, params);
      await c.query('commit');
      return result;
    } catch (err) {
      await c.query('rollback');
      throw err;
    }
  });
}

/** Sets `app.tenant.settings.mfa_required` (off | admins | all). */
export const setMfaPolicy = (tenantId: string, mode: 'off' | 'admins' | 'all') =>
  ownerTenantSql(
    tenantId,
    `update app.tenant set settings = jsonb_set(settings, '{mfa_required}', to_jsonb($1::text)) where id = $2`,
    [mode, tenantId],
  );

export { newTenancy };
