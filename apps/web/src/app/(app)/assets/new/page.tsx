import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetFormScreen } from '../asset-form-screen';

/** Fixed path with a query string (ADR-0002); `useSearchParams` needs Suspense in a static export. */
export default function NewAssetPage() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <AssetFormScreen kind="new" />
    </Suspense>
  );
}
