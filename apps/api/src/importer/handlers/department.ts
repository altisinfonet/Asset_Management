import {
  departmentCreateSchema,
  departmentUpdateSchema,
  type DepartmentsService,
} from '../../departments/index.js';
import type { RefResolver } from '../refs.js';
import type { MappedRecord, RowIssue } from '../types.js';
import { normKey } from '../values.js';
import { type Existing, type Prep, ServiceHandler } from './service-handler.js';
import { type HandlerEnv, plainPointer } from './shared.js';

/** Department imports (M2-IMP-07): matched by name (ignoring case and padding), else by code. */
export class DepartmentHandler extends ServiceHandler {
  protected readonly label = 'department';
  protected readonly pointer = plainPointer({ manager_person_id: 'manager' });
  protected readonly createSchema = departmentCreateSchema;
  protected readonly updateSchema = departmentUpdateSchema;
  protected readonly identity = ['name'] as const;

  constructor(private readonly departments: DepartmentsService) {
    super();
  }

  keys(rec: MappedRecord): { k1: string | null; k2: string | null } {
    const name = typeof rec.f.name === 'string' ? normKey(rec.f.name) : '';
    const code = typeof rec.f.code === 'string' ? normKey(rec.f.code) : '';
    return { k1: name ? `name:${name}` : null, k2: code ? `code:${code}` : null };
  }

  protected async prepare(
    env: HandlerEnv,
    resolver: RefResolver,
    rec: MappedRecord,
  ): Promise<Prep> {
    const prep: Prep = { issues: [], warnings: [], create: {}, update: {}, pending: false };
    if (typeof rec.f.name === 'string') prep.create.name = rec.f.name;
    for (const key of ['code', 'description'] as const) {
      if (rec.f[key] !== undefined) {
        prep.create[key] = rec.f[key];
        prep.update[key] = rec.f[key];
      }
    }
    if (rec.r.manager) {
      const res = await resolver.resolve('person', rec.r.manager);
      if (res.kind === 'found') {
        prep.create.manager_person_id = res.id;
        prep.update.manager_person_id = res.id;
        const made = resolver.createdName(res.id);
        if (made !== undefined) {
          prep.warnings.push({
            field: 'manager',
            code: 'will-create',
            message: `Will create person "${made}"`,
          });
        }
      } else if (res.kind === 'create') {
        prep.pending = true;
        prep.warnings.push({
          field: 'manager',
          code: 'will-create',
          message: `Will create person "${res.name}"`,
        });
      } else if (res.kind === 'error') prep.issues.push({ ...res.issue, field: 'manager' });
    }
    if (env.options.blank_cells === 'clear') {
      for (const target of rec.b) {
        if (target === 'code' || target === 'description') prep.update[target] = null;
        if (target === 'manager') prep.update.manager_person_id = null;
      }
    }
    if (prep.create.name === undefined)
      prep.issues.push({ field: 'name', code: 'required', message: 'The row has no name.' });
    return prep;
  }

  protected async lookup(env: HandlerEnv, recs: MappedRecord[]) {
    const names = new Set<string>();
    const codes = new Set<string>();
    for (const r of recs) {
      if (typeof r.f.name === 'string') names.add(normKey(r.f.name));
      if (typeof r.f.code === 'string') codes.add(normKey(r.f.code));
    }
    const select = { id: true, name: true, name_key: true, code_key: true, version: true } as const;
    const live = { archived_at: null };
    const [byName, byCode] = await Promise.all([
      names.size
        ? env.tx.department.findMany({ where: { ...live, name_key: { in: [...names] } }, select })
        : [],
      codes.size
        ? env.tx.department.findMany({ where: { ...live, code_key: { in: [...codes] } }, select })
        : [],
    ]);
    return (i: number): { hit: Existing | null; issue?: RowIssue } => {
      const r = recs[i]!;
      const n = typeof r.f.name === 'string' ? normKey(r.f.name) : '';
      const c = typeof r.f.code === 'string' ? normKey(r.f.code) : '';
      const a = n ? byName.find((d) => d.name_key === n) : undefined;
      const b = c ? byCode.find((d) => d.code_key === c) : undefined;
      if (!a && b) {
        return {
          hit: null,
          issue: {
            field: 'code',
            code: 'conflict',
            message: `The code "${String(r.f.code)}" is used by the department "${b.name}".`,
          },
        };
      }
      if (a && b && a.id !== b.id) {
        return {
          hit: null,
          issue: {
            field: 'code',
            code: 'conflict',
            message: `The code "${String(r.f.code)}" is used by the department "${b.name}".`,
          },
        };
      }
      return { hit: a ? { id: a.id, version: a.version, label: a.name } : null };
    };
  }

  protected async doCreate(
    env: HandlerEnv,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.departments.create(env.auth, body as never, meta);
    return res.data.id as string;
  }

  protected async doUpdate(
    env: HandlerEnv,
    id: string,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<number> {
    const res = await this.departments.update(env.auth, id, { kind: 'any' }, body as never, meta);
    return res.version;
  }

  protected async currentOf(env: HandlerEnv, id: string) {
    const row = await env.tx.department.findUnique({ where: { id } });
    return row && !row.archived_at
      ? { version: row.version, row: row as unknown as Record<string, unknown> }
      : null;
  }
}
