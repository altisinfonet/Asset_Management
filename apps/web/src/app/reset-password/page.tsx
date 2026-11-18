import { Suspense } from 'react';
import { ResetPasswordScreen } from './reset-password-screen';

/** `?token=` is read with `useSearchParams`, which needs a Suspense boundary in a static export. */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordScreen />
    </Suspense>
  );
}
