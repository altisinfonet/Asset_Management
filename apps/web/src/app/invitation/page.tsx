import { Suspense } from 'react';
import { InvitationScreen } from './invitation-screen';

/** `?token=` is read with `useSearchParams`, which needs a Suspense boundary in a static export. */
export default function InvitationPage() {
  return (
    <Suspense fallback={null}>
      <InvitationScreen />
    </Suspense>
  );
}
