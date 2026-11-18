'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthCard } from '@/components/auth/auth-layout';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { authApi } from '@/lib/auth/auth-api';
import {
  errorCode,
  isStatus,
  tooManyAttemptsMessage,
  type DescribedError,
} from '@/lib/auth/messages';
import { toUiError } from '@/lib/api';
import type { MfaMethod } from '@/lib/auth/types';

/** Problem code of a 401 on `POST /v1/auth/mfa/verify` when the pending challenge timed out. PROPOSED. */
const CHALLENGE_EXPIRED = 'mfa-challenge-expired';

/**
 * MFA challenge (WEB-01 step 2): a 6-digit TOTP code, or a single-use recovery code. The code
 * field takes paste (WCAG 3.3.8), is announced with its label, and gets focus on each switch.
 */
export function MfaChallenge({
  challengeId,
  methods,
  onVerified,
  onExpired,
  onBack,
}: {
  challengeId: string;
  methods: MfaMethod[];
  onVerified: () => Promise<void>;
  onExpired: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [method, setMethod] = useState<'totp' | 'recovery_code'>('totp');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<DescribedError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canUseRecovery = methods.includes('recovery_code');
  const recovery = method === 'recovery_code';

  useEffect(() => {
    inputRef.current?.focus();
  }, [method]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = recovery ? code.trim() : code.replace(/\s+/g, '');
    if (!cleaned) {
      setFieldError(t('login.mfa.codeRequired'));
      inputRef.current?.focus();
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      const response = await authApi.verifyMfa({
        challenge_id: challengeId,
        method,
        code: cleaned,
      });
      if (response.status !== 'authenticated') throw new Error('unexpected MFA response');
      await onVerified();
    } catch (err) {
      setSubmitting(false);
      if (isStatus(err, 401) && errorCode(err) === CHALLENGE_EXPIRED) {
        onExpired();
      } else if (isStatus(err, 401)) {
        setFormError({
          message: t(recovery ? 'login.mfa.invalidRecovery' : 'login.mfa.invalidCode'),
        });
        inputRef.current?.select();
      } else if (isStatus(err, 429)) {
        setFormError({ message: tooManyAttemptsMessage(err, t) });
      } else {
        const ui = toUiError(err);
        setFormError({ message: t(ui.messageKey), requestId: ui.requestId });
      }
    }
  };

  return (
    <AuthCard
      title={recovery ? t('login.mfa.recoveryTitle') : t('login.mfa.title')}
      description={recovery ? t('login.mfa.recoveryDescription') : t('login.mfa.description')}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label={recovery ? t('login.mfa.recoveryCode') : t('login.mfa.code')}
          required
          error={fieldError}
        >
          {(control) => (
            <Input
              ref={inputRef}
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              spellCheck={false}
              autoCapitalize="off"
              className="font-tag tracking-widest"
              {...control}
            />
          )}
        </Field>
        <FormError message={formError?.message} requestId={formError?.requestId} />
        <Button type="submit" variant="primary" loading={submitting}>
          {t('login.mfa.verify')}
        </Button>
        {canUseRecovery ? (
          <Button
            variant="link"
            className="self-start"
            onClick={() => {
              setMethod(recovery ? 'totp' : 'recovery_code');
              setCode('');
              setFieldError(undefined);
              setFormError(null);
            }}
          >
            {recovery ? t('login.mfa.useAuthenticator') : t('login.mfa.useRecovery')}
          </Button>
        ) : null}
        <Button variant="link" className="self-start" onClick={onBack}>
          {t('login.mfa.back')}
        </Button>
      </form>
    </AuthCard>
  );
}
