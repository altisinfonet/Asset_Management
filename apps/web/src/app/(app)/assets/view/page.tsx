import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetView } from './asset-view';

/** `useSearchParams` needs a Suspense boundary in a static export; the fallback is what is prerendered. */
export default function AssetViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <AssetView />
    </Suspense>
  );
}
