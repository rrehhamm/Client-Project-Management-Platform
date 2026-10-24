// Standard loading / empty / error / unauthorized views (FR-DASH-06).
// Every screen uses these so no page ever shows stale or zero numbers as real.
import { AlertTriangle, Inbox, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';

export function LoadingState({ rows = 3 }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('states.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function Message({ icon: Icon, title, body, children, role }) {
  return (
    <div role={role} className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <Icon aria-hidden="true" className="size-10 text-muted-foreground" />
      <h2 className="text-base font-semibold">{title}</h2>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {children}
    </div>
  );
}

export function EmptyState({ title = t('states.emptyTitle'), body, action }) {
  return (
    <Message icon={Inbox} title={title} body={body}>
      {action}
    </Message>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Message icon={AlertTriangle} title={t('states.errorTitle')} body={error?.message ?? t('states.errorBody')} role="alert">
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          {t('states.retry')}
        </Button>
      ) : null}
    </Message>
  );
}

export function UnauthorizedState() {
  return <Message icon={Lock} title={t('states.unauthorizedTitle')} body={t('states.unauthorizedBody')} role="alert" />;
}
