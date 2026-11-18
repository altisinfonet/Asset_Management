import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '../ids/uuidv7.js';
import { type ListQuery, type ListSpec, listPage, problem } from '../platform/index.js';
import { AUDIT_WRITER, type AuditWriter } from '../ports/index.js';
import { asBytes, TenancyService, type Prisma, type Tx } from '../tenancy/index.js';
import type { AuthContext } from './auth-context.js';
import { PERMISSIONS } from './permissions.js';
import { PolicyService, permits } from './policy.service.js';

const PREFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export const apiKeyListSpec: ListSpec = {
  sortable: { created_at: { kind: 'date' } },
  defaultSort: '-created_at',
};

/**
 * Scoped API keys (bearer `<prefix>.<secret>`; contract tag Access). The secret is shown once; the
 * tenant row (`app.api_key`) keeps prefix, scopes, expiry and revocation, `identity.api_key_lookup`
 * keeps the SHA-256 of the secret for the pre-tenant lookup. A key can never exceed its creator: its
 * scopes must be permitted by the creator's roles, and are re-intersected at every request.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly policy: PolicyService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.principalId }, fn);
  }

  private dto(k: {
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    expires_at: Date | null;
    last_used_at: Date | null;
    revoked_at: Date | null;
    created_at: Date;
    created_by: string | null;
  }) {
    return {
      id: k.id,
      name: k.name,
      key_prefix: k.key_prefix,
      scopes: k.scopes,
      expires_at: k.expires_at?.toISOString() ?? null,
      last_used_at: k.last_used_at?.toISOString() ?? null,
      revoked_at: k.revoked_at?.toISOString() ?? null,
      created_at: k.created_at.toISOString(),
      created_by: k.created_by,
    };
  }

  list(auth: AuthContext, query: ListQuery) {
    return this.tx(auth, async (trx) => {
      const page = await listPage({
        query,
        spec: apiKeyListSpec,
        fetch: ({ take, orderBy, where }) =>
          trx.api_key.findMany({
            where: (where ?? {}) as Prisma.api_keyWhereInput,
            orderBy: orderBy as Prisma.api_keyOrderByWithRelationInput[],
            take,
          }) as Promise<
            Array<
              Record<string, unknown> & Awaited<ReturnType<typeof trx.api_key.findFirstOrThrow>>
            >
          >,
        count: () => trx.api_key.count(),
      });
      return { data: page.data.map((k) => this.dto(k)), page: page.page };
    });
  }

  async create(
    auth: AuthContext,
    body: { name: string; scopes: string[]; expires_at?: string | null },
  ) {
    const known = new Set<string>(PERMISSIONS);
    const unknown = body.scopes.filter((s) => s !== '*' && !known.has(s) && !s.endsWith(':*'));
    if (unknown.length > 0 || body.scopes.includes('*')) {
      throw problem.validation(
        body.scopes.flatMap((s, i) =>
          s === '*' || (!known.has(s) && !s.endsWith(':*'))
            ? [
                {
                  pointer: `/scopes/${i}`,
                  message: `"${s}" is not an assignable scope.`,
                  code: 'invalid',
                },
              ]
            : [],
        ),
      );
    }
    const mine = this.policy.effectivePermissions({
      grants: auth.grants,
      keyScopes: auth.apiKeyScopes,
    });
    const excess = body.scopes.filter((s) => !permits(mine, s));
    if (excess.length > 0) {
      throw problem.forbidden(
        `A key cannot exceed your own permissions (not held: ${excess.join(', ')}).`,
      );
    }
    const expiresAt = body.expires_at ? new Date(body.expires_at) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw problem.validation([
        { pointer: '/expires_at', message: 'Must be in the future.', code: 'invalid' },
      ]);
    }

    const prefix = Array.from(
      randomBytes(12),
      (b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length],
    ).join('');
    const secret = randomBytes(32).toString('base64url');
    const id = uuidv7();
    const row = await this.tx(auth, async (trx) => {
      const created = await trx.api_key.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          name: body.name,
          key_prefix: prefix,
          scopes: body.scopes,
          expires_at: expiresAt,
          created_by: auth.userId,
        },
      });
      await trx.api_key_lookup.create({
        data: {
          key_prefix: prefix,
          key_hash: asBytes(createHash('sha256').update(secret).digest()),
          tenant_id: auth.tenantId,
          api_key_id: id,
        },
      });
      await this.audit.write(trx, {
        action: 'api_key.created',
        entityType: 'api_key',
        entityId: id,
        after: { name: body.name, key_prefix: prefix, scopes: body.scopes },
      });
      return created;
    });
    return { ...this.dto(row), secret: `${prefix}.${secret}` };
  }

  async revoke(auth: AuthContext, id: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      const key = await trx.api_key.findUnique({ where: { id } });
      if (!key) throw problem.notFound('API key not found.');
      if (key.revoked_at) throw problem.conflict('The API key is already revoked.');
      await trx.api_key.update({ where: { id }, data: { revoked_at: new Date() } });
      await trx.api_key_lookup.deleteMany({ where: { api_key_id: id } });
      await this.audit.write(trx, {
        action: 'api_key.revoked',
        entityType: 'api_key',
        entityId: id,
        before: { name: key.name, key_prefix: key.key_prefix },
      });
    });
  }
}
