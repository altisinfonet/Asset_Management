import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { LocationsScreen } from './locations-screen';

/** `useSearchParams` (the selected location) needs a Suspense boundary in a static export. */
export default function LocationsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-8 w-64" />}>
      <LocationsScreen />
    </Suspense>
  );
}
