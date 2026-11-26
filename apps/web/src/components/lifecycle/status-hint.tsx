'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { statusHintKind } from '@/lib/registry/lifecycle';
import { useLookups } from '@/lib/registry/queries';
import type { Asset } from '@/lib/registry/types';
import { DisposeDialog, MarkLostDialog } from './lifecycle-dialogs';

/**
 * The status list of the asset form also has lost-type and archived-type labels. Picking one there
 * only changes the label: a check-out stays open and a retired asset stays in the active list. Like
 * the "not deployable without a repair" notice, this points at the action that does it properly
 * (Mark as lost or stolen, Dispose) and offers it right here. It never blocks saving.
 */
export function LifecycleStatusHint({
  asset,
  etag,
  statusId,
  onDone,
}: {
  asset: Asset;
  etag?: string;
  /** The status being given in the form. */
  statusId: string;
  /** After the action ran (the form's data is stale then). */
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const lookups = useLookups();
  const [open, setOpen] = useState<'lost' | 'archived' | null>(null);
  const kind =
    statusId !== asset.status_id
      ? statusHintKind(lookups.statusById.get(statusId)?.state_type)
      : null;
  const mayAct = kind === 'lost' ? can('asset:update') : can('asset:delete');

  return (
    <>
      {kind ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info bg-info-subtle px-3 py-2 text-sm text-info-text"
          data-testid="lifecycle-status-hint"
        >
          <span className="min-w-0 flex-1">{t(`lifecycle.statusHint.${kind}`)}</span>
          {mayAct ? (
            <Button size="sm" type="button" onClick={() => setOpen(kind)}>
              {kind === 'lost'
                ? t('lifecycle.statusHint.useMarkLost')
                : t('lifecycle.statusHint.useDispose')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* portalled dialogs still bubble their events through React: keep them away from the form */}
      <div onSubmit={(event) => event.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <MarkLostDialog
          open={open === 'lost'}
          onOpenChange={(next) => !next && setOpen(null)}
          asset={asset}
          etag={etag}
          onDone={onDone}
        />
        <DisposeDialog
          open={open === 'archived'}
          onOpenChange={(next) => !next && setOpen(null)}
          assets={[asset]}
          etag={etag}
          onDone={onDone}
        />
      </div>
    </>
  );
}
