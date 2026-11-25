'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { FormDialog } from '@/components/registry/form-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { usersApi } from '@/lib/registry/api';
import type { RegistryUser, Role } from '@/lib/registry/types';
import {
  accessValues,
  assignmentsFrom,
  useAccessFields,
  useAssignmentLabel,
  type Assignment,
} from './user-access';

/**
 * The access of a login (M2-LOC-03, ED-26, ED-27): its role assignments, each for the whole
 * organisation or limited to a location. An administrator adds one assignment (role plus where it
 * applies) and removes one at a time, after a confirmation that says what happens. The API enforces
 * every rule (nobody grants wider than they hold, the last assignment and the last administrator
 * stay); a refusal is shown in the dialog that asked.
 */
export function AccessDialog({
  user,
  roles,
  onClose,
}: {
  user: RegistryUser | null;
  roles: Role[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const { label: assignmentLabel } = useAssignmentLabel(roles);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  // one assignment: the pointers of the API's problems start at the body (`/location_id`)
  const fields = useAccessFields(roles, 1, [], () => '');
  const refresh = () => client.invalidateQueries({ queryKey: ['users'] });
  const assignments = user?.role_assignments ?? [];
  const onlyOne = assignments.length <= 1;
  const name = user?.display_name ?? '';

  return (
    <>
      <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{t('locationScope.editTitle', { name })}</DialogTitle>
            <DialogDescription>{t('locationScope.editDescription')}</DialogDescription>
          </DialogHeader>
          <ul aria-label={t('locationScope.current', { name })} className="divide-y divide-border">
            {assignments.map((a) => (
              <li
                key={a.id ?? `${a.role_id}-${a.location_id ?? ''}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  {assignmentLabel(a)}
                  {a.scope_type === 'location' ? null : (
                    <span className="text-sm text-muted">
                      {' '}
                      · {t('locationScope.wholeOrganisation')}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  disabled={onlyOne || !a.id}
                  aria-describedby={onlyOne ? 'access-only-one' : undefined}
                  aria-label={t('locationScope.removeLabel', { access: assignmentLabel(a) })}
                  onClick={() => setRemoving(a)}
                >
                  {t('locationScope.remove')}
                </Button>
              </li>
            ))}
          </ul>
          {onlyOne ? (
            <p id="access-only-one" className="text-sm text-muted">
              {t('locationScope.onlyOne')}
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={onClose}>{t('common.close')}</Button>
            <Button variant="primary" onClick={() => setAdding(true)}>
              {t('locationScope.addAccess')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormDialog
        open={adding && user !== null}
        onOpenChange={setAdding}
        title={t('locationScope.addTitle', { name })}
        description={t('locationScope.addDescription')}
        fields={fields}
        initial={accessValues([])}
        submitLabel={t('locationScope.addAccess')}
        onSubmit={async (values) => {
          if (!user) return;
          const [assignment] = assignmentsFrom(values, 1);
          await usersApi.addRoleAssignment(user.id, assignment!);
          await refresh();
          toast({ variant: 'success', title: t('locationScope.added', { name }) });
        }}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('locationScope.removeTitle')}
        description={t('locationScope.removeDescription', {
          name,
          access: removing ? assignmentLabel(removing) : '',
        })}
        confirmLabel={t('locationScope.remove')}
        destructive
        onConfirm={async () => {
          if (!user || !removing?.id) return;
          await usersApi.removeRoleAssignment(user.id, removing.id);
          await refresh();
          toast({ variant: 'success', title: t('locationScope.removed', { name }) });
        }}
      />
    </>
  );
}
