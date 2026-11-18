'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { useT, type TranslationKey } from '@/i18n';

interface Shortcut {
  labelKey: TranslationKey;
  /** Keys in the order they are pressed (a chord, or a sequence when `sequence` is set). */
  keys: string[];
  sequence?: boolean;
}

const GENERAL: Shortcut[] = [
  { labelKey: 'shortcuts.palette', keys: ['Ctrl', 'K'] },
  { labelKey: 'shortcuts.scan', keys: ['/'] },
  { labelKey: 'shortcuts.newAsset', keys: ['C'] },
  { labelKey: 'shortcuts.help', keys: ['?'] },
  { labelKey: 'shortcuts.close', keys: ['Esc'] },
];

const NAVIGATION: Shortcut[] = [
  { labelKey: 'shortcuts.goDashboard', keys: ['G', 'D'], sequence: true },
  { labelKey: 'shortcuts.goAssets', keys: ['G', 'A'], sequence: true },
  { labelKey: 'shortcuts.goSettings', keys: ['G', 'S'], sequence: true },
];

function ShortcutList({ heading, items }: { heading: string; items: Shortcut[] }) {
  const t = useT();
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-muted">{heading}</h3>
      <dl className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.labelKey} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-base">{t(item.labelKey)}</dt>
            <dd className="flex items-center gap-1">
              {item.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Keyboard shortcut reference (opened with `?`, from the user menu or the palette). */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('shortcuts.title')}</DialogTitle>
          <DialogDescription>{t('shortcuts.description')}</DialogDescription>
        </DialogHeader>
        <ShortcutList heading={t('shortcuts.general')} items={GENERAL} />
        <ShortcutList heading={t('shortcuts.navigation')} items={NAVIGATION} />
        <p className="text-sm text-muted">{t('shortcuts.sequenceHint')}</p>
      </DialogContent>
    </Dialog>
  );
}
