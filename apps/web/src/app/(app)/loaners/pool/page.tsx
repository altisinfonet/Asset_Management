import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { PoolView } from './pool-view';

/** `useSearchParams` (the pool and its filter) needs a Suspense boundary in a static export. */
export default function LoanerPoolPage() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <PoolView />
    </Suspense>
  );
}
