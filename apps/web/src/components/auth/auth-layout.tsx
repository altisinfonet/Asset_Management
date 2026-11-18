'use client';

import { Package } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { PageTitle } from '@/components/page-title';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Frame for every screen that is shown before sign-in (and for the forced MFA enrolment):
 * brand and theme toggle on top, one centred card below (wireframe WEB-01). No application
 * navigation here, because these screens work without a session.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-on"
          >
            <Package className="size-4" />
          </span>
          <span className="text-lg font-semibold">{t('app.name')}</span>
        </div>
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:pt-12">
        {children}
      </main>
    </div>
  );
}

export interface AuthCardProps {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Wider card (QR code and recovery codes). */
  wide?: boolean;
  /**
   * Move focus to the heading when the card appears. Use it for steps the user reaches after
   * an action (next step, success, error panel) so screen readers announce the new context;
   * not for the first card of a page load.
   */
  focusHeading?: boolean;
  className?: string;
}

/** One card with the page `h1`. Sets the document title too. */
export function AuthCard({
  title,
  description,
  children,
  wide = false,
  focusHeading = false,
  className,
}: AuthCardProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, [focusHeading]);

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex w-full flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-md',
        wide ? 'max-w-lg' : 'max-w-sm',
        className,
      )}
    >
      <PageTitle title={title} />
      <div>
        <h1
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-semibold outline-none"
        >
          {title}
        </h1>
        {description ? <p className="mt-1 text-base text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
