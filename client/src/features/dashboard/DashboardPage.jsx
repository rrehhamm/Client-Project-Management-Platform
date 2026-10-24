// Placeholder home for internal users. Real dashboards come in Phase 4 (FR-DASH-01…03).
import { Link } from 'react-router';
import { useMe } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';

export function DashboardPage() {
  const { data: me } = useMe();
  const { principal, capabilities } = me;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title', { name: principal.full_name })}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.subtitle', { role: t(`roles.${principal.role}`) })}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {capabilities.manage_team ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.teamCardTitle')}</CardTitle>
              <CardDescription>{t('dashboard.teamCardBody')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link to="/team">{t('dashboard.open')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.accountCardTitle')}</CardTitle>
            <CardDescription>{t('dashboard.accountCardBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/account">{t('dashboard.open')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
