import 'reflect-metadata';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { mode } from '../support/db.js';
import { LoanAlerts } from '../../src/loaners/index.js';
import {
  NOTIFICATION_SUBSCRIPTIONS,
  NotificationSubscribers,
} from '../../src/notifications/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import {
  type App,
  type Basics,
  type Json,
  type TenantFixture,
  basics,
  contractViolations,
  createTenant,
  createUser,
  ifMatch,
  inDays,
  keyed,
  newAsset,
  newPerson,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
  testPorts,
  unique,
} from '../lifecycle/support.js';

/**
 * Founder decisions of 2026-11-24 on loaner pools (ED-24): the due date precedence (request > pool >
 * organisation > 7 days, cut to the pool maximum), the borrower mail rule for people without a login,
 * and "next available" = the member idle the longest.
 */
describe.skipIf(!dbEnabled)(`loaner defaults, mail and next available (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let t: TenantFixture;
  let b: Basics;
  let runtime: TenancyService;
  const a = () => t.admin;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    t = await createTenant(app, tenancy, 'loandef');
    b = await basics(t);
    runtime = app.get(TenancyService, { strict: false });
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
    expect(contractViolations()).toEqual([]);
  });

  const newPool = async (extra: Record<string, unknown> = {}) => {
    const res = await a().post('/v1/loaner-pools', { name: unique('Cart'), ...extra });
    if (res.status !== 201) throw new Error(`create pool: ${res.status} ${res.raw}`);
    return res.body as Json;
  };
  const addDevice = async (poolId: string) => {
    const asset = await newAsset(a(), b.categoryId, { serial: unique('SN') });
    const res = await a().post(`/v1/loaner-pools/${poolId}/members`, { asset_id: asset.id });
    if (res.status !== 201) throw new Error(`add member: ${res.status} ${res.raw}`);
    return { id: asset.id as string, tag: asset.body.asset_tag as string };
  };
  const person = (extra: Record<string, unknown> = {}) =>
    newPerson(a(), { email: `${unique('p')}@school.example`.toLowerCase(), ...extra });
  const lend = (poolId: string, body: Record<string, unknown>) =>
    a().post(`/v1/loaner-pools/${poolId}/checkout`, body, keyed());
  const setTenantDays = async (days: number | null) => {
    const got = await a().get('/v1/settings/custody');
    const res = await a().put(
      '/v1/settings/custody',
      { default_expected_return_days: days, loan_reminder_days: got.body.loan_reminder_days },
      ifMatch(got.headers.etag),
    );
    expect(res.status).toBe(200);
  };

  describe('the due date of a loan (ED-24)', () => {
    it('is the request, else the pool, else the organisation, else 7 days; derived dates are cut to the pool maximum', async () => {
      await setTenantDays(null);
      const who = await person();

      // no pool default, no organisation default: 7 days
      const bare = await newPool();
      await addDevice(bare.id);
      await addDevice(bare.id);
      await addDevice(bare.id);
      await addDevice(bare.id);
      expect(bare).toMatchObject({ default_loan_days: null, effective_default_loan_days: 7 });
      expect((await lend(bare.id, { person_id: who.id })).body.assignment.expected_return).toBe(
        inDays(7),
      );

      // the organisation's number applies to a pool without its own default
      await setTenantDays(10);
      expect((await a().get(`/v1/loaner-pools/${bare.id}`)).body).toMatchObject({
        default_loan_days: null,
        effective_default_loan_days: 10,
      });
      expect((await lend(bare.id, { person_id: who.id })).body.assignment.expected_return).toBe(
        inDays(10),
      );
      // the list shows the effective number too
      const listed = (await a().get('/v1/loaner-pools?limit=100')).body.data.find(
        (p: Json) => p.id === bare.id,
      );
      expect(listed.effective_default_loan_days).toBe(10);

      // an explicit date beats both
      expect(
        (await lend(bare.id, { person_id: who.id, expected_return: inDays(2) })).body.assignment
          .expected_return,
      ).toBe(inDays(2));

      // the pool's own default beats the organisation's
      const own = await newPool({ default_loan_days: 4 });
      await addDevice(own.id);
      expect(own).toMatchObject({ default_loan_days: 4, effective_default_loan_days: 4 });
      expect((await lend(own.id, { person_id: who.id })).body.assignment.expected_return).toBe(
        inDays(4),
      );

      // a derived date is cut to the pool maximum; an explicit one beyond it is refused
      const capped = await newPool({ max_loan_days: 6 });
      await addDevice(capped.id);
      await addDevice(capped.id);
      expect(capped.effective_default_loan_days).toBe(6);
      expect((await lend(capped.id, { person_id: who.id })).body.assignment.expected_return).toBe(
        inDays(6),
      );
      const tooLong = await lend(capped.id, { person_id: who.id, expected_return: inDays(7) });
      expect(tooLong.status).toBe(422);
      expect(tooLong.body.errors[0]).toMatchObject({ code: 'exceeds-max-loan' });

      // the quick flow follows the same chain
      const quickPool = await newPool();
      const dev = await addDevice(quickPool.id);
      const quick = await a().post(
        `/v1/loaner-pools/${quickPool.id}/quick-checkout`,
        { person_id: who.id, codes: [dev.tag] },
        keyed(),
      );
      expect(quick.status).toBe(200);
      expect(quick.body.results[0].status).toBe(201);
      const loans = (await a().get(`/v1/loans?loaner_pool_id=${quickPool.id}`)).body.data;
      expect(loans[0].expected_return).toBe(inDays(10));

      await setTenantDays(null);
    });

    it('can be cleared on a pool (null), is validated against the maximum only when set, and starts empty', async () => {
      await setTenantDays(null);
      const pool = await newPool({ default_loan_days: 5, max_loan_days: 8 });
      const etag = String((await a().get(`/v1/loaner-pools/${pool.id}`)).headers.etag);
      const cleared = await a().patch(
        `/v1/loaner-pools/${pool.id}`,
        { default_loan_days: null },
        ifMatch(etag),
      );
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({
        default_loan_days: null,
        effective_default_loan_days: 7,
      });
      const bad = await a().patch(
        `/v1/loaner-pools/${pool.id}`,
        { default_loan_days: 9 },
        ifMatch(cleared.headers.etag),
      );
      expect(bad.status).toBe(422);
      expect(bad.body.errors[0]).toMatchObject({ pointer: '/max_loan_days' });
      // a maximum below the (derived) default is fine: the derived date is cut, nothing to compare
      const lowMax = await newPool({ max_loan_days: 2 });
      expect(lowMax).toMatchObject({ default_loan_days: null, effective_default_loan_days: 2 });
    });
  });

  describe('next available device (ED-24)', () => {
    /** Sets the return time of the last custody period of a device (SQL: the API stamps "now"). */
    const returnedAt = (assetId: string, day: string) =>
      ownerTenantSql(
        t.tenantId,
        `update app.assignment set checked_out_at = '${day}T08:00:00Z'::timestamptz,
                                   checked_in_at = '${day}T09:00:00Z'::timestamptz
          where asset_id = '${assetId}' and checked_in_at is not null`,
      );

    it('lends the member that has been idle the longest; never-lent devices come first; ties go to the lowest tag', async () => {
      const pool = await newPool();
      const d1 = await addDevice(pool.id);
      const d2 = await addDevice(pool.id);
      const d3 = await addDevice(pool.id);
      const who = await person();
      const next = async () => {
        const res = await lend(pool.id, { person_id: who.id });
        expect(res.status).toBe(201);
        return res.body.asset.id as string;
      };
      const giveBack = async (d: { tag: string }) => {
        const res = await a().post('/v1/loans/return', { codes: [d.tag] }, keyed());
        expect(res.status).toBe(200);
        expect(res.body.results[0].status).toBe(200);
      };

      // lend d1 and d3 by hand and return them: d2 was never lent
      for (const d of [d1, d3]) {
        expect((await lend(pool.id, { person_id: who.id, asset_id: d.id })).status).toBe(201);
        await giveBack(d);
      }
      await returnedAt(d1.id, '2026-01-10');
      await returnedAt(d3.id, '2026-01-05');
      // d2 never lent: first
      expect(await next()).toBe(d2.id);
      // d3 returned earliest of the two: it has been idle longer than d1
      expect(await next()).toBe(d3.id);
      expect(await next()).toBe(d1.id);
      expect((await lend(pool.id, { person_id: who.id })).body.code).toBe('no-loaner-available');

      // everything back, d1 now idle the longest
      for (const d of [d1, d2, d3]) await giveBack(d);
      await returnedAt(d1.id, '2026-02-01');
      await returnedAt(d2.id, '2026-02-02');
      await returnedAt(d3.id, '2026-02-03');
      expect(await next()).toBe(d1.id);
      expect(await next()).toBe(d2.id);
      expect(await next()).toBe(d3.id);

      // equal return times: the lowest asset tag
      for (const d of [d1, d2, d3]) await giveBack(d);
      for (const d of [d1, d2, d3]) await returnedAt(d.id, '2026-03-01');
      const lowest = [d1, d2, d3].sort((m, n) => (m.tag < n.tag ? -1 : 1))[0]!;
      expect(await next()).toBe(lowest.id);
    });
  });

  describe('mail to borrowers without a login (ED-24)', () => {
    // a tenant of its own: the daily job looks at every open loan of the tenant
    const saved: { t?: TenantFixture; b?: Basics } = {};
    beforeAll(async () => {
      saved.t = t;
      saved.b = b;
      t = await createTenant(app, tenancy, 'loanmail');
      b = await basics(t);
    });
    afterAll(() => {
      t = saved.t!;
      b = saved.b!;
    });

    /**
     * Hands the loan events of the tenant to their notification subscriptions in THIS process, so the
     * mail lands in this file's capture. (The OutboxRelay of another test file may claim the events of
     * any active tenant, and its mail would go to that file's own fakes.) Each event is handled once.
     */
    const handled = new Set<string>();
    const relay = async () => {
      const rows = (
        await ownerTenantSql(
          t.tenantId,
          "select id, event_type, aggregate_type, aggregate_id, payload, created_at from app.outbox_event where event_type like 'loan.%' order by id",
        )
      ).rows as Array<{
        id: string;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
        created_at: Date;
      }>;
      const subscribers = app.get(NotificationSubscribers, { strict: false });
      for (const row of rows) {
        if (handled.has(row.id)) continue;
        handled.add(row.id);
        const sub = NOTIFICATION_SUBSCRIPTIONS.find((s) => s.event === row.event_type);
        if (!sub) continue;
        await runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
          subscribers.handle(
            sub,
            {
              id: row.id,
              tenantId: t.tenantId,
              type: row.event_type,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              payload: row.payload,
              version: 1,
              createdAt: row.created_at,
              attempts: 0,
            },
            tx,
          ),
        );
      }
    };
    const runJob = (today: string) =>
      runtime.withTenantTx({ tenantId: t.tenantId }, (tx) =>
        app.get(LoanAlerts, { strict: false }).run(
          { tenantId: t.tenantId },
          {
            tenantId: t.tenantId,
            tx,
            jobId: 'test',
            queue: 'loan.alerts',
            retryCount: 0,
            logger: pino({ level: 'silent' }),
          },
          today,
        ),
      );
    const mailsTo = (to: string) =>
      testPorts.mail.sent.filter((m) => m.to === to && m.template === 'notification.message');
    const setDue = (assignmentId: string, due: string) =>
      ownerTenantSql(
        t.tenantId,
        `update app.assignment set expected_return = '${due}'::date where id = '${assignmentId}'`,
      );

    /** One loan of a new device of `pool` to `who`, with the given due date. */
    const loanTo = async (poolId: string, whoId: string, due: string) => {
      const dev = await addDevice(poolId);
      const res = await lend(poolId, { person_id: whoId, asset_id: dev.id });
      expect(res.status).toBe(201);
      await setDue(res.body.assignment.id, due);
      return { dev, assignmentId: res.body.assignment.id as string };
    };

    it('overdue: employees and contractors by default, students not; the pool can force it on or off; no address, no mail', async () => {
      const auto = await newPool();
      const forced = await newPool({ email_borrowers_without_login: true });
      const never = await newPool({ email_borrowers_without_login: false });
      expect(auto.email_borrowers_without_login).toBeNull();
      expect(forced.email_borrowers_without_login).toBe(true);
      expect(never.email_borrowers_without_login).toBe(false);

      const employee = await person({ kind: 'employee' });
      const contractor = await person({ kind: 'contractor' });
      const student = await person({ kind: 'student' });
      const noAddress = await newPerson(a(), { kind: 'employee' });
      const pupil = await person({ kind: 'student' });
      const staff = await person({ kind: 'employee' });
      const emailOf = async (p: { id: string }) =>
        String((await a().get(`/v1/people/${p.id}`)).body.email);

      const due = inDays(-2);
      await loanTo(auto.id, employee.id, due);
      await loanTo(auto.id, contractor.id, due);
      await loanTo(auto.id, student.id, due);
      await loanTo(auto.id, noAddress.id, due);
      await loanTo(forced.id, pupil.id, due);
      await loanTo(never.id, staff.id, due);

      expect(await runJob(inDays(0))).toMatchObject({ overdue: 6 });
      await relay();
      await relay(); // the same events again: nothing more is sent
      const mail = async (p: { id: string }) => mailsTo(await emailOf(p));

      expect(await mail(employee)).toHaveLength(1);
      expect(String((await mail(employee))[0]!.data.title)).toMatch(/^Overdue: /);
      expect(await mail(contractor)).toHaveLength(1);
      expect(await mail(student)).toHaveLength(0);
      expect(await mail(pupil)).toHaveLength(1);
      expect(await mail(staff)).toHaveLength(0);
      // nobody without a login gets an in-app row (there is no account to hold it)
      const rows = await ownerTenantSql(
        t.tenantId,
        `select count(*)::int as n from app.notification where type = 'loan.overdue'`,
      );
      // the managers (the admin) are told about every loan, once each
      expect(rows.rows[0]).toEqual({ n: 6 });
      expect(
        mailsTo(t.adminEmail).filter((m) => String(m.data.title).startsWith('Overdue: ')),
      ).toHaveLength(6);

      // the next day: one more mail for the same loan (once per loan and day)
      await runJob(inDays(1));
      await relay();
      expect(await mail(employee)).toHaveLength(2);
    });

    it('due soon: the same rule; a borrower with a login gets the in-app notification and is not mailed twice', async () => {
      const auto = await newPool();
      const never = await newPool({ email_borrowers_without_login: false });
      const employee = await person({ kind: 'employee' });
      const staff = await person({ kind: 'employee' });
      const student = await person({ kind: 'student' });
      const login = await createUser(app, t, 'viewer');
      const people = await a().get(`/v1/people?q=${encodeURIComponent(login.email)}`);
      const loginPerson = { id: people.body.data[0].id as string };

      const soon = inDays(1);
      await loanTo(auto.id, employee.id, soon);
      await loanTo(auto.id, student.id, soon);
      await loanTo(never.id, staff.id, soon);
      await loanTo(auto.id, loginPerson.id, soon);

      expect(await runJob(inDays(0))).toMatchObject({ dueSoon: 4, overdue: 0 });
      await relay();
      await relay();
      const emailOf = async (p: { id: string }) =>
        String((await a().get(`/v1/people/${p.id}`)).body.email);
      const dueMails = (to: string) =>
        mailsTo(to).filter((m) => String(m.data.title).startsWith('Due back soon'));
      expect(dueMails(await emailOf(employee))).toHaveLength(1);
      expect(dueMails(await emailOf(student))).toHaveLength(0);
      expect(dueMails(await emailOf(staff))).toHaveLength(0);
      // the borrower with a login: one in-app notification, and e-mail only through the user path
      const inApp = await ownerTenantSql(
        t.tenantId,
        `select count(*)::int as n from app.notification where type = 'loan.due_soon' and user_id = '${login.id}'`,
      );
      expect(inApp.rows[0]).toEqual({ n: 1 });
      expect(dueMails(login.email)).toHaveLength(1);
    });

    it('is not sent when an administrator switched the notification type off', async () => {
      const pool = await newPool();
      const employee = await person({ kind: 'employee' });
      const rules = await a().get('/v1/notification-rules');
      expect(rules.status).toBe(200);
      const put = await a().put('/v1/notification-rules/loan.overdue', { enabled: false });
      expect(put.status).toBe(200);
      try {
        await loanTo(pool.id, employee.id, inDays(-1));
        await runJob(inDays(0));
        await relay();
        const email = String((await a().get(`/v1/people/${employee.id}`)).body.email);
        expect(mailsTo(email)).toHaveLength(0);
      } finally {
        await a().put('/v1/notification-rules/loan.overdue', { enabled: true });
      }
    });
  });
});
