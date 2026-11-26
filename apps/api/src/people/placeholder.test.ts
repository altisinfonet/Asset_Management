import { describe, expect, it } from 'vitest';
import { isLoginPlaceholder } from './people.service.js';

/** ED-33: which person is the login account's own automatic record. */
describe('isLoginPlaceholder', () => {
  const person = (over: {
    user_id?: string | null;
    created_by?: string | null;
    updated_by?: string | null;
  }) => ({ user_id: 'u1', created_by: null, updated_by: null, ...over });

  it('is the record the system made for the login and nobody touched since', () => {
    expect(isLoginPlaceholder(person({}))).toBe(true);
  });

  it('is not a person somebody made, linked or edited, nor one without a login', () => {
    expect(isLoginPlaceholder(person({ created_by: 'admin' }))).toBe(false);
    // linking sets updated_by: a seeded person (no maker) chosen for a login is a chosen person
    expect(isLoginPlaceholder(person({ updated_by: 'admin' }))).toBe(false);
    expect(isLoginPlaceholder(person({ user_id: null }))).toBe(false);
  });
});
