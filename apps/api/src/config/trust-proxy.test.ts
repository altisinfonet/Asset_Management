import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './env.js';
import { parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('defaults to trusting nobody', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy(' FALSE ')).toBe(false);
  });

  it('accepts true, a hop count and a list of IPs / CIDRs', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('3')).toBe(3);
    expect(parseTrustProxy('10.0.0.0/8')).toEqual(['10.0.0.0/8']);
    expect(parseTrustProxy('127.0.0.1, 10.0.0.0/8 ,fd00::/8, ::1')).toEqual([
      '127.0.0.1',
      '10.0.0.0/8',
      'fd00::/8',
      '::1',
    ]);
  });

  it('rejects values it cannot interpret instead of silently trusting or ignoring them', () => {
    for (const bad of ['0', '33', '10.0.0.0/33', '300.1.1.1', 'loopback', '10.0.0.1,', 'a/b/c']) {
      expect(() => parseTrustProxy(bad), bad).toThrow(/TRUST_PROXY/);
    }
  });
});

describe('TRUST_PROXY in the configuration', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/d' };

  it('is false unless set, and validated at startup', () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8,127.0.0.1' }).TRUST_PROXY).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'everyone' })).toThrow(ConfigError);
  });
});
