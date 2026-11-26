'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { FormError } from '@/components/auth/form-error';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { PersonPicker, type PersonRef } from '@/components/registry/person-picker';
import { UserPicker, type UserRef } from '@/components/registry/user-picker';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, type FieldControlProps } from '@/components/ui/field';
import { useT } from '@/i18n';
import { getApi, type UiError } from '@/lib/api';
import { peopleApi, usersApi } from '@/lib/registry/api';

/**
 * Link and unlink a person and a login account (M2-USR-03, ED-22). The dialogs say what happens
 * before anything does: the login's empty person record is archived, what the person holds and the
 * history stay. A refusal of the API (the person has a login, the login has a chosen person, the
 * placeholder still holds assets) is shown in place with its own sentence.
 */

/** Everything that shows a person, a login or their link is stale after a change. */
function useRefreshLinks() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ['person', 'people', 'people-picker', 'user-picker', 'users', 'person-logins'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

const refusalText = (error: UiError, fallback: string) => error.detail ?? fallback;

interface ShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  fieldLabel: string;
  picker: (control: FieldControlProps) => ReactNode;
  /** The sentence that states what will happen; shown once something is chosen. */
  impact: string | null;
  onConfirm: () => Promise<void>;
}

/** The dialog both directions share: one picker, the consequence, confirm. */
function LinkDialogShell({
  open,
  onOpenChange,
  title,
  description,
  fieldLabel,
  picker,
  impact,
  onConfirm,
}: ShellProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(getApi().toUiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field label={fieldLabel} required>
          {(control) => picker(control)}
        </Field>
        {impact ? <Banner tone="info">{impact}</Banner> : null}
        {error ? (
          <FormError
            message={refusalText(error, t(error.messageKey))}
            requestId={error.requestId}
          />
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={impact === null}
            onClick={() => void confirm()}
          >
            {t('loginLink.confirmLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface LinkLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: { id: string; display_name: string; etag?: string };
  onDone: (login: UserRef) => void | Promise<void>;
}

/** On the person page: choose the login account this person signs in with. */
export function LinkLoginDialog({ open, onOpenChange, person, onDone }: LinkLoginDialogProps) {
  const t = useT();
  const refresh = useRefreshLinks();
  const [login, setLogin] = useState<UserRef | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
    if (open) setLogin(null);
  }, [open]);

  return (
    <LinkDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('loginLink.linkTitle', { name: person.display_name })}
      description={t('loginLink.linkDescription')}
      fieldLabel={t('loginLink.loginLabel')}
      picker={(control) => <UserPicker {...control} autoFocus value={login} onChange={setLogin} />}
      impact={
        login ? t('loginLink.impact', { person: person.display_name, login: login.email }) : null
      }
      onConfirm={async () => {
        if (!login) return;
        await peopleApi.linkUser(person.id, login.id, person.etag);
        await refresh();
        await onDone(login);
      }}
    />
  );
}

export interface LinkPersonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  login: UserRef;
  onDone: (person: PersonRef) => void | Promise<void>;
}

/** On Settings -> Users: choose the person this login belongs to (only people without a login are offered). */
export function LinkPersonDialog({ open, onOpenChange, login, onDone }: LinkPersonDialogProps) {
  const t = useT();
  const refresh = useRefreshLinks();
  const [person, setPerson] = useState<PersonRef | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when (re)opened
    if (open) setPerson(null);
  }, [open]);

  return (
    <LinkDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('loginLink.linkPersonTitle', { name: login.display_name })}
      description={t('loginLink.linkPersonDescription')}
      fieldLabel={t('loginLink.personLabel')}
      picker={(control) => (
        <PersonPicker
          {...control}
          autoFocus
          includeInactive
          hasLogin={false}
          value={person}
          onChange={setPerson}
        />
      )}
      impact={
        person ? t('loginLink.impact', { person: person.display_name, login: login.email }) : null
      }
      onConfirm={async () => {
        if (!person) return;
        await peopleApi.linkUser(person.id, login.id);
        await refresh();
        await onDone(person);
      }}
    />
  );
}

export interface UnlinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: { id: string; display_name: string; etag?: string };
  /** The login's e-mail when known; the sentence falls back to "the login account". */
  loginLabel?: string | undefined;
  /** The login account being unlinked: after the unlink its new (empty) record is looked up. */
  userId?: string | null | undefined;
  /** `newPersonId`: the login's new automatic record, when it could be read (`GET /v1/users/{id}`). */
  onDone: (newPersonId?: string) => void | Promise<void>;
}

/** Confirmation of removing the login from a person (from either page). */
export function UnlinkDialog({
  open,
  onOpenChange,
  person,
  loginLabel,
  userId,
  onDone,
}: UnlinkDialogProps) {
  const t = useT();
  const refresh = useRefreshLinks();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('loginLink.unlinkTitle', { name: person.display_name })}
      description={t('loginLink.unlinkDescription', {
        name: person.display_name,
        login: loginLabel ?? t('loginLink.unlinkedLogin'),
      })}
      confirmLabel={t('loginLink.confirmUnlink')}
      destructive
      onConfirm={async () => {
        await peopleApi.unlinkUser(person.id, person.etag);
        await refresh();
        // the login moved to a new automatic record (ED-15): say where, so it does not look as if
        // the unlink failed (ED-33)
        const newPersonId = userId
          ? await usersApi
              .get(userId)
              .then((u) => u.value.person_id ?? undefined)
              .catch(() => undefined)
          : undefined;
        await onDone(newPersonId);
      }}
    >
      <p className="text-base text-muted">{t('loginLink.unlinkImpact')}</p>
    </ConfirmDialog>
  );
}
