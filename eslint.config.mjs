// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Shared base config; apps/web extends it with the Next.js rules. */
export const base = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/out-mock/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/api-client/src/generated/**',
      'docs/**',
      'research/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);

export default base;
