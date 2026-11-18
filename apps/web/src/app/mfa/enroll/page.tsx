import { Suspense } from 'react';
import { EnrolScreen } from './enrol-screen';

/** `?next=` is read with `useSearchParams`, which needs a Suspense boundary in a static export. */
export default function MfaEnrolPage() {
  return (
    <Suspense fallback={null}>
      <EnrolScreen />
    </Suspense>
  );
}
