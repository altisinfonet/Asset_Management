import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { NewImportScreen } from './new-import-screen';

/** `useSearchParams` (the preselected data) needs a Suspense boundary in a static export. */
export default function NewImportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <NewImportScreen />
    </Suspense>
  );
}
