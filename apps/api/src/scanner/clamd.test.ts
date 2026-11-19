import net from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamdScanner, DisabledScanner, ScannerUnavailableError, parseAnswer } from './clamd.js';

/** A minimal clamd: speaks zINSTREAM / zPING, answers by what the stream contained. */
function fakeClamd(
  behaviour: (payload: Buffer) => string | null = (p) =>
    p.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
      ? 'stream: Eicar-Test-Signature FOUND'
      : 'stream: OK',
) {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    let payload = Buffer.alloc(0);
    socket.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (command === null) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        command = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 1);
        if (command === 'zPING') {
          socket.end('PONG\0');
          return;
        }
      }
      // INSTREAM frames
      for (;;) {
        if (buf.length < 4) return;
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          received.push(payload);
          const answer = behaviour(payload);
          if (answer === null) return socket.destroy();
          socket.end(`${answer}\0`);
          return;
        }
        if (buf.length < 4 + len) return;
        payload = Buffer.concat([payload, buf.subarray(4, 4 + len)]);
        buf = buf.subarray(4 + len);
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as net.AddressInfo;
        resolve({
          port,
          received,
          close: () => new Promise((r) => server.close(() => r())),
        });
      });
    },
  );
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe('ClamdScanner (INSTREAM)', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
  });

  it('streams the bytes in length-prefixed frames and reports clean', async () => {
    const clamd = await fakeClamd();
    closers.push(clamd.close);
    const scanner = new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 });
    const body = Buffer.alloc(300_000, 7); // several 64 KiB frames
    expect(
      await scanner.scan(Readable.from([body.subarray(0, 100_000), body.subarray(100_000)])),
    ).toEqual({
      status: 'clean',
    });
    expect(clamd.received[0]!.equals(body)).toBe(true);
  });

  it('reports the signature of an infected stream (EICAR)', async () => {
    const clamd = await fakeClamd();
    closers.push(clamd.close);
    const scanner = new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 });
    expect(await scanner.scan(Readable.from([Buffer.from(EICAR)]))).toEqual({
      status: 'infected',
      signature: 'Eicar-Test-Signature',
    });
  });

  it('an ERROR answer, a dropped connection and a refused connection are failures, never "clean"', async () => {
    const limit = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    const drop = await fakeClamd(() => null);
    closers.push(limit.close, drop.close);
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: limit.port, timeoutMs: 5000 }).scan(
        Readable.from([Buffer.from('x')]),
      ),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: drop.port, timeoutMs: 5000 }).scan(
        Readable.from([Buffer.from('x')]),
      ),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
    const free = await fakeClamd();
    await free.close();
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: free.port, timeoutMs: 1000 }).scan(
        Readable.from([Buffer.from('x')]),
      ),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('a source stream that fails mid-way fails the scan', async () => {
    const clamd = await fakeClamd();
    closers.push(clamd.close);
    const broken = new Readable({
      read() {
        this.push(Buffer.from('abc'));
        this.destroy(new Error('storage went away'));
      },
    });
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000 }).scan(broken),
    ).rejects.toBeInstanceOf(ScannerUnavailableError);
  });

  it('ping answers true for a live daemon and false otherwise', async () => {
    const clamd = await fakeClamd();
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 2000 }).ping(),
    ).resolves.toBe(true);
    await clamd.close();
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 500 }).ping(),
    ).resolves.toBe(false);
  });

  it('parseAnswer understands the daemon vocabulary', () => {
    expect(parseAnswer('stream: OK')).toEqual({ status: 'clean' });
    expect(parseAnswer('stream: Win.Test.EICAR_HDB-1 FOUND')).toEqual({
      status: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseAnswer('INSTREAM size limit exceeded. ERROR')).toThrow(
      ScannerUnavailableError,
    );
    expect(() => parseAnswer('')).toThrow(ScannerUnavailableError);
  });

  it('the disabled scanner reports so and refuses to scan', async () => {
    const off = new DisabledScanner();
    expect(off.enabled).toBe(false);
    expect(await off.ping()).toBe(false);
    await expect(off.scan()).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});
