// FR-SRCH-01: full search results page (/search?q=…).
import { useNavigate, useSearchParams } from 'react-router';
import { useSearch } from '@/api/comms';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { t } from '@/i18n';
import { SearchResults } from './SearchBox';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const results = useSearch(q);
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <PageHeader title={t('search.title')} subtitle={results.data ? t('search.results', { count: results.data.total, q }) : null} />
      {q.length < 2 ? (
        <p className="text-sm text-muted-foreground">{t('search.min')}</p>
      ) : results.isPending ? (
        <LoadingState rows={4} />
      ) : results.error ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : (
        <div className="rounded-lg border">
          <SearchResults data={results.data} onPick={(r) => navigate(r.link)} />
        </div>
      )}
    </div>
  );
}
