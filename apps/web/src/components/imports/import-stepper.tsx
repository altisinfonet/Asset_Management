'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { stepperIndex, WIZARD_STEPS, type WizardStep } from '@/lib/imports/helpers';

/**
 * The wizard's step indicator (design system W21): numbered steps, the current one marked with
 * `aria-current="step"`, finished ones with a check. A finished step that can be revisited is a link
 * (each step is reachable by URL); the others are plain text.
 */
export function ImportStepper({
  step,
  links = {},
}: {
  step: WizardStep;
  /** Where a finished step leads, when it can be revisited. */
  links?: Partial<Record<WizardStep, string>>;
}) {
  const { t } = useI18n();
  const current = stepperIndex(step);
  const finished = step === 'done';
  return (
    <div className="mb-6 flex flex-col gap-1">
      <p className="text-sm text-muted" data-testid="import-step-caption">
        {t('imports.steps.current', {
          current: current + 1,
          total: WIZARD_STEPS.length,
          name: t(`imports.steps.${WIZARD_STEPS[current]!}`),
        })}
      </p>
      <ol aria-label={t('imports.steps.label')} className="flex flex-wrap gap-x-1 gap-y-2">
        {WIZARD_STEPS.map((name, index) => {
          const done = index < current || (finished && index === current);
          const active = index === current && !finished;
          const href = done && !active ? links[name] : undefined;
          const body = (
            <>
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  done && 'border-success bg-success-subtle text-success-text',
                  active && 'border-primary bg-primary text-primary-on',
                  !done && !active && 'border-border-strong text-muted',
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className={cn('text-sm', active ? 'font-semibold text-text' : 'text-muted')}>
                {t(`imports.steps.${name}`)}
              </span>
            </>
          );
          return (
            <li key={name} aria-current={active ? 'step' : undefined} className="flex items-center">
              {href ? (
                <Link
                  href={href}
                  className="flex min-h-(--size-control-dense) items-center gap-2 rounded-md px-2 hover:bg-sunken"
                >
                  {body}
                </Link>
              ) : (
                <span className="flex min-h-(--size-control-dense) items-center gap-2 px-2">
                  {body}
                </span>
              )}
              {index < WIZARD_STEPS.length - 1 ? (
                <span aria-hidden className="mx-1 hidden h-px w-4 bg-border-strong sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
