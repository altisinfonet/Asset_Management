import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { StockScreen } from './stock-screen';

/** `useSearchParams` (the tab) needs a Suspense boundary in a static export. */
export default function StockPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <StockScreen />
    </Suspense>
  );
}
