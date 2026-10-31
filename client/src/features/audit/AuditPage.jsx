// FR-ACT-02: Owner/Admin audit log — filter by person, record type, action and date;
// export CSV. Entries are read-only (BR-ACT-01).
import { useState } from 'react';
import { useMe } from '@/api/auth';
import { auditCsvUrl, useAudit } from '@/api/comms';
import { useUsers } from '@/api/users';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/format';

const ENTITY_TYPES = ['Client', 'Contact', 'Project', 'Milestone', 'Task', 'Comment', 'File', 'Folder', 'User', 'Workspace', 'Permission', 'ActivityLog'];

const show = (v) => (v === null || v === undefined ? '' : JSON.stringify(v));

export function AuditPage() {
  const { data: me } = useMe();
  const users = useUsers({ page_size: 100 });
  const [filters, setFilters] = useState({ actor_id: '', entity_type: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const query = useAudit({ ...params, page, page_size: 50 });
  const tz = me.principal.timezone ?? me.workspace.timezone;
  const set = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('audit.title')}
        subtitle={t('audit.subtitle')}
        actions={
          <Button asChild variant="outline">
            <a href={auditCsvUrl(params)} download>
              {t('audit.export')}
            </a>
          </Button>
        }
      />
      <div className="grid gap-3 md:grid-cols-5">
        <FormField label={t('audit.actor')}>
          <Select value={filters.actor_id} onChange={(e) => set('actor_id', e.target.value)}>
            <option value="">{t('audit.anyone')}</option>
            {(users.data?.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('audit.entity')}>
          <Select value={filters.entity_type} onChange={(e) => set('entity_type', e.target.value)}>
            <option value="">{t('audit.anyEntity')}</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t('audit.action')} hint={t('audit.actionHint')}>
          <Input value={filters.action} onChange={(e) => set('action', e.target.value.trim())} maxLength={80} />
        </FormField>
        <FormField label={t('audit.from')}>
          <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </FormField>
        <FormField label={t('audit.to')}>
          <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </FormField>
      </div>
      {query.isPending ? (
        <LoadingState rows={6} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState body={t('audit.empty')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {['when', 'who', 'action', 'record', 'change', 'ip'].map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 font-medium">
                      {t(`audit.columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y align-top">
                {query.data.data.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.created_at, tz)}</td>
                    <td className="px-3 py-2">{e.actor.name ?? (e.after?.reason === 'signed_out' ? t('audit.signedOut') : t('audit.system'))}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.entity_type}
                      {e.entity_id ? <div className="font-mono text-muted-foreground">{e.entity_id.slice(0, 8)}</div> : null}
                    </td>
                    <td className="max-w-md px-3 py-2 font-mono text-xs break-all">
                      {e.before ? <div className="text-muted-foreground">{show(e.before)}</div> : null}
                      {e.after ? <div>{show(e.after)}</div> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{e.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={50} total={query.data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
