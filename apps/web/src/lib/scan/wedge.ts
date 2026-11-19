/**
 * Detector for a keyboard-wedge scanner (USB or Bluetooth scanners that "type" the code and finish
 * with Enter). A scan is a burst: printable keys arriving a few milliseconds apart, then Enter. A
 * person typing is much slower, so the gap between keys tells them apart; a burst that is too short
 * is treated as typing and ignored. Pure (no DOM), so it is unit tested with simulated key times.
 */
export interface WedgeOptions {
  /** Largest gap (ms) between two keys of one burst. Scanners type at <= 30 ms; people at >= 80 ms. */
  maxGapMs?: number;
  /** Shortest code that counts as a scan. */
  minLength?: number;
  /** Longest code accepted (a runaway buffer is dropped). */
  maxLength?: number;
}

export type WedgeResult =
  /** Not part of a scan (or a burst that cannot be one): do nothing. */
  | { type: 'ignore' }
  /** A key of a burst in progress (the second one onwards): swallow it so no shortcut fires. */
  | { type: 'capture' }
  /** Enter ended a burst: this is the scanned code. */
  | { type: 'scan'; code: string };

export class WedgeDetector {
  private buffer = '';
  private lastAt = 0;
  private readonly maxGap: number;
  private readonly min: number;
  private readonly max: number;

  constructor(options: WedgeOptions = {}) {
    this.maxGap = options.maxGapMs ?? 50;
    this.min = options.minLength ?? 3;
    this.max = options.maxLength ?? 200;
  }

  /** Characters collected so far in the current burst. */
  get pending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = '';
    this.lastAt = 0;
  }

  /** Feed one `keydown` (`key` as in `KeyboardEvent.key`, `at` its timestamp in ms). */
  feed(key: string, at: number): WedgeResult {
    if (key === 'Enter') {
      const code = this.buffer;
      const isBurst = code.length >= this.min && at - this.lastAt <= this.maxGap * 4;
      this.reset();
      return isBurst ? { type: 'scan', code } : { type: 'ignore' };
    }
    if (key.length !== 1) {
      // Tab, Escape, arrows, Shift ... end whatever was being typed (Shift alone must not).
      if (key !== 'Shift' && key !== 'CapsLock') this.reset();
      return { type: 'ignore' };
    }
    const inBurst = this.buffer.length > 0 && at - this.lastAt <= this.maxGap;
    this.buffer = inBurst ? this.buffer + key : key;
    this.lastAt = at;
    if (this.buffer.length > this.max) {
      this.reset();
      return { type: 'ignore' };
    }
    // The first key of a burst cannot be told from typing yet; from the second on it is a scan.
    return this.buffer.length >= 2 ? { type: 'capture' } : { type: 'ignore' };
  }
}
