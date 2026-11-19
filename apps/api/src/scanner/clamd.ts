import { once } from 'node:events';
import net from 'node:net';
import type { Readable } from 'node:stream';
import type { ScanVerdict, VirusScanner } from '../ports/index.js';

/** The scanner could not produce a verdict (down, timeout, size limit, protocol error). Retryable; never "clean". */
export class ScannerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

export interface ClamdOptions {
  host: string;
  port: number;
  /** Inactivity timeout of the connection, and the connect timeout. */
  timeoutMs: number;
  /** Largest chunk sent in one INSTREAM frame. clamd's default `StreamMaxLength` is 25 MB overall. */
  chunkBytes?: number;
}

const FRAME_MAX = 64 * 1024;

/**
 * ClamAV over TCP (`clamd`), `zINSTREAM` (M2-FILE-02). The object is streamed, never buffered:
 *
 *   -> "zINSTREAM\0"  then repeatedly  <4-byte big-endian length><bytes>   then <0x00000000>
 *   <- "stream: OK\0"  |  "stream: <Signature> FOUND\0"  |  "<reason> ERROR\0"
 *
 * `OK` is clean, `FOUND` infected (the signature name is kept for the audit trail), anything else
 * (including "INSTREAM size limit exceeded", a connection error or a timeout) rejects with
 * {@link ScannerUnavailableError}, so a failed scan retries instead of being mistaken for clean.
 */
export class ClamdScanner implements VirusScanner {
  readonly enabled = true;

  constructor(private readonly options: ClamdOptions) {}

  async scan(body: Readable): Promise<ScanVerdict> {
    const socket = await this.connect();
    try {
      socket.write('zINSTREAM\0');
      const frame = Math.min(this.options.chunkBytes ?? FRAME_MAX, FRAME_MAX);
      // clamd may answer early (size limit exceeded) and close; the response is read concurrently.
      const answer = this.readAnswer(socket);
      answer.catch(() => undefined); // surfaced below; avoids an unhandled rejection while streaming
      try {
        for await (const chunk of body as AsyncIterable<Buffer | string>) {
          const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
          for (let offset = 0; offset < buf.length; offset += frame) {
            const piece = buf.subarray(offset, offset + frame);
            const header = Buffer.alloc(4);
            header.writeUInt32BE(piece.length, 0);
            if (socket.destroyed || !socket.writable) break;
            if (!socket.write(Buffer.concat([header, piece]))) {
              await Promise.race([once(socket, 'drain'), answer.then(() => undefined)]);
            }
          }
          if (socket.destroyed || !socket.writable) break;
        }
        if (socket.writable) socket.write(Buffer.alloc(4));
      } catch (err) {
        body.destroy();
        throw new ScannerUnavailableError(`reading the object failed: ${(err as Error).message}`);
      }
      return parseAnswer(await answer);
    } finally {
      socket.destroy();
    }
  }

  async ping(): Promise<boolean> {
    try {
      const socket = await this.connect();
      try {
        socket.write('zPING\0');
        return (await this.readAnswer(socket)).trim() === 'PONG';
      } finally {
        socket.destroy();
      }
    } catch {
      return false;
    }
  }

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.options.host, port: this.options.port });
      socket.setTimeout(this.options.timeoutMs);
      socket.once('connect', () => {
        socket.removeAllListeners('error');
        resolve(socket);
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new ScannerUnavailableError('clamd connection timed out'));
      });
      socket.once('error', (err) => {
        reject(new ScannerUnavailableError(`clamd connection failed: ${err.message}`));
      });
    });
  }

  private readAnswer(socket: net.Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      const parts: Buffer[] = [];
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        fn();
      };
      socket.on('data', (data: Buffer) => {
        parts.push(data);
        const text = Buffer.concat(parts);
        const end = text.indexOf(0);
        if (end >= 0) finish(() => resolve(text.subarray(0, end).toString('utf8')));
      });
      socket.once('end', () => {
        finish(() => resolve(Buffer.concat(parts).toString('utf8')));
      });
      socket.once('timeout', () =>
        finish(() => reject(new ScannerUnavailableError('clamd timed out'))),
      );
      socket.once('error', (err) =>
        finish(() => reject(new ScannerUnavailableError(`clamd connection error: ${err.message}`))),
      );
      socket.once('close', () =>
        finish(() => reject(new ScannerUnavailableError('clamd closed the connection'))),
      );
    });
  }
}

/** Parses a clamd reply (`stream: OK`, `stream: Name FOUND`, `... ERROR`). Exported for tests. */
export function parseAnswer(raw: string): ScanVerdict {
  const answer = raw.trim();
  if (/^stream:\s+OK$/i.test(answer)) return { status: 'clean' };
  const found = /^stream:\s+(.{1,200}?)\s+FOUND$/i.exec(answer);
  if (found) return { status: 'infected', signature: found[1]! };
  throw new ScannerUnavailableError(`clamd answered: ${answer.slice(0, 200) || '(nothing)'}`);
}

/** No scanner configured: uploads stay `pending` unless SCAN_REQUIRED=false (see the scan job). */
export class DisabledScanner implements VirusScanner {
  readonly enabled = false;
  async scan(): Promise<ScanVerdict> {
    throw new ScannerUnavailableError('no virus scanner is configured (CLAMD_HOST)');
  }
  async ping(): Promise<boolean> {
    return false;
  }
}
