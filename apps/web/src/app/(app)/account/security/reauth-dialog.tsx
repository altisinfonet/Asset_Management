'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '@/components/auth/form-error';
import { PasswordField } from '@/components/auth/password-field';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { toUiError } from '@/lib/api';
import { errorCode, isStatus, tooManyAttemptsMessage } from '@/lib/auth/messages';
import type { ReauthRequest } from '@/lib/auth/types';

type Method = 'password' | 'code';

/** Problem code of `DELETE /v1/auth/mfa` while the tenant enforces MFA for the user. */
export const MFA_REQUIRED_BY_POLICY = 'mfa-required-by-policy';
/** Problem code of a wrong re-authentication value (always 403, never 401). */
export const REAUTH_FAILED = 'reauth-failed';

export interface ReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** What the action changes (impact list, warning): shown above the re-authentication form. */
  details?: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  /** Calls the API with the proof. Resolve to close it (the caller does so); throw an `ApiError` to show it. */
  onSubmit: (reauth: ReauthRequest) => Promise<void>;
  /** The API answered `403 mfa-required-by-policy`: the dialog explains and offers only Close. */
  onPolicyBlocked?: () => void;
  /** Heading and text of the policy explanation. */
  policyTitle: string;
  policyBody: string;
}

/**
 * Re-authentication before a sensitive MFA action: the current password OR a current authenticator
 * code (tabs), with the server's `403 reauth-failed` shown on the field and `403
 * mfa-required-by-policy` explained instead of the form.
 */
export function ReauthDialog({ open, onOpenChange, ...rest }: ReauthDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <ReauthForm {...rest} />
      </DialogContent>
    </Dialog>
  );
}

function ReauthForm({
  title,
  description,
  details,
  confirmLabel,
  confirmVariant = 'primary',
  onSubmit,
  onPolicyBlocked,
  policyTitle,
  policyBody,
}: Omit<ReauthDialogProps, 'open' | 'onOpenChange'>) {
  const t = useT();
  const [method, setMethod] = useState<Method>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<{ message: string; requestId?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const changeMethod = (next: string) => {
    setMethod(next === 'code' ? 'code' : 'password');
    setFieldError(undefined);
    setFormError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = code.replace(/\s+/g, '');
    if (method === 'password' ? !password : !cleaned) {
      setFieldError(
        method === 'password'
          ? t('security.reauthPasswordRequired')
          : t('security.reauthCodeRequired'),
      );
      (method === 'password' ? passwordRef : codeRef).current?.focus();
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      await onSubmit(method === 'password' ? { password } : { totp_code: cleaned });
    } catch (err) {
      const ui = toUiError(err);
      if (errorCode(err) === MFA_REQUIRED_BY_POLICY) {
        setBlocked(true);
        onPolicyBlocked?.();
      } else if (errorCode(err) === REAUTH_FAILED) {
        setFieldError(
          method === 'password' ? t('security.reauthPasswordWrong') : t('security.reauthCodeWrong'),
        );
        if (method === 'password') passwordRef.current?.select();
        else codeRef.current?.select();
      } else if (isStatus(err, 429)) {
        setFormError({ message: tooManyAttemptsMessage(err, t), requestId: ui.requestId });
      } else {
        setFormError({ message: t(ui.messageKey), requestId: ui.requestId });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (blocked) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        <Banner tone="warning" title={policyTitle}>
          {policyBody}
        </Banner>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="primary">{t('security.mfaPolicyAck')}</Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {details}
      <Tabs value={method} onValueChange={changeMethod}>
        <p className="mb-2 text-base font-medium text-text" id="reauth-method">
          {t('security.reauthMethod')}
        </p>
        <TabsList aria-labelledby="reauth-method">
          <TabsTrigger value="password">{t('security.reauthPassword')}</TabsTrigger>
          <TabsTrigger value="code">{t('security.reauthCode')}</TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <PasswordField
            label={t('security.reauthPasswordLabel')}
            name="reauth-password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            error={method === 'password' ? fieldError : undefined}
            inputRef={passwordRef}
          />
        </TabsContent>
        <TabsContent value="code">
          <Field
            label={t('security.reauthCodeLabel')}
            required
            error={method === 'code' ? fieldError : undefined}
          >
            {(control) => (
              <Input
                ref={codeRef}
                name="reauth-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                spellCheck={false}
                className="font-tag tracking-widest"
                {...control}
              />
            )}
          </Field>
        </TabsContent>
      </Tabs>
      <FormError message={formError?.message} requestId={formError?.requestId} />
      <DialogFooter>
        <DialogClose asChild>
          <Button>{t('security.reauthCancel')}</Button>
        </DialogClose>
        <Button type="submit" variant={confirmVariant} loading={submitting}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
