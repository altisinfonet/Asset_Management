'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { EXPORT_PERMISSION, EXPORT_READ_PERMISSION, type ExportResource } from '@/lib/exports/api';
import { ExportDialog } from './export-dialog';

/**
 * "Export CSV" of a list (people, locations): only for someone who may run exports AND read the
 * list, which is what the API checks too. Opening the dialog starts the export.
 */
export function ExportButton({
  resource,
  query,
  size = 'md',
}: {
  resource: ExportResource;
  /** The query of the list as it is shown now (paging and presentation members are left out). */
  query: object;
  size?: 'sm' | 'md';
}) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can(EXPORT_PERMISSION) || !can(EXPORT_READ_PERMISSION[resource])) return null;
  return (
    <>
      <Button size={size === 'sm' ? 'sm' : undefined} onClick={() => setOpen(true)}>
        <Download aria-hidden className="size-4" />
        {t('exports.button')}
      </Button>
      <ExportDialog open={open} onOpenChange={setOpen} resource={resource} query={query} />
    </>
  );
}
