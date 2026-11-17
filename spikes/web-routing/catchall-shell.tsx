'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';

export function Shell() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  return (
    <main>
      <h1>Catch-all shell</h1>
      <p data-testid="pathname">{pathname}</p>
      <p data-testid="params">{JSON.stringify(params)}</p>
      <Link href="/spike/assets/abc-123" data-testid="link-abc">
        link abc
      </Link>
      <Link href="/spike/assets/xyz-789" data-testid="link-xyz">
        link xyz
      </Link>
      <button data-testid="push" onClick={() => router.push('/spike/assets/pushed-1')}>
        push
      </button>
    </main>
  );
}
