import { describe, expect, it } from 'vitest';
import { hasAnyPermission, hasPermission } from './permissions';
import { safeNext } from './next-url';

describe('safeNext (post-login redirect target)', () => {
  it('keeps same-origin paths, including the query string', () => {
    expect(safeNext('/assets/')).toBe('/assets/');
    expect(safeNext('/assets/view/?code=AT-1')).toBe('/assets/view/?code=AT-1');
    expect(safeNext('/settings/users')).toBe('/settings/users');
  });

  it('falls back to the dashboard for empty values', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
  });

  it('rejects anything that could leave the site (open redirect)', () => {
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/\t/evil.example',
      '/\n/evil.example',
      'evil.example',
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  it('never loops back into the auth screens', () => {
    for (const blocked of [
      '/login',
      '/login?next=%2F',
      '/forgot-password/',
      '/mfa/enroll',
      '/invitation?token=x',
    ]) {
      expect(safeNext(blocked)).toBe('/');
    }
    expect(safeNext('/loginfo')).toBe('/loginfo');
  });
});

describe('permissions', () => {
  it('matches exact, resource wildcard and global wildcard grants', () => {
    expect(hasPermission(['asset:read'], 'asset:read')).toBe(true);
    expect(hasPermission(['asset:read'], 'asset:write')).toBe(false);
    expect(hasPermission(['asset:*'], 'asset:write')).toBe(true);
    expect(hasPermission(['asset:*'], 'user:read')).toBe(false);
    expect(hasPermission(['*'], 'anything:at-all')).toBe(true);
  });

  it('any-of semantics, and nothing needed means allowed', () => {
    expect(hasAnyPermission(['user:read'], ['catalog:manage', 'user:read'])).toBe(true);
    expect(hasAnyPermission(['user:read'], ['catalog:manage'])).toBe(false);
    expect(hasAnyPermission([], undefined)).toBe(true);
    expect(hasAnyPermission([], [])).toBe(true);
  });
});
