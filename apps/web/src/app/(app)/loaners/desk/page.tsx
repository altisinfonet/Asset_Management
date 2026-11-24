import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { DeskScreen } from './desk-screen';

/** `useSearchParams` (the mode) needs a Suspense boundary in a static export. */
export default function LoanerDeskPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <DeskScreen />
    </Suspense>
  );
}
