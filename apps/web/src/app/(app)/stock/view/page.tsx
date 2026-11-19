import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { StockView } from './stock-view';

/** `useSearchParams` needs a Suspense boundary in a static export; the fallback is what is prerendered. */
export default function StockViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <StockView />
    </Suspense>
  );
}
