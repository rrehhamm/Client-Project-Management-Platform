// Frame for the client portal (FR-PORT-07): the workspace's logo and colour, the
// client's name, no vendor branding. Everything inside talks to /portal (D-40).
import { LogOut, UserRound } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout, useMe } from '@/api/auth';
import { usePortalBranding } from '@/api/portal';
import { useThemeSync } from '@/components/ThemeSync';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { t } from '@/i18n';
import { ApiScopeContext } from '@/lib/apiScope';
import { cn } from '@/lib/utils';

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;
const navClass = ({ isActive }) => cn('rounded-md px-3 py-2 text-sm font-medium hover:bg-accent', isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground');

export function PortalLayout() {
  const { data: me } = useMe();
  const brand = usePortalBranding().data;
  useThemeSync(me); // D-45: own appearance and the agency's colour
  const logout = useLogout();
  const navigate = useNavigate();
  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  const color = SAFE_COLOR.test(brand?.workspace.brand_color ?? '') ? brand.workspace.brand_color : undefined;

  return (
    <ApiScopeContext.Provider value="/portal">
      <div className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
          {t('app.skipToContent')}
        </a>
        <header className="border-b" style={color ? { borderTop: `4px solid ${color}` } : undefined}>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <div className="flex items-center gap-3">
              {brand?.workspace.logo_url ? <img src={brand.workspace.logo_url} alt="" className="h-8 w-auto max-w-28 object-contain" /> : null}
              <div>
                <p className="font-semibold tracking-tight">{brand?.workspace.name ?? me.workspace.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('app.portalName')} · {me.principal.client.name}
                </p>
              </div>
            </div>
            <nav aria-label={t('nav.mainNavigation')} className="flex flex-1 flex-wrap gap-1">
              <NavLink to="/portal" end className={navClass}>
                {t('portal.nav.home')}
              </NavLink>
              <NavLink to="/portal/approvals" className={navClass}>
                {t('portal.nav.approvals')}
              </NavLink>
            </nav>
            <div className="flex items-center gap-1">
              <NotificationBell />
              <NavLink to="/portal/account" className={navClass} aria-label={t('nav.signedInAs', { name: me.principal.full_name })}>
                <span className="flex items-center gap-2">
                  <UserRound aria-hidden="true" className="size-4" />
                  <span className="max-w-32 truncate">{me.principal.full_name}</span>
                </span>
              </NavLink>
              <Button variant="ghost" size="sm" onClick={signOut} disabled={logout.isPending}>
                <LogOut aria-hidden="true" />
                {t('nav.signOut')}
              </Button>
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-8">
          <Outlet />
        </main>
      </div>
    </ApiScopeContext.Provider>
  );
}
