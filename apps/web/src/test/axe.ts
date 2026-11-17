import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Run axe (WCAG 2.2 A/AA rules) on a rendered subtree and fail with a readable list.
 * Colour contrast is verified from the tokens (packages/ui-tokens contrast test) because jsdom
 * has no layout or computed colours; `region` is off because fragments are not full pages.
 */
export async function expectNoA11yViolations(root: Element = document.body) {
  const results = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary).toEqual([]);
}
