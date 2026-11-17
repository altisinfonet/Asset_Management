'use client';

import { Eye, EyeOff, Package } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ThemeToggle } from '@/components/app-shell/theme-toggle';
import { PageTitle } from '@/components/page-title';
import { Button, IconButton } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useT } from '@/i18n';

/** Login screen shell (WEB-01). Authentication itself is wired in the auth story (M1-WEB-03). */
export default function LoginPage() {
  const t = useT();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    toast({ variant: 'info', title: t('login.placeholderNotice') });
  };

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
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <PageTitle title={t('login.title')} />
        <form
          onSubmit={onSubmit}
          className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-md"
        >
          <div>
            <h1 className="text-3xl font-semibold">{t('login.title')}</h1>
            <p className="mt-1 text-base text-muted">{t('login.description')}</p>
          </div>
          <Field label={t('login.email')} required>
            {(control) => <Input type="email" autoComplete="username" {...control} />}
          </Field>
          <Field label={t('login.password')} required>
            {(control) => (
              <div className="relative">
                {/* Paste stays allowed (WCAG 3.3.8) */}
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pr-11"
                  {...control}
                />
                <IconButton
                  icon={showPassword ? EyeOff : Eye}
                  label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                  size="icon-sm"
                  className="absolute top-1 right-1"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                />
              </div>
            )}
          </Field>
          <Button type="submit" variant="primary">
            {t('login.submit')}
          </Button>
          <Button variant="link" type="button" className="self-start">
            {t('login.forgot')}
          </Button>
        </form>
      </main>
    </div>
  );
}
