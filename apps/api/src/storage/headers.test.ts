import { describe, expect, it } from 'vitest';
import { FILE_RESPONSE_HEADERS, contentDisposition, sanitizeFilename } from './headers.js';

describe('file response headers (M2-SEC-02: documented and tested)', () => {
  it('the full header set for served files', () => {
    expect(FILE_RESPONSE_HEADERS).toEqual({
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'cross-origin',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
  });

  it('Content-Disposition is attachment or inline with an ASCII fallback and an RFC 5987 name', () => {
    expect(contentDisposition('report.pdf', 'attachment')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(contentDisposition('Rückblick 2026.pdf', 'inline')).toBe(
      `inline; filename="R_ckblick 2026.pdf"; filename*=UTF-8''R%C3%BCckblick%202026.pdf`,
    );
  });

  it('a hostile file name cannot break out of the header or spoof an extension', () => {
    const evil = 'a"; filename="x.exe\r\nSet-Cookie: pwn=1‮gpj.exe';
    const header = contentDisposition(evil, 'attachment');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain('‮');
    expect(header.match(/filename="/g)).toHaveLength(1);
    expect(sanitizeFilename('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFilename('..\\..\\win.ini')).not.toMatch(/[\\/]/);
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('   ')).toBe('file');
    expect(sanitizeFilename('x'.repeat(400))).toHaveLength(255);
    expect(sanitizeFilename('a\u0000b\u001fc\u007fd')).toBe('a_b_c_d');
  });
});
