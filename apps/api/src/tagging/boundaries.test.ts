import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcRoot = join(apiRoot, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !dir.includes('generated')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('tagging boundaries (M2-TAG-02, ADR 0007)', () => {
  it('the PDF and barcode libraries are imported only by the tagging module (the renderer is the one place)', () => {
    const offenders = sources(srcRoot)
      .filter((f) => !f.startsWith(join(srcRoot, 'tagging')))
      .filter((f) => /from '(pdfkit|bwip-js)'/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the module is used through its facade, and cannot reach the database client', async () => {
    const eslint = new ESLint({ cwd: apiRoot });
    const restricted = async (filePath: string, code: string) => {
      const [result] = await eslint.lintText(code, { filePath: join(apiRoot, filePath) });
      return result!.messages.filter(
        (m) => m.ruleId === '@typescript-eslint/no-restricted-imports',
      );
    };
    expect(
      await restricted(
        'src/files/x.ts',
        "import { x } from '../tagging/render.js';\nexport const y = x;\n",
      ),
    ).toHaveLength(1);
    expect(
      await restricted(
        'src/files/x.ts',
        "import { x } from '../tagging/index.js';\nexport const y = x;\n",
      ),
    ).toEqual([]);
    expect(
      await restricted('src/tagging/x.ts', "import pg from 'pg';\nexport const y = pg;\n"),
    ).toHaveLength(1);
    // and the registry's internals stay behind the registry facade
    expect(
      await restricted(
        'src/tagging/x.ts',
        "import { x } from '../registry/asset-selection.js';\nexport const y = x;\n",
      ),
    ).toHaveLength(1);
  });
});
