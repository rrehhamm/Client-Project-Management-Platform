// FR-PRJ-09: project list (table or cards) with filters; trash for Owner/Admin (FR-PRJ-11).
import { PROJECT_SORTS, PROJECT_STATUS } from '@cpm/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMe } from '@/api/auth';
import { useClients } from '@/api/clients';
import { useProjects, useRestoreProject } from '@/api/projects';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { ProjectFormDialog } from './ProjectFormDialog';
import { ProjectList } from './ProjectList';

const PAGE_SIZE = 25;

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function ProjectsPage() {
  const { data: me } = useMe();
  const caps = me.capabilities;
  const navigate = useNavigate();
  // FR-DASH-05: dashboard cards open this list with their filter in the URL
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState(() => (Object.values(PROJECT_STATUS).includes(params.get('status')) ? params.get('status') : ''));
  const [overdue, setOverdue] = useState(() => params.get('overdue') === 'true');
  const pmUserId = params.get('pm_user_id') || undefined;
  const memberId = params.get('member_id') || undefined;
  const activeOnly = params.get('active') === 'true'; // D-36
  const [archived, setArchived] = useState('exclude');
  const [trash, setTrash] = useState(false);
  const [sort, setSort] = useState('created_at');
  const [view, setView] = useState('table');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState(null);
  const q = useDebounced(search.trim(), 300);

  const filterKey = [q, clientId, status, overdue, archived, trash, sort, pmUserId, memberId, activeOnly].join('|');
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;

  const clients = useClients({ page_size: 100, sort: 'name', order: 'asc' }, { enabled: caps.view_clients });
  const projects = useProjects({
    q: q || undefined,
    client_id: clientId || undefined,
    status: status || undefined,
    overdue: overdue || undefined,
    pm_user_id: pmUserId,
    member_id: memberId,
    active: activeOnly || undefined,
    archived,
    deleted: trash || undefined,
    sort,
    order: ['name', 'code'].includes(sort) ? 'asc' : 'desc',
    page,
    page_size: PAGE_SIZE,
  });
  const restore = useRestoreProject();
  const filtersActive = Boolean(q || clientId || status || overdue || archived !== 'exclude' || trash || pmUserId || memberId || activeOnly);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        actions={caps.create_projects ? <Button onClick={() => setCreating(true)}>{t('projects.new')}</Button> : null}
      />

      <div aria-live="polite">
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {restore.error ? <Alert variant="destructive">{restore.error.message}</Alert> : null}
      </div>
      {pmUserId || memberId || activeOnly ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">{activeOnly ? t('projects.filterActive') : pmUserId ? t('projects.filterManagedByMe') : t('projects.filterMemberOf')}</span>
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            {t('common.clearFilter')}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[1fr_12rem_11rem_11rem]">
        <Input type="search" aria-label={t('projects.search')} placeholder={t('projects.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        {caps.view_clients ? (
          <Select aria-label={t('projects.columns.client')} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{t('projects.allClients')}</option>
            {(clients.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : (
          <div />
        )}
        <Select aria-label={t('projects.columns.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('projects.allStatuses')}</option>
          {Object.values(PROJECT_STATUS).map((s) => (
            <option key={s} value={s}>
              {t(`projectStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('common.sortBy')} value={sort} onChange={(e) => setSort(e.target.value)}>
          {PROJECT_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`projects.sort.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
          {t('projects.overdueOnly')}
        </label>
        <Select aria-label={t('projects.archived')} className="w-44" value={archived} onChange={(e) => setArchived(e.target.value)}>
          {['exclude', 'include', 'only'].map((a) => (
            <option key={a} value={a}>
              {t(`projects.archivedFilter.${a}`)}
            </option>
          ))}
        </Select>
        {caps.delete_projects ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={trash} onChange={(e) => setTrash(e.target.checked)} />
            {t('projects.trash')}
          </label>
        ) : null}
        <div className="ml-auto flex gap-1" role="group" aria-label={`${t('projects.viewTable')} / ${t('projects.viewCards')}`}>
          <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            {t('projects.viewTable')}
          </Button>
          <Button variant={view === 'cards' ? 'secondary' : 'ghost'} size="sm" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
            {t('projects.viewCards')}
          </Button>
        </div>
      </div>

      {projects.isPending ? (
        <LoadingState rows={5} />
      ) : projects.error ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : projects.data.data.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('projects.empty') : t('projects.emptyNone')}
          action={!filtersActive && caps.create_projects ? <Button onClick={() => setCreating(true)}>{t('projects.new')}</Button> : null}
        />
      ) : (
        <>
          <ProjectList
            projects={projects.data.data}
            view={trash ? 'table' : view}
            dateFormat={me.workspace.date_format}
            onRestore={trash ? (p) => restore.mutate(p.id, { onSuccess: () => setNotice(t('projects.toast.restored')) }) : undefined}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={projects.data.total} onPage={(p) => setPageState({ key: filterKey, page: p })} />
        </>
      )}

      {creating ? <ProjectFormDialog me={me} onOpenChange={setCreating} onSaved={(p) => navigate(`/projects/${p.id}`)} /> : null}
    </div>
  );
}
