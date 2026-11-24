'use client';

import { Banner } from '@/components/ui/banner';
import { useT } from '@/i18n';

/**
 * The one inline error above a form's submit button (wireframe WEB-01). It renders only when
 * there is a message, as `role="alert"`, so screen readers announce it the moment it appears.
 */
export function FormError({
  message,
  requestId,
  details,
}: {
  message?: string | null;
  requestId?: string;
  /** What exactly was refused, one line each (problems that have no field of their own). */
  details?: string[];
}) {
  const t = useT();
  if (!message) return null;
  return (
    <Banner tone="danger">
      {message}
      {details && details.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {requestId ? (
        <span className="mt-1 block font-tag text-xs">
          {t('access.requestId', { id: requestId })}
        </span>
      ) : null}
    </Banner>
  );
}
