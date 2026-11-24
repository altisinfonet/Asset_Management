'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  ClockAlert,
  CalendarPlus,
  Hourglass,
  Wrench,
  Pencil,
  Plus,
  Repeat,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ExtendLoanDialog, type ExtendTarget } from '@/components/loaners/extend-loan-dialog';
import { PoolFormDialog } from '@/components/loaners/pool-form-dialog';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { AssetPicker, type AssetRef } from '@/components/registry/asset-picker';
import { ConfirmDialog } from '@/components/registry/confirm-dialog';
import { useRunner } from '@/components/registry/use-runner';
import { ActionDialog } from '@/components/w2/action-dialog';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth/auth-context';
import { createKeyKeeper } from '@/lib/custody/helpers';
import { loanersApi, type LoanerPoolMember } from '@/lib/loaners/api';
import {
  daysBetween,
  isPoolShow,
  matchesShow,
  memberState,
  POOL_SHOW,
  todayUtc,
  type MemberState,
  type PoolShow,
} from '@/lib/loaners/helpers';
import { loanKeys, useRefreshAfterLoan } from '@/lib/loaners/queries';
import { custodyApi } from '@/lib/registry/api';
import { routes } from '@/lib/routes';

const MEMBER_PAGE = 200;
const MEMBER_LIMIT = 1000;

/** Every member of a pool (a pool is a few dozen devices; a hard cap keeps a runaway list bounded). */
async function loadMembers(id: string): Promise<LoanerPoolMember[]> {
  const all: LoanerPoolMember[] = [];
  let cursor: string | undefined;
  while (all.length < MEMBER_LIMIT) {
    const page = await loanersApi.members(id, {
      limit: MEMBER_PAGE,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.data);
    if (!page.page.has_more || !page.page.next_cursor) break;
    cursor = page.page.next_cursor;
  }
  return all;
}

const STATE_BADGE: Record<
  MemberState,
  { tone: 'success' | 'primary' | 'danger' | 'warning' | 'neutral'; icon: typeof Repeat }
> = {
  available: { tone: 'success', icon: Repeat },
  on_loan: { tone: 'primary', icon: ArrowUpRight },
  overdue: { tone: 'danger', icon: ClockAlert },
  due_today: { tone: 'warning', icon: Hourglass },
  unavailable: { tone: 'neutral', icon: Wrench },
};

/**
 * One loaner pool (M2-LOAN-04): its numbers, the devices in it with who has them and when they are
 * due (filter by available, on loan, overdue, due today), and for managers adding and removing
 * devices, editing and archiving the pool. A device that is out can be taken back from its row.
 */
export function PoolView() {
  const { t, formatDate, formatNumber } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const run = useRunner();
  const refresh = useRefreshAfterLoan();
  const id = params.get('id');
  const requested = params.get('show');
  const show: PoolShow = isPoolShow(requested) ? requested : 'all';
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [extending, setExtending] = useState<ExtendTarget | null>(null);
  const [version, setVersion] = useState(0);

  const pool = useQuery({
    queryKey: [...loanKeys.pool(id ?? ''), version],
    queryFn: () => loanersApi.pool(id!),
    enabled: !!id,
    retry: false,
  });
  const members = useQuery({
    queryKey: loanKeys.members(id ?? ''),
    queryFn: () => loadMembers(id!),
    enabled: !!id,
  });

  const now = useMemo(() => new Date(), []);
  const rows = useMemo(
    () =>
      (members.data ?? [])
        .map((member) => ({ member, state: memberState(member, now) }))
        .sort((a, b) =>
          (a.member.asset?.asset_tag ?? '').localeCompare(b.member.asset?.asset_tag ?? ''),
        ),
    [members.data, now],
  );
  const shown = rows.filter((row) => matchesShow(row.state, show));
  const day = (value: string) => formatDate(`${value}T00:00:00Z`, { timeZone: 'UTC' });
  const canManage = can('loaner:manage');

  if (!id) {
    return (
      <>
        <PageTitle title={t('loanerPools.title')} />
        <EmptyState icon={Repeat} title={t('loanerPool.missing')} />
      </>
    );
  }
  if (pool.isError) {
    return (
      <>
        <PageTitle title={t('loanerPools.title')} />
        <EmptyState
          icon={Repeat}
          title={t('loanerPool.notFound')}
          actions={
            <Button asChild>
              <Link href={routes.loanerPools}>{t('loanerPool.back')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const current = pool.data?.value;
  const counts = current
    ? {
        available: current.available_count,
        onLoan: current.checked_out_count,
        overdue: current.overdue_count,
        dueToday: current.due_today_count,
      }
    : null;

  const setShow = (next: PoolShow) =>
    router.replace(next === 'all' ? routes.loanerPool(id) : routes.loanerPool(id, next));

  const dueText = (member: LoanerPoolMember) => {
    const due = member.asset?.current_assignment?.expected_return;
    if (!due) return t('loanerPool.due.none');
    const delta = daysBetween(todayUtc(now), due);
    return delta >= 0
      ? delta === 0
        ? day(due)
        : `${day(due)} (${t('loanerPool.due.inDays', { count: delta })})`
      : `${day(due)} (${t('loanerPool.due.lateDays', { count: -delta })})`;
  };

  const returnDevice = async (member: LoanerPoolMember) => {
    const tag = member.asset?.asset_tag ?? '';
    const key = createKeyKeeper().keyFor({ asset: member.asset_id, checkin: true });
    await run(
      async () => {
        await custodyApi.checkin(member.asset_id, {}, { idempotencyKey: key });
        await refresh();
      },
      t('loanerPool.returned', { tag }),
    );
  };

  const columns: DataTableColumn<{ member: LoanerPoolMember; state: MemberState }>[] = [
    {
      id: 'device',
      header: t('loanerPool.columns.device'),
      sticky: true,
      cell: ({ member }) => (
        <span className="flex flex-col">
          <Link
            href={routes.assetView(member.asset_id)}
            className="rounded-sm font-tag text-primary-text underline underline-offset-2"
          >
            {member.asset?.asset_tag}
          </Link>
          {member.asset?.name ? (
            <span className="text-sm text-muted">{member.asset.name}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'state',
      header: t('loanerPool.columns.state'),
      cell: ({ state }) => (
        <Badge tone={STATE_BADGE[state].tone} icon={STATE_BADGE[state].icon}>
          {t(`loanerPool.state.${state}`)}
        </Badge>
      ),
    },
    {
      id: 'borrower',
      header: t('loanerPool.columns.borrower'),
      cell: ({ member }) => {
        const holder = member.asset?.current_assignment;
        if (!holder) return '-';
        return holder.target_type === 'person' ? (
          <Link
            href={routes.personView(holder.target_id)}
            className="rounded-sm text-primary-text underline underline-offset-2"
          >
            {holder.target_name}
          </Link>
        ) : (
          (holder.target_name ?? '-')
        );
      },
    },
    {
      id: 'due',
      header: t('loanerPool.columns.due'),
      cell: ({ member }) => (member.asset?.current_assignment ? dueText(member) : '-'),
    },
    {
      id: 'actions',
      header: t('loanerPool.columns.actions'),
      srOnlyHeader: true,
      align: 'end',
      cell: ({ member, state }) => {
        const tag = member.asset?.asset_tag ?? '';
        const out = state === 'on_loan' || state === 'overdue' || state === 'due_today';
        const loan = member.asset?.current_assignment;
        return (
          <span className="inline-flex gap-1.5">
            {out && can('asset:checkin') ? (
              <Button
                size="sm"
                aria-label={t('loanerPool.returnNamed', { tag })}
                onClick={() => void returnDevice(member)}
              >
                <Undo2 aria-hidden className="size-4" />
                {t('loanerPool.returnButton')}
              </Button>
            ) : null}
            {out && loan && can('loaner:checkout') ? (
              <Button
                size="sm"
                aria-label={t('loaners.extend.buttonNamed', { tag })}
                onClick={() =>
                  setExtending({
                    loanId: loan.assignment_id,
                    tag,
                    expectedReturn: loan.expected_return ?? '',
                  })
                }
              >
                <CalendarPlus aria-hidden className="size-4" />
                {t('loaners.extend.button')}
              </Button>
            ) : null}
            {canManage ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={out}
                title={out ? t('loanerPool.removeBlocked') : undefined}
                aria-label={t('loanerPool.removeNamed', { tag })}
                onClick={() =>
                  void run(
                    async () => {
                      await loanersApi.removeMember(id, member.asset_id);
                      await refresh();
                    },
                    t('loanerPool.removed', { tag }),
                  )
                }
              >
                {t('loanerPool.remove')}
              </Button>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageTitle title={current?.name ?? t('loanerPools.title')} />
      <PageHeader
        title={current?.name ?? <Skeleton className="h-7 w-64" />}
        description={current?.description ?? undefined}
        actions={
          <>
            {can('loaner:checkout') ? (
              <Button asChild variant="primary">
                <Link href={routes.loanerDesk()}>{t('loanerPool.lendHere')}</Link>
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button onClick={() => setAdding(true)}>
                  <Plus aria-hidden className="size-4" />
                  {t('loanerPool.add.button')}
                </Button>
                <Button onClick={() => setEditing(true)} disabled={!pool.data}>
                  <Pencil aria-hidden className="size-4" />
                  {t('loanerPool.edit')}
                </Button>
                <Button onClick={() => setArchiving(true)} disabled={!pool.data}>
                  {t('loanerPool.archive')}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <p className="-mt-2 mb-4">
        <Link
          href={routes.loanerPools}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-primary-text underline underline-offset-2"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          {t('loanerPool.back')}
        </Link>
      </p>

      {counts ? (
        <ul
          className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4"
          aria-label={t('loaners.totalsLabel')}
        >
          {(
            [
              ['available', counts.available],
              ['onLoan', counts.onLoan],
              ['overdue', counts.overdue],
              ['dueToday', counts.dueToday],
            ] as const
          ).map(([key, value]) => (
            <li
              key={key}
              className="flex flex-col rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="text-2xl font-semibold text-text tabular-nums">
                {formatNumber(value)}
              </span>
              <span className="text-sm text-muted">{t(`loaners.counts.${key}`)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Skeleton className="mb-4 h-16 w-full" />
      )}

      <div className="flex flex-col gap-3">
        <div
          role="group"
          aria-label={t('loanerPool.show.label')}
          className="flex flex-wrap gap-1.5"
        >
          {POOL_SHOW.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === show ? 'primary' : 'secondary'}
              aria-pressed={option === show}
              onClick={() => setShow(option)}
            >
              {t(`loanerPool.show.${option}`)}
            </Button>
          ))}
        </div>
        {members.isError ? (
          <Banner
            tone="danger"
            action={<Button onClick={() => void members.refetch()}>{t('common.retry')}</Button>}
          >
            {t('loanerPool.loadFailed')}
          </Banner>
        ) : null}
        <DataTable
          label={t('loanerPool.tableLabel', { name: current?.name ?? '' })}
          columns={columns}
          rows={shown}
          getRowId={(row) => row.member.asset_id}
          getRowLabel={(row) => row.member.asset?.asset_tag ?? ''}
          loading={members.isPending}
          empty={
            rows.length === 0 ? (
              <EmptyState
                icon={Repeat}
                title={t('loanerPool.empty.title')}
                description={t('loanerPool.empty.description')}
              />
            ) : (
              <EmptyState
                icon={Repeat}
                title={t('loanerPool.empty.noMatchTitle')}
                description={t('loanerPool.empty.noMatchDescription')}
              />
            )
          }
        />
        <p className="text-sm text-muted" data-testid="pool-range">
          {t('loanerPool.range', { count: shown.length, total: rows.length })}
        </p>
      </div>

      <AddDeviceDialog
        open={adding}
        onOpenChange={setAdding}
        poolId={id}
        poolName={current?.name ?? ''}
        onAdded={refresh}
      />
      <PoolFormDialog
        open={editing}
        onOpenChange={setEditing}
        pool={pool.data}
        onSaved={() => setVersion((n) => n + 1)}
      />
      <ExtendLoanDialog target={extending} onOpenChange={(open) => !open && setExtending(null)} />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t('loanerPool.archiveTitle', { name: current?.name ?? '' })}
        description={t('loanerPool.archiveDescription')}
        confirmLabel={t('loanerPool.archive')}
        destructive
        onConfirm={async () => {
          await loanersApi.archivePool(id, pool.data?.etag);
          await refresh();
          router.replace(routes.loanerPools);
        }}
      />
    </>
  );
}

function AddDeviceDialog({
  open,
  onOpenChange,
  poolId,
  poolName,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poolId: string;
  poolName: string;
  onAdded: () => Promise<void>;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [asset, setAsset] = useState<AssetRef | null>(null);
  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('loanerPool.add.title', { name: poolName })}
      submitLabel={t('loanerPool.add.submit')}
      onOpen={() => setAsset(null)}
      validate={() => {
        const errors: Record<string, string> = {};
        if (!asset) errors.asset = t('loanerPool.add.choose');
        return errors;
      }}
      onSubmit={async () => {
        await loanersApi.addMember(poolId, asset!.id);
        await onAdded();
        toast({
          variant: 'success',
          title: t('loanerPool.add.added', { tag: asset!.label.split(' - ')[0]! }),
        });
      }}
    >
      {({ errors }) => (
        <Field
          label={t('loanerPool.add.label')}
          hint={t('loanerPool.add.help')}
          error={errors.asset}
        >
          {(control) => (
            <AssetPicker
              {...control}
              value={asset}
              onChange={setAsset}
              invalid={!!errors.asset}
              aria-label={undefined}
            />
          )}
        </Field>
      )}
    </ActionDialog>
  );
}
