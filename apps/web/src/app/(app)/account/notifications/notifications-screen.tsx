'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import {
  EMAIL_MODES,
  notificationsApi,
  type EmailMode,
  type NotificationPreference,
} from '@/lib/notifications/api';

interface Edit {
  in_app?: boolean;
  email?: EmailMode;
}

/**
 * Notification preferences (M2-NOT-02): for each notification type, whether it shows in the bell
 * and whether it is e-mailed right away, in a daily summary or not at all. Changes are collected
 * and saved together (one `PUT /v1/notification-preferences/{type}` per changed type).
 */
export function NotificationSettingsScreen() {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [saving, setSaving] = useState(false);

  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsApi.preferences(),
    retry: false,
  });
  const rows = useMemo(() => prefs.data ?? [], [prefs.data]);
  const current = (pref: NotificationPreference) => ({
    in_app: edits[pref.type]?.in_app ?? pref.in_app,
    email: edits[pref.type]?.email ?? pref.email,
  });
  const changed = rows.filter((pref) => {
    const now = current(pref);
    return now.in_app !== pref.in_app || now.email !== pref.email;
  });

  const save = async () => {
    setSaving(true);
    try {
      const results = await Promise.allSettled(
        changed.map((pref) => notificationsApi.savePreference(pref.type, current(pref))),
      );
      const failed = results.find((result) => result.status === 'rejected');
      // keep the edits of the types that failed, so they can be tried again
      setEdits((existing) =>
        Object.fromEntries(
          changed.flatMap((pref, index) =>
            results[index]?.status === 'rejected' ? [[pref.type, existing[pref.type]!]] : [],
          ),
        ),
      );
      await client.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
      if (failed && failed.status === 'rejected') {
        const ui = getApi().toUiError(failed.reason);
        toast({
          variant: 'danger',
          title: t('notifications.settings.saveFailed'),
          description: uiErrorText(t, ui),
          requestId: ui.requestId,
        });
      } else {
        toast({ variant: 'success', title: t('notifications.settings.saved') });
      }
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
              <table className="w-full min-w-[36rem] text-left text-base">
                <caption className="sr-only">{t('notifications.settings.table')}</caption>
                <thead>
                  <tr className="border-b border-border text-sm text-muted">
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t('notifications.settings.event')}
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t('notifications.settings.inApp')}
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      {t('notifications.settings.email')}
                    </th>
                  </tr>
                </thead>
                <tbody data-density="comfortable">
                  {rows.map((pref) => {
                    const now = current(pref);
                    return (
                      <tr key={pref.type} className="border-b border-border last:border-b-0">
                        <th scope="row" className="px-4 py-2 font-normal">
                          <span className="block font-medium">{pref.label}</span>
                          <span className="block text-sm text-muted">{pref.description}</span>
                        </th>
                        <td className="px-4 py-2">
                          <Checkbox
                            aria-label={t('notifications.settings.inAppNamed', {
                              event: pref.label,
                            })}
                            checked={now.in_app}
                            onCheckedChange={(value) =>
                              setEdits((existing) => ({
                                ...existing,
                                [pref.type]: { ...existing[pref.type], in_app: value === true },
                              }))
                            }
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Select
                            size="sm"
                            variant="ghost"
                            className="-ml-2"
                            aria-label={t('notifications.settings.emailNamed', {
                              event: pref.label,
                            })}
                            value={now.email}
                            onValueChange={(value) =>
                              setEdits((existing) => ({
                                ...existing,
                                [pref.type]: { ...existing[pref.type], email: value as EmailMode },
                              }))
                            }
                            options={EMAIL_MODES.map((mode) => ({
                              value: mode,
                              label: t(`notifications.email.${mode}`),
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
              <Button
                variant="primary"
                disabled={changed.length === 0}
                loading={saving}
                onClick={() => void save()}
              >
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
