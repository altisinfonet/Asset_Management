import type { ReactNode } from 'react';
import { PageTitle } from '@/components/page-title';

/**
 * Header of a settings page. The settings shell already owns the page's `h1` ("Settings"), so a
 * section titles itself with an `h2` and sets the document title.
 */
export function SectionHeader({
  title,
  description,
  actions,
  section,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Section id, exposed to tests as `data-testid="settings-section"`. */
  section: string;
}) {
  return (
    <>
      <PageTitle title={title} />
      <p data-testid="settings-section" className="sr-only">
        {section}
      </p>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text">{title}</h2>
          {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </>
  );
}
