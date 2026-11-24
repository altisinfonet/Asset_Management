import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '../ids/uuidv7.js';
import { CustodySettingsService, todayUtc } from '../lifecycle/index.js';
import type { TenantJobContext } from '../jobs/index.js';
import { OUTBOX_PUBLISHER, type OutboxPublisher } from '../ports/index.js';
import type { Tx } from '../tenancy/index.js';
import { addDays } from './dto.js';

/** Queue name (src/jobs/catalogue.ts). */
export const LOAN_ALERTS_JOB = 'loan.alerts';

/** Loans handled per kind and run; a bigger backlog is drained over the following runs. */
const BATCH = 5000;

interface Candidate {
  assignment_id: string;
  asset_id: string;
  person_id: string | null;
  loaner_pool_id: string;
  expected_return: Date;
  days: number;
}

export interface LoanAlertsResult {
  /** The tenant day the run was for (`YYYY-MM-DD`). */
  today: string;
  overdue: number;
  dueSoon: number;
}

/**
 * `loan.alerts` { tenantId } (daily, per tenant, from the scheduler; M2-LOAN-03, ED-21): finds the
 * loans from loaner pools that are overdue or due soon and emits ONE outbox event per loan and state
 * (`loan.overdue`, `loan.due_soon`); the notification subscriptions turn them into in-app
 * notifications and mail for the borrower (when they have a login) and the pool's managers.
 *
 * "Once per state" is a database fact, not a timing hope: every alert is first written to
 * `app.loan_alert` under a unique index (overdue: loan + day; due soon: loan + due date), and only
 * the run that inserted the row emits the event. Running the job twice in a day, a retry after a
 * failure and two scheduler replicas therefore cannot notify twice; extending a loan changes its due
 * date and re-arms the "due soon" alert. The overdue alert repeats once per day while the loan is out
 * (the copy escalates with `days_overdue`), as M2-LOAN-03 asks.
 *
 * The tenant's day is the UTC date: there is no tenant time zone setting yet (ED-21). `today` is a
 * parameter so a test can advance the clock.
 */
@Injectable()
export class LoanAlerts {
  constructor(
    private readonly settings: CustodySettingsService,
    @Inject(OUTBOX_PUBLISHER) private readonly outbox: OutboxPublisher,
  ) {}

  async run(
    _payload: { tenantId: string },
    ctx: TenantJobContext,
    today: string = todayUtc(),
  ): Promise<LoanAlertsResult> {
    const { tx } = ctx;
    const { loan_reminder_days: lead } = await this.settings.read(tx);
    const overdue = await this.overdue(tx, today);
    const dueSoon = lead > 0 ? await this.dueSoon(tx, today, lead) : 0;
    ctx.logger.info({ today, overdue, dueSoon }, 'loan alerts raised');
    return { today, overdue, dueSoon };
  }

  private async overdue(tx: Tx, today: string): Promise<number> {
    const rows = await tx.$queryRaw<Candidate[]>`
      select s.id as assignment_id, s.asset_id, s.person_id, s.loaner_pool_id, s.expected_return,
             (${today}::date - s.expected_return) as days
        from app.assignment s
       where s.loaner_pool_id is not null and s.asset_id is not null and s.checked_in_at is null
         and s.expected_return < ${today}::date
         and not exists (select 1 from app.loan_alert l
                          where l.tenant_id = s.tenant_id and l.assignment_id = s.id
                            and l.kind = 'overdue' and l.alert_date = ${today}::date)
       order by s.expected_return, s.id
       limit ${BATCH}`;
    let raised = 0;
    for (const loan of rows) {
      if (!(await this.record(tx, loan, 'overdue', today))) continue;
      raised += 1;
      await this.outbox.publish(tx, {
        type: 'loan.overdue',
        aggregateType: 'loan',
        aggregateId: loan.assignment_id,
        payload: {
          assignmentId: loan.assignment_id,
          assetId: loan.asset_id,
          personId: loan.person_id,
          poolId: loan.loaner_pool_id,
          daysOverdue: Number(loan.days),
          alertDate: today,
        },
      });
    }
    return raised;
  }

  private async dueSoon(tx: Tx, today: string, lead: number): Promise<number> {
    const last = addDays(today, lead);
    const rows = await tx.$queryRaw<Candidate[]>`
      select s.id as assignment_id, s.asset_id, s.person_id, s.loaner_pool_id, s.expected_return,
             (s.expected_return - ${today}::date) as days
        from app.assignment s
       where s.loaner_pool_id is not null and s.asset_id is not null and s.checked_in_at is null
         and s.expected_return >= ${today}::date and s.expected_return <= ${last}::date
         and not exists (select 1 from app.loan_alert l
                          where l.tenant_id = s.tenant_id and l.assignment_id = s.id
                            and l.kind = 'due_soon' and l.expected_return = s.expected_return)
       order by s.expected_return, s.id
       limit ${BATCH}`;
    let raised = 0;
    for (const loan of rows) {
      if (!(await this.record(tx, loan, 'due_soon', today))) continue;
      raised += 1;
      await this.outbox.publish(tx, {
        type: 'loan.due_soon',
        aggregateType: 'loan',
        aggregateId: loan.assignment_id,
        payload: {
          assignmentId: loan.assignment_id,
          assetId: loan.asset_id,
          personId: loan.person_id,
          poolId: loan.loaner_pool_id,
          dueOn: loan.expected_return.toISOString().slice(0, 10),
          alertDate: today,
        },
      });
    }
    return raised;
  }

  /** Writes the ledger row; false when an earlier run (or replica) already raised this alert. */
  private async record(
    tx: Tx,
    loan: Candidate,
    kind: 'overdue' | 'due_soon',
    today: string,
  ): Promise<boolean> {
    const days = kind === 'overdue' ? Number(loan.days) : 0;
    const due = loan.expected_return.toISOString().slice(0, 10);
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      insert into app.loan_alert (id, tenant_id, assignment_id, kind, alert_date, expected_return, days_overdue)
      values (${uuidv7()}::uuid, nullif(current_setting('app.tenant_id', true), '')::uuid,
              ${loan.assignment_id}::uuid, ${kind}::text, ${today}::date,
              ${due}::date, ${days}::int)
      on conflict do nothing
      returning id`;
    return inserted.length > 0;
  }
}
