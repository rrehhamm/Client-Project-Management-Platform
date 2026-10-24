// Temporary home page for Phase 0: shows whether the API and its services are up.
import { CheckCircle2, XCircle } from 'lucide-react';
import { useReadiness } from '@/api/health';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';

const CHECK_ORDER = ['database', 'storage', 'mail'];

export function SystemStatusPage() {
  const { data, error, isPending, refetch } = useReadiness();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('system.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('system.subtitle')}</p>
      </div>

      <Card>
        {isPending ? (
          <CardContent>
            <LoadingState rows={3} />
          </CardContent>
        ) : error ? (
          <CardContent>
            <ErrorState error={error} onRetry={() => refetch()} />
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle data-testid="overall-status">
                {data.status === 'ok' ? t('system.allOk') : t('system.degraded')}
              </CardTitle>
              <CardDescription>/api/v1/health/ready</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {CHECK_ORDER.map((name) => {
                  const ok = data.checks?.[name] === 'ok';
                  return (
                    <li key={name} className="flex items-center justify-between py-3 text-sm">
                      <span>{t(`system.checks.${name}`)}</span>
                      {/* Status is shown by icon AND text, never colour alone (NFR-A11Y-01) */}
                      <span className={ok ? 'flex items-center gap-1.5 text-success' : 'flex items-center gap-1.5 text-destructive'}>
                        {ok ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <XCircle aria-hidden="true" className="size-4" />}
                        {ok ? t('system.ok') : t('system.down')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
