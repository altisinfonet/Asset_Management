import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('storage boundaries (M2-FILE-01: adapters behind a port)', () => {
  const eslint = new ESLint({ cwd: apiRoot });
  const restricted = async (filePath: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: join(apiRoot, filePath) });
    return result!.messages.filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports');
  };

  it('the AWS SDK is importable only inside src/storage', async () => {
    const code = "import { S3Client } from '@aws-sdk/client-s3';\nexport const x = S3Client;\n";
    for (const file of [
      'src/files/x.ts',
      'src/registry/x.ts',
      'src/platform/x.ts',
      'src/jobs/x.ts',
      'src/mail/x.ts',
      'src/roles/x.ts',
    ]) {
      expect(await restricted(file, code), file).toHaveLength(1);
    }
    expect(await restricted('src/storage/x.ts', code)).toEqual([]);
    expect(
      await restricted(
        'src/files/x.ts',
        "import { getSignedUrl } from '@aws-sdk/s3-request-presigner';\nexport const x = getSignedUrl;\n",
      ),
    ).toHaveLength(1);
  });

  it('storage and scanner are used through their facades only, and cannot reach the database client', async () => {
    expect(
      await restricted(
        'src/files/x.ts',
        "import { x } from '../storage/s3-storage.js';\nexport const y = x;\n",
      ),
    ).toHaveLength(1);
    expect(
      await restricted(
        'src/files/x.ts',
        "import { x } from '../scanner/clamd.js';\nexport const y = x;\n",
      ),
    ).toHaveLength(1);
    expect(
      await restricted(
        'src/files/x.ts',
        "import { x } from '../storage/index.js';\nexport const y = x;\n",
      ),
    ).toEqual([]);
    expect(
      await restricted('src/storage/x.ts', "import pg from 'pg';\nexport const y = pg;\n"),
    ).toHaveLength(1);
    expect(
      await restricted('src/scanner/x.ts', "import pg from 'pg';\nexport const y = pg;\n"),
    ).toHaveLength(1);
  });

  it('the kernel (storage, scanner) never imports the files domain module', async () => {
    expect(
      await restricted(
        'src/storage/x.ts',
        "import { x } from '../files/index.js';\nexport const y = x;\n",
      ),
    ).toHaveLength(1);
    expect(
      await restricted(
        'src/scanner/x.ts',
        "import { x } from '../files/index.js';\nexport const y = x;\n",
      ),
    ).toHaveLength(1);
  });
});
