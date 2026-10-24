// Placeholder portal home. FR-PORT-01 content arrives in Phase 5.
import { useMe } from '@/api/auth';
import { t } from '@/i18n';

export function PortalHomePage() {
  const { data: me } = useMe();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('portal.title', { name: me.principal.full_name })}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('portal.subtitle', { client: me.principal.client.name })}</p>
    </div>
  );
}
