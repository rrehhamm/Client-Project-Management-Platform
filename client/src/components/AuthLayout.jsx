// Frame for sign-in pages: centred card, usable at 360 px (NFR-RESP-01).
import { Outlet } from 'react-router';
import { t } from '@/i18n';

export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-soft via-background to-background px-4 py-10">
      <p className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-card">
          {t('app.name').slice(0, 1)}
        </span>
        {t('app.name')}
      </p>
      <main id="main" className="w-full max-w-sm">
        <Outlet />
      </main>
    </div>
  );
}

/** Card with a heading, used by each auth page. */
export function AuthCard({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border bg-card p-6 shadow-overlay sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-6">{children}</div>
    </div>
  );
}
