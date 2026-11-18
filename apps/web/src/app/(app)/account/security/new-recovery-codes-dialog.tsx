'use client';

import { useState } from 'react';
import { RecoveryCodes } from '@/components/auth/recovery-codes';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/i18n';

export interface NewRecoveryCodesDialogProps {
  /** The fresh codes; `null` while the dialog is closed. */
  codes: string[] | null;
  onClose: () => void;
}

/**
 * Shows the ten new recovery codes exactly once, with the same Copy / Download / "I have saved
 * these codes" component as enrolment. It cannot be closed (Esc, overlay, Close) until the box is
 * ticked: the codes are never shown again and the old ones are already dead.
 */
export function NewRecoveryCodesDialog({ codes, onClose }: NewRecoveryCodesDialogProps) {
  return (
    <Dialog open={codes !== null} onOpenChange={() => undefined}>
      <DialogContent size="md" hideClose onEscapeKeyDown={(event) => event.preventDefault()}>
        {codes ? <Codes codes={codes} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Codes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('security.newCodesDone')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('security.newCodesDescription')}
        </DialogDescription>
      </DialogHeader>
      <Banner tone="warning">{t('security.newCodesWarning')}</Banner>
      <RecoveryCodes codes={codes} saved={saved} onSavedChange={setSaved} />
      <DialogFooter>
        <Button variant="primary" disabled={!saved} onClick={onClose}>
          {t('security.newCodesClose')}
        </Button>
      </DialogFooter>
    </>
  );
}
