import type { PgBoss } from 'pg-boss';
import { DEAD_LETTER_QUEUE } from './catalogue.js';

/** One dead-lettered job as the admin API shows it. Payloads are ids-only by construction. */
export interface DeadLetterEntry {
  id: string;
  /** The queue the job failed on. */
  sourceQueue: string | null;
  sourceJobId: string | null;
  tenantId: string | null;
  payload: unknown;
  /** The failure output recorded by pg-boss (error message of the last attempt). */
  failure: unknown;
  deadLetteredAt: string;
  retryCount: number;
}

/**
 * Read access to the dead-letter queue (M1-PLAT-06 "readable through an admin API"). Served by the
 * internal ops server (`GET /admin/jobs/dead-letter`): operators and the future admin UI proxy read
 * it; the public API port exposes nothing about queues. `redrive` moves entries back to their source
 * queue after the cause is fixed.
 */
export class JobAdmin {
  constructor(private readonly boss: () => Promise<PgBoss>) {}

  async deadLetters(limit = 100): Promise<DeadLetterEntry[]> {
    const boss = await this.boss();
    const jobs = await boss.findJobs<Record<string, unknown>>(DEAD_LETTER_QUEUE, {
      limit: Math.min(Math.max(1, limit), 1000),
    });
    // The dead-letter copy carries the payload; the failure text is on the ORIGINAL job's output.
    return Promise.all(
      jobs.map(async (job) => {
        let failure: unknown = job.output ?? null;
        if (failure === null && job.sourceName && job.sourceId) {
          const [source] = await boss.findJobs(job.sourceName, { id: job.sourceId, limit: 1 });
          failure = source?.output ?? null;
        }
        return {
          id: job.id,
          sourceQueue: job.sourceName ?? null,
          sourceJobId: job.sourceId ?? null,
          tenantId: typeof job.data?.tenantId === 'string' ? job.data.tenantId : null,
          payload: job.data,
          failure,
          deadLetteredAt: (job.createdOn instanceof Date
            ? job.createdOn
            : new Date(job.createdOn)
          ).toISOString(),
          retryCount: job.retryCount,
        };
      }),
    );
  }

  /** Moves dead-lettered jobs back to their source queues. Returns how many were moved. */
  async redrive(options: { sourceName?: string; limit?: number } = {}): Promise<number> {
    const boss = await this.boss();
    return boss.redrive(DEAD_LETTER_QUEUE, options);
  }
}
