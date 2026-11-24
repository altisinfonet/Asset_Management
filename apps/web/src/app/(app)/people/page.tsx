import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { PeopleScreen } from './people-screen';

export default function PeoplePage() {
  // `useSearchParams` (the department deep link) needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <PeopleScreen />
    </Suspense>
  );
}
