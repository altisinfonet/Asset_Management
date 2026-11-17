import { ApiStatus } from './api-status';

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between border-b border-slate-300/40 pb-4">
        <h1 className="text-xl font-semibold">Asset Tracker</h1>
        <nav aria-label="Primary" className="text-sm opacity-70">
          Assets · Locations · Reports
        </nav>
      </header>
      <main className="flex flex-1 flex-col gap-4">
        <p className="opacity-80">
          App shell placeholder. Business screens arrive in later milestones.
        </p>
        <ApiStatus />
      </main>
    </div>
  );
}
