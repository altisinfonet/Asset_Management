import type { Logger } from 'pino';

/**
 * Stub for the `worker` and `scheduler` roles (M1): logs, idles with a heartbeat, and exits
 * cleanly on SIGINT/SIGTERM. Queue handlers (pg-boss) and cron producers arrive later.
 */
export async function runIdleRole(role: 'worker' | 'scheduler', logger: Logger): Promise<void> {
  logger.info(`${role} role started (stub: no handlers registered yet)`);
  const heartbeat = setInterval(() => logger.debug('heartbeat'), 60_000);
  await new Promise<void>((resolve) => {
    const stop = (signal: string) => {
      logger.info({ signal }, `${role} role stopping`);
      clearInterval(heartbeat);
      resolve();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}
