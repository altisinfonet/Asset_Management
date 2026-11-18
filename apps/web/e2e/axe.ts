import type { Page } from '@playwright/test';

const axePath = require.resolve('axe-core');

/** Run axe (WCAG 2.2 A/AA, including colour contrast) in the real browser; returns readable violations. */
export async function violations(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            c: Document,
            o: object,
          ) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }>;
        };
      }
    ).axe;
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
  });
}
