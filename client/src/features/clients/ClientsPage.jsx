// FR-CLI-03: client list with search, status filter, sort and pagination.
import { CLIENT_SORTS, CLIENT_STATUS } from '@cpm/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '@/api/auth';
import { useClients } from '@/api/clients';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { ClientStatusBadge } from '@/components/StatusBadges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { ClientFormDialog } from './ClientFormDialog';

const PAGE_SIZE = 25;

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function ClientsPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('name');
  const q = useDebounced(search.trim(), 300);
  const filterKey = `${q}|${status}|${sort}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const [creating, setCreating] = useState(false);

  const clients = useClients({ q: q || undefined, status: status || undefined, sort, order: sort === 'created_at' ? 'desc' : 'asc', page, page_size: PAGE_SIZE });
  const filtersActive = Boolean(q || status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={me.capabilities.create_clients ? <Button onClick={() => setCreating(true)}>{t('clients.new')}</Button> : null}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_10rem]">
        <Input type="search" aria-label={t('clients.search')} placeholder={t('clients.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label={t('clients.columns.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('clients.allStatuses')}</option>
          {Object.values(CLIENT_STATUS).map((s) => (
            <option key={s} value={s}>
              {t(`clientStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('common.sortBy')} value={sort} onChange={(e) => setSort(e.target.value)}>
          {CLIENT_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`clients.sort.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {clients.isPending ? (
        <LoadingState rows={5} />
      ) : clients.error ? (
        <ErrorState error={clients.error} onRetry={() => clients.refetch()} />
      ) : clients.data.data.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('clients.empty') : t('clients.emptyNone')}
          action={
            !filtersActive && me.capabilities.create_clients ? <Button onClick={() => setCreating(true)}>{t('clients.new')}</Button> : null
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">{t('clients.columns.name')}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t('clients.columns.status')}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t('clients.columns.primary')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t('clients.columns.activeProjects')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">{t('clients.columns.outstanding')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {clients.data.data.map((c) => (
                  <tr key={c.id} data-testid={`client-row-${c.name}`} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link to={`/clients/${c.id}`} className="font-medium text-primary hover:underline">
                        {c.name}
                      </Link>
                      {c.code_prefix ? <span className="ml-2 font-mono text-xs text-muted-foreground">{c.code_prefix}</span> : null}
                    </td>
                    <td className="px-4 py-3">{c.status ? <ClientStatusBadge status={c.status} /> : null}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.primary_contact?.full_name ?? t('common.none')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.active_projects ?? t('common.none')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.currency ? formatMoney(c.outstanding_balance, c.currency) : t('common.none')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={clients.data.total} onPage={(p) => setPageState({ key: filterKey, page: p })} />
        </>
      )}

      {creating ? (
        <ClientFormDialog defaultCurrency={me.workspace.currency} onOpenChange={setCreating} onSaved={(c) => navigate(`/clients/${c.id}`)} />
      ) : null}
    </div>
  );
}
