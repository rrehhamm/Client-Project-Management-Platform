// Frame for the internal app (D-45): a sidebar with icon and label per section (only the
// pages the role can use), collapsible on desktop and a drawer below 768 px; a slim top bar
// for search and notifications. Logical CSS (start/end) so it mirrors for RTL later.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Building2,
  FolderKanban,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useLogout, useMe } from '@/api/auth';
import { useWorkspace } from '@/api/workspace';
import { useThemeSync } from '@/components/ThemeSync';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { SearchBox } from '@/features/search/SearchBox';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

const SIDEBAR_KEY = 'cpm.sidebar';
const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar';

const navClass =
  (collapsed) =>
  ({ isActive }) =>
    cn(
      'relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
      focusRing,
      collapsed && 'justify-center px-0',
      isActive
        ? 'bg-brand-soft font-semibold text-brand-text before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-brand-text'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function Brand({ me, logoUrl, collapsed }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', collapsed && 'justify-center')}>
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-7 w-auto max-w-24 shrink-0 object-contain" />
      ) : (
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          {initials(me.workspace.name).slice(0, 1)}
        </span>
      )}
      <span className={cn('truncate text-sm font-semibold tracking-tight', collapsed && 'sr-only')}>{me.workspace.name}</span>
    </span>
  );
}

function SidebarBody({ me, collapsed, onNavigate, onSignOut, signingOut }) {
  const caps = me.capabilities;
  const main = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, end: true, show: true },
    { to: '/my-tasks', label: t('nav.myTasks'), icon: ListChecks, show: caps.my_tasks },
    { to: '/clients', label: t('nav.clients'), icon: Building2, show: caps.view_clients },
    { to: '/projects', label: t('nav.projects'), icon: FolderKanban, show: caps.list_projects },
    { to: '/templates', label: t('nav.templates'), icon: LayoutTemplate, show: caps.list_templates },
  ].filter((i) => i.show);
  const admin = [
    { to: '/team', label: t('nav.team'), icon: Users, show: caps.manage_team },
    { to: '/settings', label: t('nav.settings'), icon: Settings, show: caps.manage_workspace },
    { to: '/audit', label: t('nav.audit'), icon: ScrollText, show: caps.view_audit },
  ].filter((i) => i.show);
  const link = (i) => (
    <NavLink key={i.to} to={i.to} end={i.end} className={navClass(collapsed)} title={collapsed ? i.label : undefined} onClick={onNavigate}>
      <i.icon aria-hidden="true" />
      <span className={cn(collapsed && 'sr-only')}>{i.label}</span>
    </NavLink>
  );

  return (
    <>
      <nav aria-label={t('nav.mainNavigation')} className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {main.map(link)}
        {admin.length ? (
          <>
            <p className={cn('px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', collapsed && 'sr-only')}>{t('nav.workspaceSection')}</p>
            {collapsed ? <div aria-hidden="true" className="mx-2 my-3 border-t" /> : null}
            {admin.map(link)}
          </>
        ) : null}
      </nav>
      <div className="space-y-0.5 border-t p-3">
        <NavLink
          to="/account"
          className={navClass(collapsed)}
          aria-label={t('nav.signedInAs', { name: me.principal.full_name })}
          title={collapsed ? me.principal.full_name : undefined}
          onClick={onNavigate}
        >
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
            {initials(me.principal.full_name)}
          </span>
          <span className={cn('min-w-0 truncate', collapsed && 'sr-only')}>{me.principal.full_name}</span>
        </NavLink>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          title={collapsed ? t('nav.signOut') : undefined}
          className={cn(navClass(collapsed)({ isActive: false }), 'w-full cursor-pointer disabled:opacity-50')}
        >
          <LogOut aria-hidden="true" />
          <span className={cn(collapsed && 'sr-only')}>{t('nav.signOut')}</span>
        </button>
      </div>
    </>
  );
}

export function InternalLayout() {
  const { data: me } = useMe();
  const workspace = useWorkspace(); // logo (D-17)
  const logout = useLogout();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  useThemeSync(me);

  const logoUrl = workspace.data?.logo_url;
  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded');
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  };
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-overlay"
      >
        {t('app.skipToContent')}
      </a>

      {/* Desktop sidebar */}
      <aside className={cn('fixed inset-y-0 start-0 z-30 hidden flex-col border-e bg-sidebar transition-[width] duration-200 md:flex', collapsed ? 'w-16' : 'w-60')}>
        <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b px-4', collapsed && 'justify-center px-2')}>
          {collapsed ? null : <Brand me={me} logoUrl={logoUrl} />}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            aria-expanded={!collapsed}
            title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            className={cn('cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground', focusRing, !collapsed && 'ms-auto')}
          >
            <CollapseIcon aria-hidden="true" className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
        <SidebarBody me={me} collapsed={collapsed} onSignOut={signOut} signingOut={logout.isPending} />
      </aside>

      {/* Mobile drawer */}
      <DialogPrimitive.Root open={drawer} onOpenChange={setDrawer}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay md:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col border-e bg-sidebar shadow-overlay outline-none md:hidden"
          >
            <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
              <DialogPrimitive.Title asChild>
                <div className="min-w-0 flex-1">
                  <Brand me={me} logoUrl={logoUrl} />
                </div>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label={t('nav.closeMenu')}
                className={cn('cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground', focusRing)}
              >
                <X aria-hidden="true" className="size-4" />
              </DialogPrimitive.Close>
            </div>
            <SidebarBody me={me} collapsed={false} onNavigate={() => setDrawer(false)} onSignOut={signOut} signingOut={logout.isPending} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'md:ps-16' : 'md:ps-60')}>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={t('nav.openMenu')}
            aria-expanded={drawer}
            className={cn('-ms-1.5 cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden', focusRing)}
          >
            <Menu aria-hidden="true" className="size-5" />
          </button>
          <span className="min-w-0 truncate text-sm font-semibold md:hidden">{me.workspace.name}</span>
          <div className="ms-auto flex min-w-0 items-center gap-2 md:ms-0 md:flex-1">
            {me.capabilities.search ? (
              <div className="hidden min-w-0 max-w-md flex-1 sm:block">
                <SearchBox />
              </div>
            ) : null}
            {me.capabilities.search ? (
              <Link
                to="/search"
                aria-label={t('nav.search')}
                className={cn('cursor-pointer rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground sm:hidden', focusRing)}
              >
                <Search aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
            <div className="sm:ms-auto">
              <NotificationBell />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
