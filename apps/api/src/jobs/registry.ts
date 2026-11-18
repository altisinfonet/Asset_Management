import { Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import type { Tx } from '../tenancy/index.js';
import { type JobRunner, queueDefinition } from './catalogue.js';

/** Common to every handler invocation. */
export interface JobContextBase {
  jobId: string;
  queue: string;
  /** 0 on the first attempt. */
  retryCount: number;
  logger: Logger;
}

/**
 * Context of a TENANT-SCOPED job: the handler runs INSIDE `withTenantTx(payload.tenantId)`; `tx` is
 * that transaction (RLS context set, actor = the job id, request id = `job:<id>`). Everything the
 * handler writes, including audit rows, outbox events and follow-up jobs, commits with the handler's
 * completion or rolls back with its failure.
 */
export interface TenantJobContext extends JobContextBase {
  tenantId: string;
  tx: Tx;
}

/** Context of a system job (no tenant): no transaction is open; the handler must not touch tenant data. */
export type SystemJobContext = JobContextBase;

export type TenantJobHandler<P = Record<string, unknown>> = (
  payload: P & { tenantId: string },
  ctx: TenantJobContext,
) => Promise<void>;
export type SystemJobHandler<P = Record<string, unknown>> = (
  payload: P,
  ctx: SystemJobContext,
) => Promise<void>;

export interface RegisteredHandler {
  queue: string;
  tenantScoped: boolean;
  runsIn: JobRunner;
  handle: TenantJobHandler<never> | SystemJobHandler<never>;
}

export class HandlerRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandlerRegistrationError';
  }
}

/**
 * Where modules attach their job handlers (usually in `onModuleInit`). The worker and scheduler
 * roles subscribe to whatever is registered here for their runner. Registering is only possible for
 * a queue in the catalogue, and the registration form must match the catalogue entry, so a tenant
 * queue can only ever be handled by a handler that runs inside a tenant transaction.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, RegisteredHandler>();

  registerTenant<P = Record<string, unknown>>(queue: string, handle: TenantJobHandler<P>): void {
    const def = this.definition(queue);
    if (!def.tenantScoped) {
      throw new HandlerRegistrationError(`queue ${queue} is not tenant scoped: use registerSystem`);
    }
    this.add({
      queue,
      tenantScoped: true,
      runsIn: def.runsIn,
      handle: handle as TenantJobHandler<never>,
    });
  }

  registerSystem<P = Record<string, unknown>>(queue: string, handle: SystemJobHandler<P>): void {
    const def = this.definition(queue);
    if (def.tenantScoped) {
      throw new HandlerRegistrationError(
        `queue ${queue} is tenant scoped: use registerTenant (the handler must run in a tenant transaction)`,
      );
    }
    this.add({
      queue,
      tenantScoped: false,
      runsIn: def.runsIn,
      handle: handle as SystemJobHandler<never>,
    });
  }

  forRunner(runner: JobRunner): RegisteredHandler[] {
    return [...this.handlers.values()].filter((h) => h.runsIn === runner);
  }

  has(queue: string): boolean {
    return this.handlers.has(queue);
  }

  private definition(queue: string) {
    const def = queueDefinition(queue);
    if (!def)
      throw new HandlerRegistrationError(`unknown job queue "${queue}" (src/jobs/catalogue.ts)`);
    return def;
  }

  private add(handler: RegisteredHandler): void {
    if (this.handlers.has(handler.queue)) {
      throw new HandlerRegistrationError(`a handler for ${handler.queue} is already registered`);
    }
    this.handlers.set(handler.queue, handler);
  }
}
