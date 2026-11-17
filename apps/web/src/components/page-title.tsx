'use client';

import { useEffect } from 'react';
import { useT } from '@/i18n';

/**
 * Sets `document.title` for client-rendered pages (static export has no per-request metadata for
 * query-string routes). Renders nothing.
 */
export function PageTitle({ title }: { title: string }) {
  const t = useT();
  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
  }, [title, t]);
  return null;
}
