'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import {
  DELIVERIES,
  eventLabelKey,
  notificationsApi,
  type Delivery,
  type NotificationPreference,
} from '@/lib/notifications/api';

/**
 * Notification preferences (M2-NOT-02): for each kind of event, whether the user hears about it
 * right away, in a daily summary, or not at all. Changes are collected and saved together.
 */
export function NotificationSettingsScreen() {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Delivery>>({});
  const [saving, setSaving] = useState(false);

  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsApi.preferences(),
    retry: false,
  });
  const rows = useMemo(() => prefs.data ?? [], [prefs.data]);
  const current = (pref: NotificationPreference): Delivery => edits[pref.event_type] ?? pref.delivery;
  const changed = rows.filter((pref) => current(pref) !== pref.delivery);

  const save = async () => {
    setSaving(true);
    try {
      await notificationsApi.savePreferences(
        changed.map((pref) => ({ event_type: pref.event_type, delivery: current(pref) })),
      );
      setEdits({});
      await client.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
      toast({ variant: 'success', title: t('notifications.settings.saved') });
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({
        variant: 'danger',
        title: t('notifications.settings.saveFailed'),
        description: uiErrorText(t, ui),
        requestId: ui.requestId,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageTitle title={t('notifications.settings.title')} />
      <PageHeader
        title={t('notifications.settings.title')}
        description={t('notifications.settings.description')}
      />
      <div className="flex max-w-3xl flex-col gap-4">
        {prefs.isLoading ? (
          <div role="status" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <span className="sr-only">{t('common.loading')}</span>
          </div>
        ) : null}
        {prefs.error ? (
          <Banner
            tone="danger"
            action={<Button onClick={() => void prefs.refetch()}>{t('common.retry')}</Button>}
          >
            {t('notifications.settings.loadFailed')}
          </Banner>
        ) : null}
        {prefs.isSuccess && rows.length === 0 ? (
          <p className="text-base text-muted">{t('notifications.settings.none')}</p>
        ) : null}
        {rows.length > 0 ? (
          <>
            <p className="text-base text-muted">{t('notifications.settings.hint')}</p>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[28rem] text-left text-base">
                <caption className="sr-only">{t('notifications.settings.table')}</caption>
                <thead>
                  <tr className="border-b border-border text-sm text-muted">
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t('notifications.settings.event')}
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t('notifications.settings.delivery')}
                    </th>
                  </tr>
                </thead>
                <tbody data-density="comfortable">
                  {rows.map((pref) => {
                    const key = eventLabelKey(pref.event_type);
                    const name = key ? t(key) : pref.event_type;
                    return (
                      <tr key={pref.event_type} className="border-b border-border last:border-b-0">
                        <th scope="row" className="px-4 py-2 font-normal">
                          {name}
                        </th>
                        <td className="px-4 py-2">
                          <Select
                            size="sm"
                            variant="ghost"
                            className="-ml-2"
                            aria-label={t('notifications.settings.deliveryNamed', { event: name })}
                            value={current(pref)}
                            onValueChange={(value) =>
                              setEdits((existing) => ({ ...existing, [pref.event_type]: value as Delivery }))
                            }
                            options={DELIVERIES.map((delivery) => ({
                              value: delivery,
                              label: t(`notifications.delivery.${delivery}`),
                            }))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={changed.length === 0} loading={saving} onClick={() => void save()}>
                {t('notifications.settings.save')}
              </Button>
              {changed.length > 0 ? (
                <span role="status" className="text-sm text-muted">
                  {t('notifications.settings.unsaved')}
                </span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
