import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import type { TenancyService } from '../tenancy/index.js';
import { SessionService } from './session.service.js';

const dbUrl = 'postgres://app:dev@localhost:6432/app';
const token = 'A'.repeat(43);
const inOneHour = () => new Date(Date.now() + 3_600_000);

function service(extra: Record<string, string> = {}): SessionService {
  return new SessionService({} as TenancyService, loadConfig({ DATABASE_URL: dbUrl, ...extra }));
}

describe('session cookie', () => {
  it('is __Host-at_session with Secure by default', () => {
    const s = service();
    expect(s.cookieFor(token, inOneHour())).toMatch(
      /^__Host-at_session=A{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/,
    );
    expect(s.clearCookie()).toBe(
      '__Host-at_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    );
  });

  it('is at_session without Secure when SESSION_COOKIE_SECURE=false', () => {
    const s = service({ SESSION_COOKIE_SECURE: 'false' });
    const set = s.cookieFor(token, inOneHour());
    expect(set).toMatch(/^at_session=A{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect(set).not.toMatch(/Secure/);
    expect(s.clearCookie()).toBe('at_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });

  it('reads only the cookie name of the active mode', () => {
    const secure = service();
    const plain = service({ SESSION_COOKIE_SECURE: 'false' });
    expect(secure.tokenFromCookieHeader(`x=1; __Host-at_session=${token}`)).toBe(token);
    expect(secure.tokenFromCookieHeader(`at_session=${token}`)).toBeUndefined();
    expect(plain.tokenFromCookieHeader(`x=1; at_session=${token}`)).toBe(token);
    expect(plain.tokenFromCookieHeader(`__Host-at_session=${token}`)).toBeUndefined();
  });
});
