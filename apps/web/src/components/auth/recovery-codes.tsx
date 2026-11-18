'use client';

import { Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadCodes(codes: string[]) {
  const url = URL.createObjectURL(
    new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'asset-tracker-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(url);
}

export interface RecoveryCodesProps {
  codes: string[];
  /** The "I have saved these codes" checkbox; the caller disables its Continue / Close until it is true. */
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}

/**
 * The ten recovery codes with Copy and Download and the "I have saved these codes" checkbox. Shared
 * by MFA enrolment and by "New recovery codes" on the security page, so both gate the same way.
 */
export function RecoveryCodes({ codes, saved, onSavedChange }: RecoveryCodesProps) {
  const t = useT();
  const { toast } = useToast();

  const copy = async () => {
    if (await copyText(codes.join('\n')))
      toast({ variant: 'success', title: t('mfaEnrol.copied') });
  };

  return (
    <>
      <ul
        aria-label={t('mfaEnrol.recoveryList')}
        data-testid="recovery-codes"
        className="grid grid-cols-2 gap-2 rounded-md bg-sunken p-3 font-tag text-base"
      >
        {codes.map((recoveryCode) => (
          <li key={recoveryCode}>{recoveryCode}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>
          <Copy aria-hidden className="size-4" />
          {t('mfaEnrol.copyAll')}
        </Button>
        <Button onClick={() => downloadCodes(codes)}>
          <Download aria-hidden className="size-4" />
          {t('mfaEnrol.download')}
        </Button>
      </div>
      <Checkbox
        label={t('mfaEnrol.saved')}
        checked={saved}
        onCheckedChange={(value) => onSavedChange(value === true)}
      />
    </>
  );
}
