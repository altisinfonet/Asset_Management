import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { RepairsScreen } from './repairs-screen';

/** `useSearchParams` (the open repair) needs a Suspense boundary in a static export. */
export default function RepairsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <RepairsScreen />
    </Suspense>
  );
}
