import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { JobScreen } from './job-screen';

/** `useSearchParams` (the import and its step) needs a Suspense boundary in a static export. */
export default function ImportJobPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <JobScreen />
    </Suspense>
  );
}
