import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonView } from './person-view';

/** `useSearchParams` needs a Suspense boundary in a static export; the fallback is what is prerendered. */
export default function PersonViewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <PersonView />
    </Suspense>
  );
}
