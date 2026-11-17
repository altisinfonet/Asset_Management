import { describe, expect, it } from 'vitest';
import { tokens } from './index.js';

describe('tokens', () => {
  it('exposes the primary colour and a spacing scale', () => {
    expect(tokens.color.primary).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tokens.spacing.md).toBeGreaterThan(tokens.spacing.sm);
  });
});
