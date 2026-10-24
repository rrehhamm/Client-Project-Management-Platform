// Frame for the client portal: the client's own name, no internal navigation.
// Workspace branding (logo, colour) is applied in Phase 5 (FR-PORT-07).
import { LogOut, UserRound } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout, useMe } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function PortalLayout() {
  const { data: me } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="font-semibold tracking-tight">{me.workspace.name}</p>
            <p className="text-xs text-muted-foreground">
              {t('app.portalName')} · {me.principal.client.name}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <NavLink to="/portal/account" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent">
              <UserRound aria-hidden="true" className="size-4" />
              <span className="max-w-32 truncate">{me.principal.full_name}</span>
            </NavLink>
            <Button variant="ghost" size="sm" onClick={signOut} disabled={logout.isPending}>
              <LogOut aria-hidden="true" />
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
