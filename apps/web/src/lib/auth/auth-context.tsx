'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toUiError, type UiError } from '@/lib/api';
import { authApi } from './auth-api';
import { setCsrfToken } from './http';
import { hasAnyPermission } from './permissions';
import { onMfaEnrolmentRequired, onUnauthorized } from './session-events';
import type { Me } from './types';

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; me: Me }
  /** No valid session. `reason` says why the user is signed out (shown on the login screen). */
  | { status: 'anonymous'; reason?: 'expired' | 'signed_out' }
  /** A session exists but the tenant requires MFA and the user has not enrolled yet. */
  | { status: 'mfa_enrolment_required' }
  /** The session bootstrap failed for a reason other than 401 (network, server). */
  | { status: 'error'; error: UiError };

/**
 * Problem code of the `403` that every endpoint except `/v1/auth/me`, logout and enrolment
 * returns while a required MFA enrolment is pending. `GET /v1/auth/me` itself answers 200 with
 * `mfa_enrolment_required: true`.
 */
export const MFA_ENROLMENT_REQUIRED = 'mfa-enrolment-required';

export interface AuthContextValue {
  state: AuthState;
  me: Me | undefined;
  /** True when the principal holds one of the permissions (always false while not signed in). */
  can: (permission: string | readonly string[] | undefined) => boolean;
  /** Re-run the `/v1/auth/me` bootstrap (after login, MFA or enrolment). */
  refresh: () => Promise<AuthState>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  state: { status: 'loading' },
  me: undefined,
  can: () => false,
  refresh: async () => ({ status: 'loading' }),
  signOut: async () => {},
});

async function bootstrap(): Promise<AuthState> {
  try {
    const me = await authApi.getMe();
    // A limited session: /me answers 200 so the client learns its CSRF token, but nothing else
    // works until enrolment is done. Reloading the page must land here, not on the dashboard.
    if (me.mfa_enrolment_required) return { status: 'mfa_enrolment_required' };
    return { status: 'authenticated', me };
  } catch (err) {
    const error = toUiError(err);
    if (error.kind === 'unauthorized') return { status: 'anonymous' };
    if (error.kind === 'forbidden' && error.code === MFA_ENROLMENT_REQUIRED) {
      return { status: 'mfa_enrolment_required' };
    }
    return { status: 'error', error };
  }
}

/**
 * Client-side auth state. The session itself is an `HttpOnly` cookie set by the API; the app
 * only knows who it is through `GET /v1/auth/me`, called once on load and after sign-in. Any
 * later `401` (idle timeout, revoked session) flips the state to `anonymous` so the route guard
 * sends the user to the login screen with a "session ended" notice.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    const next = await bootstrap();
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void bootstrap().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onUnauthorized(() =>
        setState((current) =>
          current.status === 'authenticated' || current.status === 'mfa_enrolment_required'
            ? { status: 'anonymous', reason: 'expired' }
            : current,
        ),
      ),
    [],
  );

  // Any other endpoint answering  means the session is limited.
  useEffect(
    () =>
      onMfaEnrolmentRequired(() =>
        setState((current) =>
          current.status === 'authenticated' ? { status: 'mfa_enrolment_required' } : current,
        ),
      ),
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The session may already be gone (401) or the network down; either way this browser
      // forgets the principal and the user lands on the login screen.
    }
    setCsrfToken(undefined);
    setState({ status: 'anonymous', reason: 'signed_out' });
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const me = state.status === 'authenticated' ? state.me : undefined;
    return {
      state,
      me,
      can: (permission) => (me ? hasAnyPermission(me.permissions, permission) : false),
      refresh,
      signOut,
    };
  }, [state, refresh, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
