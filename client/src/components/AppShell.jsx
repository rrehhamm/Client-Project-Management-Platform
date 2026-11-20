// Page frame. Phase 1 adds role-based navigation and the signed-in user menu.
import { Link, Outlet } from 'react-router';
import { t } from '@/i18n';

export function AppShell() {
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4">
          <Link to="/" className="font-semibold tracking-tight">
            {t('app.name')}
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
