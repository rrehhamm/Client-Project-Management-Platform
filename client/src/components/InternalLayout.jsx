// Frame for the internal app. Navigation shows only pages the role can use.
import { LogOut, UserRound } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout, useMe } from '@/api/auth';
import { useWorkspace } from '@/api/workspace';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

const navClass = ({ isActive }) =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
  );

export function InternalLayout() {
  const { data: me } = useMe();
  const workspace = useWorkspace(); // logo (D-17)
  const logout = useLogout();
  const navigate = useNavigate();
  const caps = me.capabilities;

  const items = [
    { to: '/', label: t('nav.dashboard'), end: true, show: true },
    { to: '/my-tasks', label: t('nav.myTasks'), show: caps.my_tasks },
    { to: '/clients', label: t('nav.clients'), show: caps.view_clients },
    { to: '/projects', label: t('nav.projects'), show: caps.list_projects },
    { to: '/templates', label: t('nav.templates'), show: caps.list_templates },
    { to: '/team', label: t('nav.team'), show: caps.manage_team },
    { to: '/settings', label: t('nav.settings'), show: caps.manage_workspace },
  ].filter((i) => i.show);

  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        {t('app.skipToContent')}
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            {workspace.data?.logo_url ? <img src={workspace.data.logo_url} alt="" className="h-7 w-auto max-w-24 object-contain" /> : null}
            {me.workspace.name}
          </span>
          <nav aria-label={t('nav.mainNavigation')} className="flex flex-1 flex-wrap gap-1">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={navClass}>
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <NavLink to="/account" className={navClass} aria-label={t('nav.signedInAs', { name: me.principal.full_name })}>
              <span className="flex items-center gap-2">
                <UserRound aria-hidden="true" className="size-4" />
                <span className="max-w-40 truncate">{me.principal.full_name}</span>
              </span>
            </NavLink>
            <Button variant="ghost" size="sm" onClick={signOut} disabled={logout.isPending}>
              <LogOut aria-hidden="true" />
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
