import { http, type HttpHandler } from 'msw';
import { etagOf, problem, requireSession } from './http';
import { notFound, onePerson, openAssignmentsOf } from './m2-handlers';
import { newResourceId } from './registry-fixtures';
import { mutateRegistry, registry } from './registry-state';
import { nowIso, readBody, validation } from './registry-handlers';

/**
 * Mock handlers of linking a person and a login account (M2-USR-03, ED-22), mirroring
 * apps/api/src/people/people.service.ts: Administrators only, one login per person and one person per
 * login, linking REPLACES the system-made placeholder person of the login (archived, never deleted),
 * unlinking gives the login a new placeholder.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `If-Match` is optional here: only a header that was sent must match. */
function staleOptional(request: Request, version: number): Response | null {
  const header = request.headers.get('if-match');
  if (header && header !== '*' && header !== etagOf(version)) {
    return problem(412, 'precondition-failed', 'The resource changed since you loaded it');
  }
  return null;
}

export const linkHandlers: HttpHandler[] = [
  http.post('/v1/people/:id/link-user', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const person = registry().people.find((p) => p.id === params.id);
    if (!person || person.archived_at) return notFound('Person');
    const stale = staleOptional(request, person._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return problem(400, 'bad-request', 'Malformed JSON body');
    const userId = body.user_id;
    if (typeof userId !== 'string' || !UUID.test(userId) || Object.keys(body).length !== 1) {
      return validation([{ pointer: '/user_id', message: 'must be a uuid', code: 'invalid' }]);
    }
    const data = registry();
    const user = data.users.find((u) => u.id === userId);
    if (!user) {
      return validation([
        { pointer: '/user_id', message: 'No such login account.', code: 'not-found' },
      ]);
    }
    if (user.archived_at) {
      return validation([
        { pointer: '/user_id', message: 'the login account is archived', code: 'archived' },
      ]);
    }
    if (person.user_id === user.id) return onePerson(person);
    if (person.user_id) {
      return problem(409, 'person-already-linked', 'Person already has a login account', {
        detail: `${person.display_name} is already linked to another login account. Unlink it first.`,
        errors: [{ pointer: '/user_id', message: 'the person has a login', code: 'taken' }],
      });
    }
    const placeholder = data.people.find((p) => p.user_id === user.id);
    if (placeholder && !placeholder._system) {
      return problem(409, 'login-already-linked', 'Login account already has a person', {
        detail: `The login account is already linked to ${placeholder.display_name}. Unlink that person first.`,
        errors: [{ pointer: '/user_id', message: 'the login has a person', code: 'taken' }],
      });
    }
    if (placeholder) {
      const open = openAssignmentsOf(placeholder.id);
      if (open > 0) {
        return problem(409, 'login-person-in-use', "The login's own person still holds assets", {
          detail: `The login's own person record (${placeholder.display_name}) still holds ${open} asset${open === 1 ? '' : 's'}. Check them in or transfer them first.`,
          usage: { open_assignments: open },
        });
      }
    }
    const updated = mutateRegistry((d) => {
      if (placeholder) {
        const old = d.people.find((p) => p.id === placeholder.id)!;
        old.user_id = null;
        old.archived_at = nowIso();
        old._v += 1;
        for (const dept of d.departments) {
          if (dept.manager_person_id === old.id) dept.manager_person_id = person.id;
        }
      }
      const target = d.people.find((p) => p.id === person.id)!;
      target.user_id = user.id;
      target.updated_at = nowIso();
      target._v += 1;
      return target;
    });
    return onePerson(updated);
  }),

  http.delete('/v1/people/:id/link-user', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'user:manage' });
    if (!guard.ok) return guard.response;
    const person = registry().people.find((p) => p.id === params.id);
    if (!person || person.archived_at) return notFound('Person');
    const stale = staleOptional(request, person._v);
    if (stale) return stale;
    if (!person.user_id) {
      return problem(409, 'conflict', 'Conflict', {
        detail: 'This person has no login account to unlink.',
      });
    }
    if (person._system) {
      const login = registry().users.find((u) => u.id === person.user_id);
      return problem(409, 'conflict', 'Conflict', {
        detail: `This is the automatic record of ${login ? `the login ${login.email}` : 'its login'}; there is nothing to unlink. To attach the login to a real person, open that person and use Link to a login.`,
      });
    }
    const userId = person.user_id;
    const updated = mutateRegistry((d) => {
      const target = d.people.find((p) => p.id === person.id)!;
      target.user_id = null;
      target.updated_at = nowIso();
      target._v += 1;
      const user = d.users.find((u) => u.id === userId);
      if (user && !user.archived_at) {
        const emailTaken = d.people.some(
          (p) => !p.archived_at && p.email?.toLowerCase() === user.email.toLowerCase(),
        );
        d.people.push({
          id: newResourceId('person'),
          created_at: nowIso(),
          updated_at: nowIso(),
          archived_at: null,
          kind: 'employee',
          display_name: user.display_name,
          first_name: null,
          last_name: null,
          email: emailTaken ? null : user.email,
          phone: null,
          employee_ref: null,
          department: null,
          department_id: null,
          job_title: null,
          location_id: null,
          company_id: target.company_id,
          status: 'active',
          notes: null,
          user_id: user.id,
          _system: true,
          _v: 1,
        });
      }
      return target;
    });
    return onePerson(updated);
  }),
];
