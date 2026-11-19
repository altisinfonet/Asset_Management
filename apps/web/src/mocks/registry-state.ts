import { buildSeed, type RegistryData } from './registry-fixtures';
import { onMockReset } from './state';

/**
 * The mock registry (categories, fields, assets, users ...). Held in memory and mirrored to
 * `localStorage` on every change, so a full page load (hard refresh, Playwright `reload`) keeps
 * what a user created, like a real database would. First use seeds the ~200-asset fixture.
 */
const KEY = 'at-mock-registry';

let memory: RegistryData | undefined;

export function registry(): RegistryData {
  if (memory) return memory;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as RegistryData;
      // State saved by an older build lacks the numbering template.
      saved.tagTemplate ??= { prefix: '', width: 5, use_category_prefix: true };
      saved.settingsVersion ??= 1;
      // ... and M2 data (people, custody, attachments): start from the current seed instead.
      if (saved.people && saved.assignments && saved.attachments && saved.filesSettings) {
        memory = saved;
        return memory;
      }
    }
  } catch {
    // storage unavailable or corrupt: fall back to the seed
  }
  memory = buildSeed();
  return memory;
}

/** Apply `change` to the registry and persist the result. */
export function mutateRegistry<T>(change: (data: RegistryData) => T): T {
  const data = registry();
  const result = change(data);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage unavailable or full: memory only
  }
  return result;
}

export function resetRegistry(): void {
  memory = undefined;
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

onMockReset(resetRegistry);
