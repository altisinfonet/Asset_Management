'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type ReactNode, type Ref } from 'react';
import { IconButton } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';

export interface PasswordFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  error?: ReactNode;
  hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  name?: string;
}

/**
 * Password input with a show/hide toggle. Paste is never blocked (WCAG 3.3.8, accessible
 * authentication), and `autocomplete` is set so password managers can fill and save it.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  inputRef,
  name,
}: PasswordFieldProps) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} hint={hint} required>
      {(control) => (
        <div className="relative">
          <Input
            ref={inputRef}
            name={name}
            type={visible ? 'text' : 'password'}
            autoComplete={autoComplete}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="pr-11"
            {...control}
          />
          <IconButton
            icon={visible ? EyeOff : Eye}
            label={visible ? t('login.hidePassword') : t('login.showPassword')}
            size="icon-sm"
            className="absolute top-1 right-1"
            onClick={() => setVisible((v) => !v)}
            aria-pressed={visible}
          />
        </div>
      )}
    </Field>
  );
}
