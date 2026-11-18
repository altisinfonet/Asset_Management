import { vi } from 'vitest';

/**
 * Stand-in for `next/navigation` in unit tests. The location is the jsdom `window.location`, so a
 * test sets the URL with `window.history.pushState({}, '', '/assets/?x=1')` and the hooks follow.
 *
 *   vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));
 */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

export function resetRouter(): void {
  for (const fn of Object.values(router)) fn.mockReset();
  window.history.pushState({}, '', '/');
}

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
};
