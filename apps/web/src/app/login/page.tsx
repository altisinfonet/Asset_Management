import { Suspense } from 'react';
import { LoginScreen } from './login-screen';

/** `useSearchParams` (`next`, `reason`) needs a Suspense boundary in a static export. */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
