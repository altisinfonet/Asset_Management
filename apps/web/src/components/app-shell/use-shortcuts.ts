'use client';

import { useEffect } from 'react';

/** Keys of the "Go to" sequences (`g` then one of these) and where they lead. */
export const GO_TO_KEYS = { d: 'dashboard', a: 'assets', s: 'settings' } as const;
export type GoToTarget = (typeof GO_TO_KEYS)[keyof typeof GO_TO_KEYS];

const SEQUENCE_WINDOW_MS = 1000;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="menu"]');
}

/**
 * Single-key shortcuts that work anywhere except while typing or while a dialog or menu is
 * open: `?` shows the shortcut help, `g` then `d`/`a`/`s` goes to a screen, `c` creates an asset (wireframe WEB-21).
 * Ctrl/Cmd+K and `/` are handled next to the palette and the scan field.
 */
export function useShortcuts({
  onHelp,
  onGoTo,
  onNewAsset,
}: {
  onHelp: () => void;
  onGoTo: (target: GoToTarget) => void;
  /** `c` starts a new asset; leave undefined when the user may not create assets. */
  onNewAsset?: () => void;
}): void {
  useEffect(() => {
    let pendingG: number | undefined;

    const clear = () => {
      if (pendingG !== undefined) window.clearTimeout(pendingG);
      pendingG = undefined;
    };

    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target) || modalOpen()) return;

      if (event.key === '?') {
        event.preventDefault();
        clear();
        onHelp();
        return;
      }
      if (pendingG !== undefined) {
        const target = GO_TO_KEYS[event.key.toLowerCase() as keyof typeof GO_TO_KEYS];
        clear();
        if (target) {
          event.preventDefault();
          onGoTo(target);
        }
        return;
      }
      if (event.key === 'c' && onNewAsset) {
        event.preventDefault();
        onNewAsset();
        return;
      }
      if (event.key.toLowerCase() === 'g' && !event.shiftKey) {
        pendingG = window.setTimeout(clear, SEQUENCE_WINDOW_MS);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clear();
    };
  }, [onHelp, onGoTo, onNewAsset]);
}
