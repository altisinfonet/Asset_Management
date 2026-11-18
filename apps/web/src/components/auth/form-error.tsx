'use client';

import { Banner } from '@/components/ui/banner';
import { useT } from '@/i18n';

/**
 * The one inline error above a form's submit button (wireframe WEB-01). It renders only when
 * there is a message, as `role="alert"`, so screen readers announce it the moment it appears.
 */
export function FormError({ message, requestId }: { message?: string | null; requestId?: string }) {
  const t = useT();
  if (!message) return null;
  return (
    <Banner tone="danger">
      {message}
      {requestId ? (
        <span className="mt-1 block font-tag text-xs">
          {t('access.requestId', { id: requestId })}
        </span>
      ) : null}
    </Banner>
  );
}
