/**
 * Tiny pub/sub so any API call that comes back `401` (outside the sign-in endpoints) can tell the
 * auth provider the session has ended, without every screen handling it.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportUnauthorized(): void {
  for (const listener of [...listeners]) listener();
}
