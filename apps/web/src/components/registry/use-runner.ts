'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';
import { getApi } from '@/lib/api';
import { useInvalidateLookups } from '@/lib/registry/queries';
import type { Versioned } from '@/lib/registry/types';

/**
 * Runs a write from a table action (reorder, archive, resend ...): refreshes the catalogue
 * lookups afterwards, confirms with a toast and reports a failure with the request id.
 * Returns whether it succeeded.
 */
export function useRunner() {
  const t = useT();
  const { toast } = useToast();
  const invalidate = useInvalidateLookups();
  return useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      try {
        await action();
        await invalidate();
        if (success) toast({ variant: 'success', title: success });
        return true;
      } catch (err) {
        const ui = getApi().toUiError(err);
        toast({
          variant: 'danger',
          title: t(ui.messageKey),
          description: ui.detail,
          requestId: ui.requestId,
        });
        return false;
      }
    },
    [invalidate, t, toast],
  );
}

export type EditTarget<T> = { kind: 'new' } | { kind: 'edit'; versioned: Versioned<T> };

/**
 * State of a create / edit dialog. `openEdit` loads the current version first, so the dialog
 * saves with the ETag the user actually saw (a concurrent change then answers 412).
 */
export function useEditor<T>(load: (id: string) => Promise<Versioned<T>>) {
  const [target, setTarget] = useState<EditTarget<T> | null>(null);
  const run = useRunner();
  const openNew = useCallback(() => setTarget({ kind: 'new' }), []);
  const openEdit = useCallback(
    async (id: string) => {
      let loaded: Versioned<T> | undefined;
      await run(async () => {
        loaded = await load(id);
      });
      if (loaded) setTarget({ kind: 'edit', versioned: loaded });
    },
    [load, run],
  );
  const close = useCallback(() => setTarget(null), []);
  return { target, openNew, openEdit, close };
}
