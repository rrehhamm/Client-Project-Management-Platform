// FR-ACT-01 feed: "who did what, when", with before → after values.
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { t, tIn } from '@/i18n';
import { formatDateTime } from '@/lib/format';

function describe(entry) {
  const actor = entry.actor?.name ?? t('activity.system');
  // Action names contain dots ("project.archived"), so look them up literally.
  // Record names captured when the entry was written (comments, files, folders)
  const title = entry.after?.on_title ?? entry.before?.title ?? '';
  const name = entry.after?.name ?? entry.before?.name ?? '';
  return tIn('activity.actions', entry.action, { actor, title, name }) ?? t('activity.fallback', { actor, action: entry.action });
}

const LABELS = { status: 'projectStatus' };

function changeText(entry) {
  if (!entry.before || !entry.after) return null;
  const fmt = (k, v) => (LABELS[k] && typeof v === 'string' ? t(`${LABELS[k]}.${v}`) : String(v ?? t('common.none')));
  const parts = Object.keys(entry.after)
    .filter((k) => k in entry.before && entry.before[k] !== entry.after[k])
    .map((k) => `${k.replaceAll('_', ' ')}: ${fmt(k, entry.before[k])} → ${fmt(k, entry.after[k])}`);
  return parts.length ? parts.join(' · ') : null;
}

export function ActivityFeed({ query, page, onPage, timeZone }) {
  if (query.isPending) return <LoadingState rows={4} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { data, total, page_size: pageSize } = query.data;
  if (!data.length) return <EmptyState title={t('activity.empty')} />;
  return (
    <div className="space-y-4">
      <ol className="divide-y rounded-lg border">
        {data.map((e) => {
          const change = changeText(e);
          return (
            <li key={e.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span>{describe(e)}</span>
                <time className="text-muted-foreground" dateTime={e.created_at}>
                  {formatDateTime(e.created_at, timeZone)}
                </time>
              </div>
              {change ? <p className="mt-1 text-xs text-muted-foreground">{change}</p> : null}
            </li>
          );
        })}
      </ol>
      <Pagination page={page} pageSize={pageSize} total={total} onPage={onPage} />
    </div>
  );
}
