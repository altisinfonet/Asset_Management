import { personCreateSchema, personUpdateSchema, type PeopleService } from '../../people/index.js';
import type { RefResolver } from '../refs.js';
import type { MappedRecord, RowIssue } from '../types.js';
import { normKey } from '../values.js';
import { type Existing, type Prep, ServiceHandler } from './service-handler.js';
import { type HandlerEnv, plainPointer } from './shared.js';

const FIELDS = [
  'display_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'employee_ref',
  'job_title',
  'kind',
  'status',
  'notes',
] as const;
const CLEARABLE = [
  'first_name',
  'last_name',
  'phone',
  'employee_ref',
  'job_title',
  'notes',
] as const;

/** People imports (M2-IMP-07): matched by email, else by employee number; written by `PeopleService`. */
export class PersonHandler extends ServiceHandler {
  protected readonly label = 'person';
  protected readonly pointer = plainPointer({
    department_id: 'department',
    location_id: 'location',
  });
  protected readonly createSchema = personCreateSchema;
  protected readonly updateSchema = personUpdateSchema;
  protected readonly identity = [] as const;

  constructor(private readonly people: PeopleService) {
    super();
  }

  protected override refField(kind: string): string {
    return kind;
  }

  keys(rec: MappedRecord): { k1: string | null; k2: string | null } {
    const email = typeof rec.f.email === 'string' ? normKey(rec.f.email) : '';
    const ref = typeof rec.f.employee_ref === 'string' ? normKey(rec.f.employee_ref) : '';
    return { k1: email ? `email:${email}` : null, k2: ref ? `ref:${ref}` : null };
  }

  protected async prepare(
    env: HandlerEnv,
    resolver: RefResolver,
    rec: MappedRecord,
  ): Promise<Prep> {
    const prep: Prep = { issues: [], warnings: [], create: {}, update: {}, pending: false };
    const f = rec.f;
    for (const key of FIELDS) {
      if (f[key] !== undefined) {
        prep.create[key] = f[key];
        prep.update[key] = f[key];
      }
    }
    if (prep.create.display_name === undefined) {
      const built = [f.first_name, f.last_name]
        .filter((v) => typeof v === 'string')
        .join(' ')
        .trim();
      const fallback = built || (typeof f.email === 'string' ? f.email.split('@')[0] : '');
      if (fallback) prep.create.display_name = fallback;
    }
    for (const [kind, column] of [
      ['department', 'department_id'],
      ['location', 'location_id'],
    ] as const) {
      const text = rec.r[kind];
      if (!text) continue;
      const res = await resolver.resolve(kind, text);
      if (res.kind === 'found') {
        prep.create[column] = res.id;
        prep.update[column] = res.id;
      } else if (res.kind === 'create') {
        prep.pending = true;
        prep.warnings.push({
          field: kind,
          code: 'will-create',
          message: `Will create ${kind} "${res.name}"`,
        });
      } else if (res.kind === 'error') prep.issues.push(res.issue);
    }
    if (env.options.blank_cells === 'clear') {
      for (const target of rec.b) {
        if ((CLEARABLE as readonly string[]).includes(target)) prep.update[target] = null;
        if (target === 'email') prep.update.email = null;
        if (target === 'department') prep.update.department_id = null;
        if (target === 'location') prep.update.location_id = null;
      }
    }
    if (prep.create.display_name === undefined) {
      prep.issues.push({
        field: 'display_name',
        code: 'required',
        message: 'The row has no name (and no first name, last name or email to build one from).',
      });
    }
    return prep;
  }

  protected async lookup(env: HandlerEnv, recs: MappedRecord[]) {
    const emails = new Set<string>();
    const refs = new Set<string>();
    for (const r of recs) {
      if (typeof r.f.email === 'string') emails.add(normKey(r.f.email));
      if (typeof r.f.employee_ref === 'string') refs.add(r.f.employee_ref);
    }
    const select = {
      id: true,
      display_name: true,
      email_key: true,
      employee_ref: true,
      version: true,
    } as const;
    const live = { archived_at: null };
    const [byEmail, byRef] = await Promise.all([
      emails.size
        ? env.tx.person.findMany({ where: { ...live, email_key: { in: [...emails] } }, select })
        : [],
      refs.size
        ? env.tx.person.findMany({ where: { ...live, employee_ref: { in: [...refs] } }, select })
        : [],
    ]);
    return (i: number): { hit: Existing | null; issue?: RowIssue } => {
      const r = recs[i]!;
      const e = typeof r.f.email === 'string' ? normKey(r.f.email) : '';
      const ref = typeof r.f.employee_ref === 'string' ? r.f.employee_ref : '';
      const a = e ? byEmail.find((p) => p.email_key === e) : undefined;
      const b = ref ? byRef.find((p) => p.employee_ref === ref) : undefined;
      if (a && b && a.id !== b.id) {
        return {
          hit: null,
          issue: {
            field: 'employee_ref',
            code: 'conflict',
            message: `The email belongs to ${a.display_name} but the employee number to ${b.display_name}.`,
          },
        };
      }
      const hit = a ?? b;
      return { hit: hit ? { id: hit.id, version: hit.version, label: hit.display_name } : null };
    };
  }

  protected async doCreate(
    env: HandlerEnv,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.people.create(env.auth, body as never, meta);
    return res.data.id as string;
  }

  protected async doUpdate(
    env: HandlerEnv,
    id: string,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<number> {
    const res = await this.people.update(env.auth, id, { kind: 'any' }, body as never, meta);
    return res.version;
  }

  protected async currentOf(env: HandlerEnv, id: string) {
    const row = await env.tx.person.findUnique({ where: { id } });
    return row && !row.archived_at
      ? { version: row.version, row: row as unknown as Record<string, unknown> }
      : null;
  }
}
