import { Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  ApiProblem,
  type FieldError,
  type IfMatch,
  type ListSpec,
  type Page,
  assertIfMatch,
  listPage,
  problem,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type OutboxPublisher,
} from '../ports/index.js';
import {
  RegistryBase,
  duplicate,
  inUse,
  invalidRef,
  type TxScope,
  stalePrecondition,
} from '../registry/index.js';
import { TenancyService, isUniqueViolation, type Tx } from '../tenancy/index.js';
import type { PersonCreate, PersonLinkUser, PersonListQuery, PersonUpdate } from './schemas.js';

type PersonRow = NonNullable<Awaited<ReturnType<Tx['person']['findUnique']>>>;

const SPEC: ListSpec = {
  sortable: {
    display_name: { kind: 'string' },
    created_at: { kind: 'date' },
    employee_ref: { kind: 'string' },
  },
  defaultSort: 'display_name',
};

/**
 * Schema `Person`. `assets_held` is computed per request. `department` is the NAME of the linked managed
 * department (read-only, kept so older readers of the field keep working); `department_id` is what is written.
 */
export function personDto(r: PersonRow, assetsHeld?: number, departmentName?: string | null) {
  return {
    id: r.id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    archived_at: r.archived_at ? r.archived_at.toISOString() : null,
    kind: r.kind,
    display_name: r.display_name,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    employee_ref: r.employee_ref,
    department_id: r.department_id,
    department: departmentName ?? null,
    job_title: r.job_title,
    location_id: r.location_id,
    company_id: r.company_id,
    status: r.status,
    notes: r.notes,
    user_id: r.user_id,
    ...(assetsHeld !== undefined ? { assets_held: assetsHeld } : {}),
  };
}

const auditView = (dto: Record<string, unknown>) => {
  const { created_at: _c, updated_at: _u, assets_held: _a, ...rest } = dto;
  return rest;
};

/**
 * People (M2-USR-01, ED-01): the assignable persons, with or without a login. Persons of login
 * accounts are created by a database trigger (migration 0040); this service manages the rest and
 * edits all of them. Persons never receive login emails (nothing here sends mail).
 */
@Injectable()
export class PeopleService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------ reads

  async list(auth: TxScope, query: PersonListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const archived =
        query.archived === 'only'
          ? { archived_at: { not: null } }
          : query.archived === 'include'
            ? {}
            : { archived_at: null };
      const filter = {
        AND: [
          archived,
          // `search_text` is the stored lower-case concatenation of name, email and employee number
          query.q ? { search_text: { contains: query.q.toLowerCase() } } : {},
          query.kind?.length ? { kind: { in: query.kind } } : {},
          query.status ? { status: query.status } : {},
          query.department_id ? { department_id: query.department_id } : {},
          query.location_id ? { location_id: query.location_id } : {},
          query.employee_ref ? { employee_ref: query.employee_ref } : {},
          query.has_login === true
            ? { NOT: { user_id: null } }
            : query.has_login === false
              ? { user_id: null }
              : {},
        ],
      };
      const page = await listPage({
        query,
        spec: SPEC,
        filters: {
          archived: query.archived,
          q: query.q,
          kind: query.kind,
          status: query.status,
          department_id: query.department_id,
          location_id: query.location_id,
          employee_ref: query.employee_ref,
          has_login: query.has_login,
        },
        fetch: ({ take, orderBy, where }) =>
          trx.person.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<PersonRow & Record<string, unknown>>>,
        count: () => trx.person.count({ where: filter }),
      });
      const [held, departments] = await Promise.all([
        this.assetsHeld(
          trx,
          page.data.map((p) => p.id),
        ),
        this.departmentNames(
          trx,
          page.data.map((p) => p.department_id),
        ),
      ]);
      return {
        data: page.data.map((r) =>
          personDto(r, held.get(r.id) ?? 0, this.nameOf(departments, r.department_id)),
        ),
        page: page.page,
      };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.person.findUnique({ where: { id } });
      if (!row) throw problem.notFound('Person not found.');
      return { data: await this.view(trx, row), version: row.version };
    });
  }

  /** The person with its computed members (assets held, department name). */
  private async view(trx: Tx, row: PersonRow): Promise<Record<string, unknown>> {
    const [held, departments] = await Promise.all([
      this.assetsHeld(trx, [row.id]),
      this.departmentNames(trx, [row.department_id]),
    ]);
    return personDto(row, held.get(row.id) ?? 0, this.nameOf(departments, row.department_id));
  }

  /** Names of the given departments (archived ones included: a person may still point at one). */
  private async departmentNames(trx: Tx, ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await trx.department.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((d) => [d.id, d.name]));
  }

  private nameOf(names: Map<string, string>, id: string | null): string | null {
    return id ? (names.get(id) ?? null) : null;
  }

  /** Assets currently checked out to each person (open, asset-bound assignments). */
  private async assetsHeld(trx: Tx, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await trx.$queryRaw<Array<{ person_id: string; n: bigint }>>`
      select person_id, count(*) as n from app.assignment
       where person_id = any(${ids}::uuid[]) and asset_id is not null and checked_in_at is null
       group by person_id`;
    return new Map(rows.map((r) => [r.person_id, Number(r.n)]));
  }

  // ----------------------------------------------------------------------------------- writes

  async create(
    auth: AuthContext,
    body: PersonCreate,
    meta?: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const errors: FieldError[] = [];
        await this.checkRefs(trx, body, errors);
        const company = body.company_id
          ? await trx.company.findUnique({ where: { id: body.company_id } })
          : await trx.company.findFirst({ where: { is_default: true } });
        if (!company) errors.push(invalidRef('/company_id', 'No such company.'));
        if (errors.length > 0) throw problem.validation(errors);
        await this.assertUnique(trx, body.email, body.employee_ref, undefined);

        const row = await trx.person.create({
          data: {
            id: uuidv7(),
            tenant_id: auth.tenantId,
            company_id: company!.id,
            kind: body.kind ?? 'employee',
            display_name: body.display_name,
            first_name: body.first_name ?? null,
            last_name: body.last_name ?? null,
            email: body.email ?? null,
            phone: body.phone ?? null,
            employee_ref: body.employee_ref ?? null,
            department_id: body.department_id ?? null,
            job_title: body.job_title ?? null,
            location_id: body.location_id ?? null,
            status: body.status ?? 'active',
            notes: body.notes ?? null,
            created_by: auth.userId,
          },
        });
        await this.record(trx, {
          entity: 'person',
          verb: 'created',
          ...(meta ? { meta } : {}),
          id: row.id,
          version: row.version,
          before: null,
          after: auditView(personDto(row)),
        });
        return { data: await this.view(trx, row), version: row.version };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: PersonUpdate,
    importMeta?: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const row = await trx.person.findUnique({ where: { id } });
        if (!row || row.archived_at) throw problem.notFound('Person not found.');
        assertIfMatch(ifMatch, row.version);

        const errors: FieldError[] = [];
        const refs: Pick<PersonUpdate, 'location_id' | 'department_id'> = {
          ...(body.location_id !== undefined && body.location_id !== row.location_id
            ? { location_id: body.location_id }
            : {}),
          ...(body.department_id !== undefined && body.department_id !== row.department_id
            ? { department_id: body.department_id }
            : {}),
        };
        await this.checkRefs(trx, refs, errors);
        if (body.company_id !== undefined && body.company_id !== row.company_id) {
          const company = await trx.company.findUnique({ where: { id: body.company_id } });
          if (!company) errors.push(invalidRef('/company_id', 'No such company.'));
        }
        if (errors.length > 0) throw problem.validation(errors);

        const changes: Record<string, unknown> = {};
        for (const key of [
          'kind',
          'display_name',
          'first_name',
          'last_name',
          'email',
          'phone',
          'employee_ref',
          'department_id',
          'job_title',
          'location_id',
          'company_id',
          'status',
          'notes',
        ] as const) {
          const value = body[key];
          if (value !== undefined && value !== row[key]) changes[key] = value;
        }

        // Deactivating a person who still holds things: refused unless forced with a reason.
        let meta: Record<string, unknown> | undefined;
        if (changes.status === 'inactive') {
          const open = await trx.assignment.count({
            where: { person_id: id, checked_in_at: null },
          });
          if (open > 0) {
            if (!body.force) throw inUse('Person', { open_assignments: open });
            if (!body.reason) {
              throw problem.validation([
                {
                  pointer: '/reason',
                  message: 'a forced deactivation needs a reason',
                  code: 'required',
                },
              ]);
            }
            meta = { forced_deactivation: true, reason: body.reason, open_assignments: open };
          }
        }

        if (Object.keys(changes).length === 0) {
          return { data: await this.view(trx, row), version: row.version };
        }
        await this.assertUnique(
          trx,
          'email' in changes ? (changes.email as string | null) : undefined,
          'employee_ref' in changes ? (changes.employee_ref as string | null) : undefined,
          id,
        );
        const result = await trx.person.updateMany({
          where: { id, version: row.version },
          data: { ...changes, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.person.findUnique({ where: { id } }), 'Person');
        }
        const updated = (await trx.person.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'person',
          verb: 'updated',
          ...(meta || importMeta ? { meta: { ...importMeta, ...meta } } : {}),
          id,
          version: updated.version,
          before: auditView(personDto(row)),
          after: auditView(personDto(updated)),
        });
        return { data: await this.view(trx, updated), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  async archive(auth: AuthContext, id: string, ifMatch: IfMatch): Promise<void> {
    await this.tx(auth, async (trx) => {
      const row = await trx.person.findUnique({ where: { id } });
      if (!row || row.archived_at) throw problem.notFound('Person not found.');
      assertIfMatch(ifMatch, row.version);
      const open = await trx.assignment.count({ where: { person_id: id, checked_in_at: null } });
      if (open > 0 || row.user_id) {
        throw inUse('Person', { open_assignments: open, login_accounts: row.user_id ? 1 : 0 });
      }
      const result = await trx.person.updateMany({
        where: { id, version: row.version },
        data: { archived_at: new Date(), updated_by: auth.userId },
      });
      if (result.count === 0) {
        return stalePrecondition(() => trx.person.findUnique({ where: { id } }), 'Person');
      }
      const updated = (await trx.person.findUnique({ where: { id } }))!;
      await this.record(trx, {
        entity: 'person',
        verb: 'archived',
        id,
        version: updated.version,
        before: auditView(personDto(row)),
        after: auditView(personDto(updated)),
      });
    });
  }

  // ------------------------------------------------------------------- login link (M2-USR-03)

  /**
   * Links an existing person to an existing login account of the tenant (ED-22). Every login
   * already has the person the system created for it (ED-15; `created_by` is null), so linking
   * REPLACES that placeholder: it is archived (never deleted: its history keeps pointing at it)
   * and the login moves to the chosen person, who keeps every assignment and history entry.
   * Refused (409) while the placeholder still holds assets, when the chosen person already has a
   * login, and when the login's person was chosen by somebody (unlink it first).
   */
  async linkUser(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: PersonLinkUser,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const person = await trx.person.findUnique({ where: { id } });
        if (!person || person.archived_at) throw problem.notFound('Person not found.');
        assertIfMatch(ifMatch, person.version);
        const user = await trx.user_account.findUnique({ where: { id: body.user_id } });
        if (!user) throw problem.validation([invalidRef('/user_id', 'No such login account.')]);
        if (user.archived_at) {
          throw problem.validation([
            { pointer: '/user_id', message: 'the login account is archived', code: 'archived' },
          ]);
        }
        if (person.user_id === user.id) {
          return { data: await this.view(trx, person), version: person.version }; // already done
        }
        if (person.user_id) {
          throw new ApiProblem({
            code: 'person-already-linked',
            detail: `${person.display_name} is already linked to another login account. Unlink it first.`,
            errors: [{ pointer: '/user_id', message: 'the person has a login', code: 'taken' }],
          });
        }

        // the placeholder person of the login (at most one: `unique (tenant_id, user_id)`)
        const placeholder = await trx.person.findFirst({ where: { user_id: user.id } });
        if (placeholder && placeholder.created_by !== null) {
          // a person somebody made or linked on purpose is never replaced silently
          throw new ApiProblem({
            code: 'login-already-linked',
            detail: `The login account is already linked to ${placeholder.display_name}. Unlink that person first.`,
            errors: [{ pointer: '/user_id', message: 'the login has a person', code: 'taken' }],
          });
        }
        if (placeholder) {
          const open = await trx.assignment.count({
            where: { person_id: placeholder.id, checked_in_at: null },
          });
          if (open > 0) {
            throw new ApiProblem({
              code: 'login-person-in-use',
              detail: `The login's own person record (${placeholder.display_name}) still holds ${open} asset${open === 1 ? '' : 's'}. Check them in or transfer them first.`,
              extensions: { usage: { open_assignments: open } },
            });
          }
          await trx.person.update({
            where: { id: placeholder.id },
            data: { user_id: null, archived_at: new Date(), updated_by: auth.userId },
          });
          // a department headed by the placeholder is now headed by the person the login is
          await trx.department.updateMany({
            where: { manager_person_id: placeholder.id },
            data: { manager_person_id: person.id, updated_by: auth.userId },
          });
        }
        const result = await trx.person.updateMany({
          where: { id, version: person.version },
          data: { user_id: user.id, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.person.findUnique({ where: { id } }), 'Person');
        }
        const updated = (await trx.person.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'person',
          verb: 'user_linked',
          id,
          version: updated.version,
          before: { user_id: null },
          after: { user_id: user.id },
          meta: {
            user_id: user.id,
            user_email: user.email,
            ...(placeholder
              ? {
                  replaced_person_id: placeholder.id,
                  replaced_person_name: placeholder.display_name,
                }
              : {}),
          },
          refs: { userId: user.id },
        });
        return { data: await this.view(trx, updated), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  /**
   * Removes the login from a person (ED-22). The person stays, with its assignments and history,
   * as a person without a login. The login keeps exactly one person (ED-15): a fresh one is made
   * from its name and email (the email is left empty while a live person already uses it, which is
   * the case of the person just unlinked), the same as the trigger does for a new account.
   */
  async unlinkUser(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    try {
      return await this.tx(auth, async (trx) => {
        const person = await trx.person.findUnique({ where: { id } });
        if (!person || person.archived_at) throw problem.notFound('Person not found.');
        assertIfMatch(ifMatch, person.version);
        if (!person.user_id) {
          throw problem.conflict('This person has no login account to unlink.');
        }
        const user = await trx.user_account.findUnique({ where: { id: person.user_id } });
        const result = await trx.person.updateMany({
          where: { id, version: person.version },
          data: { user_id: null, updated_by: auth.userId },
        });
        if (result.count === 0) {
          return stalePrecondition(() => trx.person.findUnique({ where: { id } }), 'Person');
        }
        let newPersonId: string | null = null;
        if (user && !user.archived_at) {
          const emailTaken = await trx.person.findFirst({
            where: { email_key: user.email.toLowerCase(), archived_at: null },
            select: { id: true },
          });
          const company =
            (await trx.company.findFirst({ where: { is_default: true } })) ??
            (await trx.company.findUnique({ where: { id: person.company_id } }));
          const created = await trx.person.create({
            data: {
              id: uuidv7(),
              tenant_id: auth.tenantId,
              company_id: company!.id,
              user_id: user.id,
              kind: 'employee',
              display_name: user.display_name,
              email: emailTaken ? null : user.email,
              created_by: null, // a placeholder, like the one the database trigger makes
            },
          });
          newPersonId = created.id;
        }
        const updated = (await trx.person.findUnique({ where: { id } }))!;
        await this.record(trx, {
          entity: 'person',
          verb: 'user_unlinked',
          id,
          version: updated.version,
          before: { user_id: person.user_id },
          after: { user_id: null },
          meta: {
            user_id: person.user_id,
            ...(user ? { user_email: user.email } : {}),
            ...(newPersonId ? { new_person_id: newPersonId } : {}),
          },
          refs: { userId: person.user_id },
        });
        return { data: await this.view(trx, updated), version: updated.version };
      });
    } catch (err) {
      throw this.translate(err);
    }
  }

  // ------------------------------------------------------------------------------------ helpers

  private async checkRefs(
    trx: Tx,
    body: Pick<PersonCreate, 'location_id' | 'department_id'>,
    errors: FieldError[],
  ): Promise<void> {
    if (body.location_id) {
      const location = await trx.location.findUnique({ where: { id: body.location_id } });
      if (!location || location.archived_at) {
        errors.push(invalidRef('/location_id', 'No such location.'));
      }
    }
    if (body.department_id) {
      const department = await trx.department.findUnique({ where: { id: body.department_id } });
      if (!department || department.archived_at) {
        errors.push(invalidRef('/department_id', 'No such department.'));
      }
    }
  }

  /** Email and employee number are unique among live people (`409 conflict`, pointer on the field). */
  private async assertUnique(
    trx: Tx,
    email: string | null | undefined,
    employeeRef: string | null | undefined,
    selfId: string | undefined,
  ): Promise<void> {
    const other = selfId ? { NOT: { id: selfId } } : {};
    if (email) {
      const taken = await trx.person.findFirst({
        where: { email_key: email.toLowerCase(), archived_at: null, ...other },
        select: { id: true },
      });
      if (taken) throw duplicate('A person with the email', '/email', email);
    }
    if (employeeRef) {
      const taken = await trx.person.findFirst({
        where: { employee_ref: employeeRef, archived_at: null, ...other },
        select: { id: true },
      });
      if (taken) throw duplicate('A person with the employee number', '/employee_ref', employeeRef);
    }
  }

  private translate(err: unknown): unknown {
    if (isUniqueViolation(err)) {
      return problem.conflict('A person with this email or employee number already exists.');
    }
    return err;
  }
}
