import { SETTINGS_SECTIONS, type SettingsSection } from '@/lib/routes';
import { SettingsSectionScreen } from '../settings-section';

// A finite, build-time-known set: prerendered with generateStaticParams, anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return SETTINGS_SECTIONS.map((section) => ({ section }));
}

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return <SettingsSectionScreen section={section as SettingsSection} />;
}
