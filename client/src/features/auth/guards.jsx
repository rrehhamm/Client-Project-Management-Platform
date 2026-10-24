// Route guards. They decide what to SHOW; the API decides what is ALLOWED.
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { meKey, useMe } from '@/api/auth';
import { authEvents } from '@/api/client';
import { ErrorState, LoadingState, UnauthorizedState } from '@/components/StateViews';
import { loginPathFor } from '@/lib/navigation';
import { markSessionExpired } from './sessionFlag';

/** When a refresh fails mid-session, forget the principal so guards send the user to login. */
export function SessionExpiryListener() {
  const qc = useQueryClient();
  useEffect(() => {
    const onExpired = () => {
      markSessionExpired();
      qc.setQueryData(meKey, null);
    };
    authEvents.addEventListener('session-expired', onExpired);
    return () => authEvents.removeEventListener('session-expired', onExpired);
  }, [qc]);
  return null;
}

function FullPageLoading() {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <LoadingState rows={3} />
    </div>
  );
}

/**
 * Signed-in area for one kind of principal ("user" = internal app, "contact" = portal).
 * Signed out → /login?next=… (FR-AUTH-04). Wrong kind → that kind's home.
 */
export function RequireSession({ kind }) {
  const { data: me, isPending, error, refetch } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageLoading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!me) return <Navigate to={loginPathFor(location)} replace />;
  if (me.principal.kind !== kind) return <Navigate to={me.home} replace />;
  return <Outlet />;
}

/** Login and similar pages: a signed-in visitor goes home instead. */
export function PublicOnly() {
  const { data: me, isPending } = useMe();
  if (isPending) return <FullPageLoading />;
  if (me) return <Navigate to={me.home} replace />;
  return <Outlet />;
}

/** Shows the page only when /auth/me reports the capability (UI hint; the API enforces). */
export function RequireCapability({ capability, children }) {
  const { data: me } = useMe();
  if (!me?.capabilities?.[capability]) return <UnauthorizedState />;
  return children;
}
