export const dynamicParams = false;

const sections = ['categories', 'models', 'fields', 'status', 'locations', 'users'] as const;

export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return (
    <main>
      <h1>Settings</h1>
      <p data-testid="settings-section">{section}</p>
    </main>
  );
}
