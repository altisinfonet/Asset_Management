import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits the decorator metadata that NestJS constructor injection relies on.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Several unit tests run real tools (ESLint on boundary fixtures, PDF rasterising and code decoding)
    // and take 2-5 s each; under a loaded parallel `turbo` run they crossed vitest's 5 s default.
    testTimeout: 15_000,
  },
});
