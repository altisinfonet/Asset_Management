import type { Logger } from 'pino';

/**
 * Resolves on the first SIGINT/SIGTERM (a second one exits immediately). Process roles `await` this
 * after starting, then stop their components in reverse order: the orchestrator's `docker stop`
 * sends SIGTERM and waits `stop_grace_period` before SIGKILL, so graceful shutdown must be quick.
 */
export function waitForShutdownSignal(logger: Logger, role: string): Promise<string> {
  return new Promise((resolve) => {
    let received = false;
    const handler = (signal: NodeJS.Signals) => {
      if (received) {
        logger.warn({ signal }, `${role} forced exit on second signal`);
        process.exit(1);
      }
      received = true;
      logger.info({ signal }, `${role} role stopping`);
      resolve(signal);
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
  });
}

/** Tracks "the process is alive and doing its loop" for `/healthz` of worker and scheduler. */
export class Heartbeat {
  private lastBeat = Date.now();
  private timer?: NodeJS.Timeout;

  /** `beat` runs every `intervalMs`; the heartbeat only advances when it succeeds. */
  start(intervalMs: number, beat: () => Promise<void>, onError: (err: unknown) => void): void {
    const tick = () => {
      beat().then(
        () => {
          this.lastBeat = Date.now();
        },
        (err: unknown) => onError(err),
      );
    };
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  /** True while the last successful beat is younger than `maxAgeMs`. */
  isFresh(maxAgeMs: number): boolean {
    return Date.now() - this.lastBeat < maxAgeMs;
  }

  get lastBeatAt(): Date {
    return new Date(this.lastBeat);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
