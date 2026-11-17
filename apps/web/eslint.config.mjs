import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import { base } from '../../eslint.config.mjs';

const config = [
  ...base,
  ...nextCoreWebVitals,
  {
    // No hard-coded user-facing strings in screens or the app shell: text comes from the
    // message catalogue (src/i18n/messages/en.ts). The design-review gallery is exempt.
    files: ['src/app/**/*.tsx', 'src/components/app-shell/**/*.tsx', 'src/components/*.tsx'],
    ignores: ['src/app/ui/**', '**/*.test.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        { noStrings: false, ignoreProps: true, allowedStrings: ['/', '·', ':'] },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.ts', 'playwright.config.ts'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
];

export default config;
