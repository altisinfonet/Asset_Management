'use client';

import { Wrench } from 'lucide-react';
import { useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { useLookups } from '@/lib/registry/queries';
import type { Repair } from '@/lib/repairs/api';
import { useAssetHasOpenRepair } from '@/lib/repairs/queries';
import { LogRepairDialog } from './repair-dialogs';

/**
 * The status label of an asset says "not deployable" (in repair, broken, ...) but a repair record
 * is a separate thing: it carries the problem, the supplier and the cost. When an asset has (or is
 * about to get) an undeployable status and no open repair, point that out and offer to log one. It
 * never blocks anything.
 *
 * Rule: shown when the status label is of state type `undeployable`, the caller can read repairs
 * and the asset has no open repair. Only people with `repair:manage` get the "Log a repair" button;
 * everybody else gets the sentence. Callers do not render it for archived assets.
 */
export function NoRepairNotice({
  asset,
  statusId,
  variant,
  onLogged,
}: {
  asset: { id: string; asset_tag: string };
  /** The status the asset has (detail page) or is being given (edit form). */
  statusId: string;
  /** `inline` under a form field, `banner` as a callout on the asset page. */
  variant: 'inline' | 'banner';
  /** Called after the repair was logged (the asset's status and open repairs have been refreshed). */
  onLogged?: (repair: Repair) => void;
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const lookups = useLookups();
  const { known, hasOpen } = useAssetHasOpenRepair(asset.id);
  const [logging, setLogging] = useState(false);

  const undeployable = lookups.statusById.get(statusId)?.state_type === 'undeployable';
  const show = undeployable && known && !hasOpen;
  const mayLog = can('repair:manage');
  // While the dialog is open the asset already has its repair (the files step): keep it mounted.
  if (!show && !logging) return null;

  const action = mayLog ? (
    <Button size={variant === 'inline' ? 'sm' : 'md'} onClick={() => setLogging(true)}>
      <Wrench aria-hidden className="size-4" />
      {t('repairs.noRepair.action')}
    </Button>
  ) : null;

  return (
    <>
      {show ? (
        variant === 'banner' ? (
          <Banner tone="info" action={action} className="max-w-3xl">
            <span data-testid="no-repair-notice">{t('repairs.noRepair.text')}</span>
          </Banner>
        ) : (
          <div
            role="status"
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info bg-info-subtle px-3 py-2 text-sm text-info-text"
            data-testid="no-repair-notice"
          >
            <span className="min-w-0 flex-1">{t('repairs.noRepair.text')}</span>
            {action}
          </div>
        )
      ) : null}
      {mayLog ? (
        // The dialog is portalled, but React still bubbles its events to the parent tree: inside the
        // asset form its submit would otherwise save the form, and Ctrl+Enter would too.
        <div onSubmit={(event) => event.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <LogRepairDialog
            open={logging}
            onOpenChange={setLogging}
            asset={asset}
            defaultStatusId={statusId}
            onLogged={onLogged}
          />
        </div>
      ) : null}
    </>
  );
}
