'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Circle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Banner } from '@/components/ui/banner';
import { Button, IconButton } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import {
  badgeCount,
  eventLabelKey,
  notificationHref,
  notificationsApi,
  type AppNotification,
} from '@/lib/notifications/api';
import { routes } from '@/lib/routes';

const COUNT_KEY = ['notifications', 'count'] as const;
const POLL_MS = 60_000;

/**
 * The bell of the top bar (M2-NOT-02): the unread count (read again every minute and when the
 * window regains focus) and the panel with the list, "mark as read" and "mark all as read". The
 * button's name carries the count, so a screen reader hears "Notifications, 3 unread". When the
 * server cannot answer, the bell stays quiet instead of showing a stale or made-up number.
 */
export function NotificationBell() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const count = useQuery({
    queryKey: COUNT_KEY,
    queryFn: () => notificationsApi.list({ unread: true, limit: 1 }),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 20_000,
  });
  const unread = count.data?.unread_count ?? 0;

  return (
    <>
      <span className="relative inline-flex">
        <IconButton
          icon={Bell}
          label={
            unread > 0 ? t('notifications.bellUnread', { count: unread }) : t('notifications.bell')
          }
          onClick={() => setOpen(true)}
          data-testid="notification-bell"
        />
        {unread > 0 ? (
          <span
            aria-hidden
            data-testid="notification-count"
            className="pointer-events-none absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-danger-on"
          >
            {badgeCount(unread)}
          </span>
        ) : null}
      </span>
      <NotificationsPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

function NotificationsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const router = useRouter();
  const [onlyUnread, setOnlyUnread] = useState(false);

  const list = useInfiniteQuery({
    queryKey: ['notifications', 'list', onlyUnread],
    queryFn: ({ pageParam }) =>
      notificationsApi.list({
        cursor: pageParam,
        limit: 20,
        ...(onlyUnread ? { unread: true } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.has_more ? (last.page.next_cursor ?? undefined) : undefined,
    enabled: open,
    retry: false,
  });
  const rows = list.data?.pages.flatMap((page) => page.data) ?? [];
  const unread = list.data?.pages[0]?.unread_count ?? 0;

  const refresh = () => client.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = async (notification: AppNotification) => {
    try {
      await notificationsApi.markRead(notification.id);
      await refresh();
    } catch {
      toast({ variant: 'danger', title: t('notifications.markFailed') });
    }
  };
  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      await refresh();
      toast({ variant: 'success', title: t('notifications.allMarked') });
    } catch {
      toast({ variant: 'danger', title: t('notifications.markFailed') });
    }
  };
  const view = async (notification: AppNotification, href: string) => {
    onOpenChange(false);
    if (!notification.read_at) await markRead(notification);
    router.push(href);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('notifications.panelTitle')}</DrawerTitle>
          <DrawerDescription>{t('notifications.panelDescription')}</DrawerDescription>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div
              role="group"
              aria-label={t('notifications.filterLabel')}
              className="inline-flex rounded-md border border-border-strong"
            >
              {([false, true] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={onlyUnread === value}
                  onClick={() => setOnlyUnread(value)}
                  className={cn(
                    'min-h-(--size-control-dense) px-3 text-sm font-medium first:rounded-l-md last:rounded-r-md',
                    onlyUnread === value
                      ? 'bg-primary-subtle text-primary-text'
                      : 'text-text hover:bg-sunken',
                  )}
                >
                  {value ? t('notifications.filterUnread') : t('notifications.filterAll')}
                </button>
              ))}
            </div>
            <Button size="sm" disabled={unread === 0} onClick={() => void markAll()}>
              <CheckCheck aria-hidden className="size-4" />
              {t('notifications.markAllRead')}
            </Button>
          </div>
        </DrawerHeader>
        <DrawerBody className="p-0">
          {list.isLoading ? (
            <div role="status" className="flex flex-col gap-2 p-4">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <span className="sr-only">{t('common.loading')}</span>
            </div>
          ) : null}
          {list.error ? (
            <div className="p-4">
              <Banner
                tone="danger"
                action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
              >
                {t('notifications.loadFailed')}
              </Banner>
            </div>
          ) : null}
          {list.isSuccess && rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
              <p className="text-lg font-semibold">
                {onlyUnread ? t('notifications.emptyUnread') : t('notifications.empty')}
              </p>
              <p className="text-base text-muted">{t('notifications.emptyHint')}</p>
            </div>
          ) : null}
          {rows.length > 0 ? (
            <ul className="divide-y divide-border" data-testid="notification-list">
              {rows.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => void markRead(notification)}
                  onView={(href) => void view(notification, href)}
                />
              ))}
            </ul>
          ) : null}
          {list.hasNextPage ? (
            <div className="p-4">
              <Button
                size="sm"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t('notifications.loadMore')}
              </Button>
            </div>
          ) : null}
        </DrawerBody>
        <DrawerFooter className="justify-start">
          <Button asChild variant="link">
            <Link href={routes.notificationSettings} onClick={() => onOpenChange(false)}>
              {t('notifications.settings.link')}
            </Link>
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
  onView,
}: {
  notification: AppNotification;
  onMarkRead: () => void;
  onView: (href: string) => void;
}) {
  const { t, formatDateTime } = useI18n();
  const unread = !notification.read_at;
  const href = notificationHref(notification);
  const eventKey = eventLabelKey(notification.event_type);
  return (
    <li
      className={cn('flex gap-3 p-4', unread && 'bg-primary-subtle/40')}
      data-unread={unread || undefined}
    >
      <span className="mt-1 shrink-0" aria-hidden>
        <Circle
          className={cn('size-3', unread ? 'fill-primary text-primary' : 'text-border-strong')}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-base">
          {unread ? <span className="sr-only">{t('notifications.unread')}: </span> : null}
          <span className={unread ? 'font-semibold' : undefined}>{notification.title}</span>
        </p>
        {notification.body ? <p className="text-sm text-muted">{notification.body}</p> : null}
        <p className="text-xs text-muted">
          {eventKey ? t(eventKey) : notification.event_type}
          {' · '}
          {formatDateTime(notification.created_at)}
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {href ? (
            <Button
              size="sm"
              aria-label={t('notifications.viewNamed', { title: notification.title })}
              onClick={() => onView(href)}
            >
              {t('notifications.view')}
            </Button>
          ) : null}
          {unread ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('notifications.markReadNamed', { title: notification.title })}
              onClick={onMarkRead}
            >
              {t('notifications.markRead')}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
