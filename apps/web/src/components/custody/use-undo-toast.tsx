'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { createKeyKeeper } from '@/lib/custody/helpers';
import { custodyApi } from '@/lib/registry/api';

/**
 * Undo after a custody action (M2-UX-02, ED-23). The success toast of a check-out, check-in or
 * transfer carries an "Undo" action for {@link UNDO_SECONDS} seconds (paused while the pointer or
 * keyboard focus is on the toast). Undo is NOT a delete: the API performs the inverse action and the
 * history shows both. It needs the ETag the action answered with: if the asset changed since (an edit,
 * another custody action, a move), the API refuses and the message says so.
 *
 * Keyboard and screen readers: the toast is announced politely with the hint "You can undo this for 10
 * seconds"; F8 moves focus to the notifications region, where "Undo" is the first control.
 */
export const UNDO_SECONDS = 10;

/** One action to be undone: the asset, the ETag the action answered with and its assignment. */
export interface UndoItem {
  assetId: string;
  assetTag: string;
  etag: string | undefined;
  assignmentId: string;
}

const REFRESH_KEYS = [
  'asset',
  'assets',
  'asset-history',
  'people',
  'person-held',
  'person-history',
  'locations',
];

export function useUndoToast() {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();

  const refresh = useCallback(
    () => Promise.all(REFRESH_KEYS.map((key) => client.invalidateQueries({ queryKey: [key] }))),
    [client],
  );

  const undo = useCallback(
    async (items: UndoItem[]) => {
      let done = 0;
      const failures: string[] = [];
      for (const item of items) {
        try {
          if (!item.etag) throw new Error('no etag');
          await custodyApi.undo(
            item.assetId,
            { assignment_id: item.assignmentId },
            { idempotencyKey: createKeyKeeper().keyFor(item), etag: item.etag },
          );
          done += 1;
        } catch (err) {
          const ui = getApi().toUiError(err);
          failures.push(
            ui.kind === 'stale' || ui.code === 'undo-asset-changed'
              ? t('custodyUndo.changed', { tag: item.assetTag })
              : ui.code === 'undo-expired'
                ? t('custodyUndo.tooLate', { tag: item.assetTag })
                : ui.detail
                  ? t('custodyUndo.refused', { tag: item.assetTag, reason: ui.detail })
                  : t('custodyUndo.failed', { tag: item.assetTag }),
          );
        }
      }
      await refresh();
      if (failures.length === 0) {
        toast({
          variant: 'success',
          title:
            items.length === 1
              ? t('custodyUndo.undone', { tag: items[0]!.assetTag })
              : t('custodyUndo.undoneBulk', { count: items.length }),
        });
        return;
      }
      toast({
        variant: 'danger',
        title:
          items.length === 1
            ? failures[0]!
            : t('custodyUndo.undoneSome', {
                done,
                total: items.length,
                failed: failures.length,
              }),
        ...(items.length > 1 ? { description: failures.join(' ') } : {}),
      });
    },
    [refresh, t, toast],
  );

  /** The success toast of a custody action, with Undo for the assets it changed. */
  return useCallback(
    (title: string, items: UndoItem[]) => {
      if (items.length === 0) {
        toast({ variant: 'success', title });
        return;
      }
      toast({
        variant: 'success',
        title,
        description: t('custodyUndo.hint', { seconds: UNDO_SECONDS }),
        duration: UNDO_SECONDS * 1000,
        action: { label: t('custodyUndo.action'), onClick: () => void undo(items) },
      });
    },
    [toast, t, undo],
  );
}
