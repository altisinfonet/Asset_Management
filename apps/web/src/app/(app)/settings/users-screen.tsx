'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { FormDialog } from '@/components/registry/form-dialog';
import { LinkPersonDialog, UnlinkDialog } from '@/components/registry/login-link-dialogs';
import { SectionHeader } from '@/components/registry/section-header';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button, IconButton } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { fetchAll, peopleApi, usersApi } from '@/lib/registry/api';
import { useRoles } from '@/lib/registry/queries';
import type { Person, RegistryUser, Role, SessionInfo } from '@/lib/registry/types';
import { routes } from '@/lib/routes';
import { uiErrorText } from '@/lib/error-text';
import { AccessDialog } from './access-dialog';
import {
  accessValues,
  assignmentsFrom,
  useAccessFields,
  useAssignmentLabel,
  type Assignment,
} from './user-access';

const USERS_KEY = ['users'] as const;

/** Users, pending invitations and roles (WEB-23). Every control is also enforced by the API. */
export function UsersScreen() {
  const { t } = useI18n();
  const { can } = useAuth();
  const manage = can('user:manage');
  const [inviting, setInviting] = useState(false);
  const roles = useRoles();
  const users = useQuery({
    queryKey: [...USERS_KEY, 'all'],
    queryFn: () =>
      fetchAll<RegistryUser>((cursor) =>
        usersApi.list({ limit: 200, cursor, sort: ['display_name'], include_total: false }),
      ),
  });

  // the people that have a login (their number is the number of logins): names the Person column
  const persons = useQuery({
    queryKey: ['person-logins', 'all'],
    queryFn: () =>
      fetchAll<Person>((cursor) =>
        peopleApi.list({ limit: 200, cursor, has_login: true, sort: ['display_name'] }),
      ),
    enabled: can('person:read'),
  });
  const personOfLogin = useMemo(
    () =>
      new Map((persons.data ?? []).flatMap((p) => (p.user_id ? [[p.user_id, p] as const] : []))),
    [persons.data],
  );

  const { label: assignmentLabel } = useAssignmentLabel(roles.data ?? []);
  // every assignment, with where a scoped one applies ("Technician at Room 101")
  const roleName = (user: RegistryUser) => user.role_assignments.map(assignmentLabel).join(', ');
  // pending logins are listed on the Users tab too (badge "Pending"), so they can be linked and given access
  const active = users.data ?? [];
  const pending = (users.data ?? []).filter((u) => u.status === 'invited');

  return (
    <>
      <SectionHeader
        section="users"
        title={t('settings.sections.users')}
        description={t('users.description')}
        actions={
          manage ? (
            <Button variant="primary" onClick={() => setInviting(true)}>
              <UserPlus aria-hidden className="size-4" />
              {t('users.invite')}
            </Button>
          ) : null
        }
      />
      {!manage ? (
        <Banner tone="info" className="mb-4">
          {t('users.readOnly')}
        </Banner>
      ) : null}
      {users.error ? (
        <Banner tone="danger">{t('common.loadFailed')}</Banner>
      ) : (
        <Tabs defaultValue="users">
          <TabsList aria-label={t('users.tabsLabel')}>
            <TabsTrigger value="users" count={active.length}>
              {t('users.tabs.users')}
            </TabsTrigger>
            <TabsTrigger value="invitations" count={pending.length}>
              {t('users.tabs.invitations')}
            </TabsTrigger>
            <TabsTrigger value="roles">{t('users.tabs.roles')}</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <UsersTable
              users={active}
              roles={roles.data ?? []}
              loading={users.isLoading}
              manage={manage}
              personOfLogin={personOfLogin}
            />
          </TabsContent>
          <TabsContent value="invitations">
            <InvitationsTable
              users={pending}
              roleName={roleName}
              loading={users.isLoading}
              manage={manage}
            />
          </TabsContent>
          <TabsContent value="roles">
            {/* M2-LOC-03: scoping is per role assignment, not a property of the role */}
            <Banner tone="info" className="mb-4">
              {t('locationScope.rolesNote')}
            </Banner>
            <RolesTable roles={roles.data ?? []} loading={roles.isLoading} />
          </TabsContent>
        </Tabs>
      )}
      <InviteDialog open={inviting} onOpenChange={setInviting} roles={roles.data ?? []} />
    </>
  );
}

function useRefreshUsers() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: USERS_KEY });
}

function UsersTable({
  users,
  roles,
  loading,
  manage,
  personOfLogin,
}: {
  users: RegistryUser[];
  roles: Role[];
  loading: boolean;
  manage: boolean;
  /** The person each login account belongs to (by `user_id`). */
  personOfLogin: ReadonlyMap<string, Person>;
}) {
  const { t, formatDateTime } = useI18n();
  const { me } = useAuth();
  const { toast } = useToast();
  const refresh = useRefreshUsers();
  const [mfaReset, setMfaReset] = useState<RegistryUser | null>(null);
  const [sessionsOf, setSessionsOf] = useState<RegistryUser | null>(null);
  const [renaming, setRenaming] = useState<RegistryUser | null>(null);
  const [linking, setLinking] = useState<RegistryUser | null>(null);
  const [unlinking, setUnlinking] = useState<RegistryUser | null>(null);
  // the dialog follows the live row, so an added or removed assignment shows at once
  const [accessId, setAccessId] = useState<string | null>(null);
  const { resend, askRevoke, revokeDialog } = useInvitationActions();
  const { label: assignmentLabel, where } = useAssignmentLabel(roles);

  const fail = (err: unknown) => {
    const ui = getApi().toUiError(err);
    toast({ variant: 'danger', title: uiErrorText(t, ui), requestId: ui.requestId });
  };

  const changeRole = async (user: RegistryUser, roleId: string) => {
    try {
      // the first assignment gets the new role and keeps where it applies (M2-LOC-03)
      const [first, ...rest] = user.role_assignments;
      const keep = ({ role_id, scope_type, company_id, location_id }: Assignment) => ({
        role_id,
        scope_type,
        ...(company_id ? { company_id } : {}),
        ...(location_id ? { location_id } : {}),
      });
      await usersApi.update(user.id, {
        role_assignments: [
          first ? { ...keep(first), role_id: roleId } : { role_id: roleId, scope_type: 'tenant' },
          ...rest.map(keep),
        ],
      });
      await refresh();
      toast({ variant: 'success', title: t('users.roleChanged', { name: user.display_name }) });
    } catch (err) {
      fail(err);
      await refresh();
    }
  };

  const setStatus = async (user: RegistryUser, status: 'active' | 'disabled') => {
    try {
      await usersApi.update(user.id, { status });
      await refresh();
      toast({
        variant: 'success',
        title: t(status === 'disabled' ? 'users.deactivated' : 'users.reactivated', {
          name: user.display_name,
        }),
      });
    } catch (err) {
      fail(err);
    }
  };

  const columns = useMemo<DataTableColumn<RegistryUser>[]>(
    () => [
      { id: 'name', header: t('users.columns.name'), cell: (u) => u.display_name },
      { id: 'email', header: t('users.columns.email'), cell: (u) => u.email },
      {
        id: 'person',
        header: t('loginLink.personColumn'),
        cell: (u) => {
          const person = personOfLogin.get(u.id);
          return person ? (
            <Link
              href={routes.personView(person.id)}
              className="rounded-sm text-primary-text underline underline-offset-2"
            >
              {person.display_name}
            </Link>
          ) : (
            <span className="text-muted">{t('loginLink.noPerson')}</span>
          );
        },
      },
      {
        id: 'role',
        header: t('users.columns.role'),
        cell: (u) => {
          const [first, ...rest] = u.role_assignments;
          const place = first ? where(first) : '';
          return (
            <div className="flex flex-col items-start">
              <span className="flex flex-wrap items-center gap-x-1">
                <Select
                  aria-label={t('users.roleOf', { name: u.display_name })}
                  value={first?.role_id}
                  disabled={!manage || u.status === 'disabled'}
                  onValueChange={(roleId) => void changeRole(u, roleId)}
                  options={roles.map((r) => ({ value: r.id, label: r.name }))}
                  size="sm"
                  variant="ghost"
                  className="-ml-2 min-w-40"
                />
                {place ? (
                  <span className="text-sm text-muted" data-testid="role-scope">
                    {place}
                  </span>
                ) : null}
              </span>
              {rest.map((a, i) => (
                <span key={a.id ?? i} className="text-sm text-muted">
                  {assignmentLabel(a)}
                </span>
              ))}
            </div>
          );
        },
      },
      {
        id: 'status',
        header: t('users.columns.status'),
        cell: (u) =>
          u.status === 'disabled' ? (
            <Badge tone="neutral">{t('users.status.disabled')}</Badge>
          ) : u.status === 'invited' ? (
            <Badge tone="info">{t('users.status.pending')}</Badge>
          ) : (
            <Badge tone="success">{t('users.status.active')}</Badge>
          ),
      },
      {
        id: 'mfa',
        header: t('users.columns.mfa'),
        cell: (u) => (u.mfa_enabled ? t('common.on') : t('common.off')),
      },
      {
        id: 'last',
        header: t('users.columns.lastActive'),
        cell: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : t('users.never')),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        srOnlyHeader: true,
        align: 'end',
        cell: (u) =>
          manage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={MoreHorizontal}
                  label={t('users.actionsFor', { name: u.display_name })}
                  size="icon-sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(u)}>
                  {t('users.actions.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAccessId(u.id)}>
                  {t('locationScope.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setLinking(u)}>
                  {t('loginLink.linkPerson')}
                </DropdownMenuItem>
                {personOfLogin.has(u.id) ? (
                  <DropdownMenuItem onSelect={() => setUnlinking(u)}>
                    {t('loginLink.unlinkPerson')}
                  </DropdownMenuItem>
                ) : null}
                {u.status === 'invited' ? (
                  <>
                    <DropdownMenuItem onSelect={() => void resend(u)}>
                      {t('users.actions.resendInvitation')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => askRevoke(u)}>
                      {t('users.actions.revokeInvitation')}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={() => setSessionsOf(u)}>
                    {t('users.actions.sessions')}
                  </DropdownMenuItem>
                )}
                {u.mfa_enabled && u.id !== me?.user.id ? (
                  <DropdownMenuItem onSelect={() => setMfaReset(u)}>
                    {t('users.actions.resetMfa')}
                  </DropdownMenuItem>
                ) : null}
                {u.id === me?.user.id || u.status === 'invited' ? null : u.status === 'disabled' ? (
                  <DropdownMenuItem onSelect={() => void setStatus(u, 'active')}>
                    {t('users.actions.reactivate')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => void setStatus(u, 'disabled')}>
                    {t('users.actions.deactivate')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    // The handlers close over current toast/refresh; the table only needs to re-render with data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, roles, manage, me?.user.id, formatDateTime, personOfLogin, where, assignmentLabel],
  );

  return (
    <>
      <DataTable
        label={t('users.tableLabel')}
        columns={columns}
        rows={users}
        getRowId={(u) => u.id}
        loading={loading}
        empty={
          <EmptyState
            icon={Users}
            title={t('users.emptyTitle')}
            description={t('users.emptyDescription')}
          />
        }
      />
      <ConfirmDialog
        open={mfaReset !== null}
        onOpenChange={(open) => !open && setMfaReset(null)}
        title={t('users.resetMfaTitle', { name: mfaReset?.display_name ?? '' })}
        description={t('users.resetMfaDescription')}
        confirmLabel={t('users.actions.resetMfa')}
        destructive
        onConfirm={async () => {
          if (!mfaReset) return;
          await usersApi.resetMfa(mfaReset.id);
          await refresh();
          toast({
            variant: 'success',
            title: t('users.mfaReset', { name: mfaReset.display_name }),
          });
        }}
      />
      <FormDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={t('users.renameTitle')}
        fields={[
          {
            name: 'display_name',
            label: t('users.form.displayName'),
            kind: 'text',
            required: true,
          },
        ]}
        initial={{ display_name: renaming?.display_name ?? '' }}
        submitLabel={t('common.save')}
        onSubmit={async (values) => {
          if (!renaming) return;
          await usersApi.update(renaming.id, { display_name: String(values.display_name).trim() });
          await refresh();
        }}
      />
      <LinkPersonDialog
        open={linking !== null}
        onOpenChange={(open) => !open && setLinking(null)}
        login={{
          id: linking?.id ?? '',
          display_name: linking?.display_name ?? '',
          email: linking?.email ?? '',
        }}
        onDone={async (person) => {
          toast({
            variant: 'success',
            title: t('loginLink.linked', {
              person: person.display_name,
              login: linking?.email ?? '',
            }),
          });
        }}
      />
      <UnlinkDialog
        open={unlinking !== null}
        onOpenChange={(open) => !open && setUnlinking(null)}
        person={{
          id: (unlinking && personOfLogin.get(unlinking.id)?.id) || '',
          display_name: (unlinking && personOfLogin.get(unlinking.id)?.display_name) || '',
        }}
        loginLabel={unlinking?.email}
        onDone={async () => {
          toast({
            variant: 'success',
            title: t('loginLink.unlinked', {
              person: (unlinking && personOfLogin.get(unlinking.id)?.display_name) || '',
            }),
          });
        }}
      />
      <SessionsDialog user={sessionsOf} onClose={() => setSessionsOf(null)} />
      {revokeDialog}
      <AccessDialog
        key={accessId ?? 'access'}
        user={users.find((u) => u.id === accessId) ?? null}
        roles={roles}
        onClose={() => setAccessId(null)}
      />
    </>
  );
}

function SessionsDialog({ user, onClose }: { user: RegistryUser | null; onClose: () => void }) {
  const { t, formatDateTime } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const key = ['user-sessions', user?.id];
  const sessions = useQuery({
    queryKey: key,
    queryFn: () => usersApi.sessions(user!.id),
    enabled: !!user,
  });
  const revoke = async (session: SessionInfo) => {
    try {
      await usersApi.revokeSession(user!.id, session.id);
      await client.invalidateQueries({ queryKey: key });
      toast({ variant: 'success', title: t('users.sessionRevoked') });
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({ variant: 'danger', title: t(ui.messageKey), requestId: ui.requestId });
    }
  };
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('users.sessionsTitle', { name: user?.display_name ?? '' })}</DialogTitle>
          <DialogDescription>{t('users.sessionsDescription')}</DialogDescription>
        </DialogHeader>
        {sessions.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (sessions.data ?? []).length === 0 ? (
          <p className="text-base text-muted">{t('users.noSessions')}</p>
        ) : (
          <ul
            aria-label={t('users.sessionsTitle', { name: user?.display_name ?? '' })}
            className="divide-y divide-border"
          >
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span>{s.user_agent ?? t('users.unknownDevice')}</span>
                  <span className="text-sm text-muted">
                    {s.ip ?? ''} · {t('users.lastSeen', { when: formatDateTime(s.last_seen_at) })}
                  </span>
                </span>
                <Button
                  size="sm"
                  aria-label={t('users.revokeSessionLabel', { device: s.user_agent ?? s.id })}
                  onClick={() => void revoke(s)}
                >
                  {t('users.revokeSession')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Resend and revoke an invitation (ED-27): the same two actions on the Pending invitations tab and
 * on a pending login of the Users tab. `revokeDialog` must be rendered by the caller.
 */
function useInvitationActions() {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useRefreshUsers();
  const [revoking, setRevoking] = useState<RegistryUser | null>(null);

  const resend = async (user: RegistryUser) => {
    try {
      await usersApi.resendInvitation(user.id);
      toast({ variant: 'success', title: t('users.invitationResent', { email: user.email }) });
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({ variant: 'danger', title: uiErrorText(t, ui), requestId: ui.requestId });
    }
  };

  const revokeDialog = (
    <ConfirmDialog
      open={revoking !== null}
      onOpenChange={(open) => !open && setRevoking(null)}
      title={t('users.revokeTitle', { email: revoking?.email ?? '' })}
      description={t('users.revokeDescription')}
      confirmLabel={t('users.revoke')}
      destructive
      onConfirm={async () => {
        if (!revoking) return;
        await usersApi.revokeInvitation(revoking.id);
        await refresh();
        toast({
          variant: 'success',
          title: t('users.invitationRevoked', { email: revoking.email }),
        });
      }}
    />
  );
  return { resend, askRevoke: setRevoking, revokeDialog };
}

function InvitationsTable({
  users,
  roleName,
  loading,
  manage,
}: {
  users: RegistryUser[];
  roleName: (user: RegistryUser) => string;
  loading: boolean;
  manage: boolean;
}) {
  const { t, formatDate } = useI18n();
  const { resend, askRevoke, revokeDialog } = useInvitationActions();

  const columns: DataTableColumn<RegistryUser>[] = [
    { id: 'name', header: t('users.columns.name'), cell: (u) => u.display_name },
    { id: 'email', header: t('users.columns.email'), cell: (u) => u.email },
    { id: 'role', header: t('users.columns.role'), cell: (u) => roleName(u) },
    {
      id: 'invited',
      header: t('users.columns.invited'),
      cell: (u) => (u.created_at ? formatDate(u.created_at) : ''),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      srOnlyHeader: true,
      align: 'end',
      cell: (u) =>
        manage ? (
          <span className="inline-flex gap-1">
            <Button
              size="sm"
              aria-label={t('users.resendLabel', { email: u.email })}
              onClick={() => void resend(u)}
            >
              {t('users.resend')}
            </Button>
            <Button
              size="sm"
              aria-label={t('users.revokeLabel', { email: u.email })}
              onClick={() => askRevoke(u)}
            >
              {t('users.revoke')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        label={t('users.invitationsLabel')}
        columns={columns}
        rows={users}
        getRowId={(u) => u.id}
        loading={loading}
        empty={
          <EmptyState
            icon={UserPlus}
            title={t('users.noInvitationsTitle')}
            description={t('users.noInvitationsDescription')}
          />
        }
      />
      {revokeDialog}
    </>
  );
}

function RolesTable({ roles, loading }: { roles: Role[]; loading: boolean }) {
  const { t } = useI18n();
  return (
    <DataTable
      label={t('users.rolesLabel')}
      columns={[
        { id: 'name', header: t('users.columns.role'), cell: (r) => r.name },
        {
          id: 'description',
          header: t('users.columns.description'),
          cell: (r) => r.description ?? '',
        },
        {
          id: 'permissions',
          header: t('users.columns.permissions'),
          cell: (r) =>
            r.permissions.includes('*') ? t('users.allPermissions') : r.permissions.join(', '),
        },
        {
          id: 'builtin',
          header: t('users.columns.type'),
          cell: (r) => (r.is_builtin ? t('users.builtIn') : t('users.custom')),
        },
      ]}
      rows={roles}
      getRowId={(r) => r.id}
      loading={loading}
    />
  );
}

function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useRefreshUsers();
  // one role assignment: the role and where it applies (M2-LOC-03)
  const access = useAccessFields(roles, 1);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('users.inviteTitle')}
      description={t('users.inviteDescription')}
      fields={[
        { name: 'display_name', label: t('users.form.displayName'), kind: 'text', required: true },
        { name: 'email', label: t('users.form.email'), kind: 'email', required: true },
        ...access,
      ]}
      initial={{
        display_name: '',
        email: '',
        ...accessValues([], roles.find((r) => r.key === 'viewer')?.id ?? ''),
      }}
      submitLabel={t('users.sendInvite')}
      onSubmit={async (values) => {
        const user = await usersApi.invite({
          email: String(values.email).trim(),
          display_name: String(values.display_name).trim(),
          role_assignments: assignmentsFrom(values, 1),
        });
        await refresh();
        toast({ variant: 'success', title: t('users.invited', { email: user.email }) });
      }}
    />
  );
}
