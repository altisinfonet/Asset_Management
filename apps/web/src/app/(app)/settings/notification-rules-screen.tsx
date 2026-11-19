'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageTitle } from '@/components/page-title';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useI18n } from '@/i18n';
import { getApi } from '@/lib/api';
import { uiErrorText } from '@/lib/error-text';
import { notificationsApi, type NotificationRule } from '@/lib/notifications/api';

/**
 * The notification rules of the organisation (M2-NOT-01, `notification:manage`): every type with
 * who gets it by default, and a switch that turns the type off for everybody. A change is saved
 * as soon as it is made. Choosing other recipient roles is not offered here yet.
 */
export function NotificationRulesScreen() {
  const { t } = useI18n();
  const { toast } = useToast();
  const client = useQueryClient();
  const [saving, setSaving] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ['notifications', 'rules'],
    queryFn: () => notificationsApi.rules(),
    retry: false,
  });

  const toggle = async (rule: NotificationRule, enabled: boolean) => {
    setSaving(rule.type);
    try {
      await notificationsApi.saveRule(rule.type, { enabled });
      await client.invalidateQueries({ queryKey: ['notifications', 'rules'] });
      toast({
        variant: 'success',
        title: enabled
          ? t('notifications.rules.turnedOn', { name: rule.label })
          : t('notifications.rules.turnedOff', { name: rule.label }),
      });
    } catch (err) {
      const ui = getApi().toUiError(err);
      toast({
        variant: 'danger',
        title: t('notifications.rules.saveFailed'),
        description: uiErrorText(t, ui),
        requestId: ui.requestId,
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <PageTitle title={t('notifications.rules.title')} />
      <PageHeader
        title={t('notifications.rules.title')}
        description={t('notifications.rules.description')}
      />
      <div className="flex max-w-4xl flex-col gap-4">
        {rules.isLoading ? (
          <div role="status" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <span className="sr-only">{t('common.loading')}</span>
          </div>
        ) : null}
        {rules.error ? (
          <Banner
            tone="danger"
            action={<Button onClick={() => void rules.refetch()}>{t('common.retry')}</Button>}
          >
            {t('notifications.rules.loadFailed')}
          </Banner>
        ) : null}
        {rules.data && rules.data.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[40rem] text-left text-base">
              <caption className="sr-only">{t('notifications.rules.table')}</caption>
              <thead>
                <tr className="border-b border-border text-sm text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('notifications.rules.type')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('notifications.rules.recipients')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('notifications.rules.enabled')}
                  </th>
                </tr>
              </thead>
              <tbody data-density="comfortable">
                {rules.data.map((rule) => (
                  <tr key={rule.type} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-2 font-normal">
                      <span className="block font-medium">{rule.label}</span>
                      <span className="block text-sm text-muted">{rule.description}</span>
                    </th>
                    <td className="px-4 py-2">
                      {rule.recipient_roles
                        ? t('notifications.rules.roles', { roles: rule.recipient_roles.join(', ') })
                        : rule.recipients}
                    </td>
                    <td className="px-4 py-2">
                      <Checkbox
                        aria-label={t('notifications.rules.enabledNamed', { name: rule.label })}
                        checked={rule.enabled}
                        disabled={saving === rule.type}
                        onCheckedChange={(value) => void toggle(rule, value === true)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  );
}
