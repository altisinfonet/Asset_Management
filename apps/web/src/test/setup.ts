import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '@/mocks/server';
import { resetMockState } from '@/mocks/state';

// findBy* / waitFor give up after 1 s by default, independent of the test timeout. The mock API answers in
// milliseconds on an idle machine, but `turbo run` runs every package's checks at once and a busy CPU then
// stretches a debounced search or a mocked round trip past 1 s (assets-table search, scanner burst). 5 s keeps
// the assertions meaningful and a real failure is still reported, just after the longer wait.
configure({ asyncUtilTimeout: 5000 });

// Mock API for every test (MSW, handlers derived from docs/engineering/openapi.yaml). Tests that
// need a different answer override it with `server.use(...)`; state resets after each test.
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  resetMockState();
});
afterAll(() => server.close());

// jsdom lacks several browser APIs that Radix UI and cmdk rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
}
