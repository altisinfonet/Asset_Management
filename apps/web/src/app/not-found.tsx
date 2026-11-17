'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const QR_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

export default function NotFound() {
  const pathname = usePathname();
  const router = useRouter();
  const match = QR_PATH.exec(pathname);
  const code = match?.[1];

  useEffect(() => {
    if (code) router.replace(`/assets/view?code=${encodeURIComponent(code)}`);
  }, [code, router]);

  if (code) return <p data-testid="resolving">Opening {code}...</p>;
  return (
    <main>
      <h1 data-testid="not-found">Page not found</h1>
    </main>
  );
}
