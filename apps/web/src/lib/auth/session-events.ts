/**
 * Tiny pub/sub so any API call that comes back `401` (outside the sign-in endpoints) can tell the
 * auth provider the session has ended, and a `403 mfa-enrolment-required` that the session is
 * limited, without every screen handling it.
 */
type Listener = () => void;

function channel() {
  const listeners = new Set<Listener>();
  return {
    on(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(): void {
      for (const listener of [...listeners]) listener();
    },
  };
}

const unauthorized = channel();
const enrolmentRequired = channel();

export const onUnauthorized = unauthorized.on;
export const reportUnauthorized = unauthorized.emit;

/** The tenant requires MFA and this session has not enrolled: everything but enrolment is 403. */
export const onMfaEnrolmentRequired = enrolmentRequired.on;
export const reportMfaEnrolmentRequired = enrolmentRequired.emit;
