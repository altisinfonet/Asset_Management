import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { colorVarName, generate, leaves, readTokens } from '../scripts/generate.mjs';
import { colorVars, tokens } from './index.js';

const source = readTokens();
const generatedDir = path.resolve(import.meta.dirname, 'generated');

describe('generated files are in sync with docs/design/tokens.json', () => {
  const fresh = generate(source);
  it.each(Object.keys(fresh))(
    '%s is up to date (run `pnpm --filter @assettracker/ui-tokens generate`)',
    (name) => {
      const committed = readFileSync(path.join(generatedDir, name), 'utf8');
      expect(committed).toBe(fresh[name]);
    },
  );
});

describe('tokens.ts matches tokens.json', () => {
  it('has every colour in both modes with the exact value', () => {
    for (const mode of ['light', 'dark'] as const) {
      const entries = leaves(source.color[mode]);
      expect(entries).toHaveLength(43);
      for (const [p, leaf] of entries) {
        const value = p.reduce<unknown>(
          (cursor, key) => (cursor as Record<string, unknown>)[key],
          tokens.color[mode],
        );
        expect(value, `${mode}.${p.join('.')}`).toBe(leaf.$value);
        expect(colorVars[mode][colorVarName(p) as keyof (typeof colorVars)['light']]).toBe(
          leaf.$value,
        );
      }
    }
  });

  it('converts dimensions to numbers', () => {
    expect(tokens.font.size.base).toBe(14);
    expect(tokens.font.lineHeight.base).toBe(20);
    expect(tokens.size.control).toBe(36);
    expect(tokens.size['control-dense']).toBe(28);
    expect(tokens.size.drawer).toBe(480);
    expect(tokens.size.sidebar).toBe(232);
    expect(tokens.radius.md).toBe(6);
    expect(tokens.duration.base).toBe(160);
    expect(tokens.breakpoint.lg).toBe(1024);
    expect(tokens.zIndex.toast).toBe(70);
  });

  it('keeps the 4px space scale that Tailwind multiples rely on', () => {
    for (const [key, value] of Object.entries(tokens.space)) {
      expect(value).toBe(Number(key) * 4);
    }
  });

  it('keeps font stacks as written in tokens.json', () => {
    expect(tokens.font.family.sans[0]).toBe('Inter');
    expect(tokens.font.family.mono[0]).toBe('JetBrains Mono');
  });
});

describe('tokens.css matches tokens.json', () => {
  const css = readFileSync(path.join(generatedDir, 'tokens.css'), 'utf8');

  function block(startMarker: string): string {
    const start = css.indexOf(startMarker);
    expect(start, startMarker).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    // the dark media block nests one rule, so match braces
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) return css.slice(open, i);
    }
    throw new Error('unbalanced braces');
  }

  it('declares every light colour on :root and every dark colour under both dark selectors', () => {
    const lightBlock = block(":root,\n[data-theme='light']");
    const darkMedia = block('@media (prefers-color-scheme: dark)');
    const darkAttr = block("[data-theme='dark']");
    for (const [p, leaf] of leaves(source.color.light)) {
      expect(lightBlock).toContain(`--color-${colorVarName(p)}: ${leaf.$value};`);
    }
    for (const [p, leaf] of leaves(source.color.dark)) {
      const decl = `--color-${colorVarName(p)}: ${leaf.$value};`;
      expect(darkMedia).toContain(decl);
      expect(darkAttr).toContain(decl);
    }
  });

  it('does not let the OS dark preference override an explicit light choice', () => {
    expect(css).toContain(":root:not([data-theme='light'])");
  });

  it('emits sizes, radii and the Tailwind theme with the same values', () => {
    expect(css).toContain('--size-drawer: 480px;');
    expect(css).toContain('--size-control-dense: 28px;');
    expect(css).toContain('--radius-xl: 12px;');
    const tw = readFileSync(path.join(generatedDir, 'tailwind-theme.css'), 'utf8');
    expect(tw).toContain('@theme static');
    expect(tw).toContain('--text-sm: 13px;');
    expect(tw).toContain('--text-sm--line-height: 20px;');
    expect(tw).toContain('--color-primary: #0F766E;');
  });
});
