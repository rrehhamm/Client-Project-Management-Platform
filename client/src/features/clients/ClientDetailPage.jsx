// FR-CLI-04: the client's 360° view.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMe } from '@/api/auth';
import { useArchiveClient, useClient, useClientActivity, useDeleteClient, useRestoreClient } from '@/api/clients';
import { useProjects } from '@/api/projects';
import { ActivityFeed } from '@/components/ActivityFeed';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { ClientStatusBadge } from '@/components/StatusBadges';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { t } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { useTabParam } from '@/lib/useTabParam';
import { ProjectFormDialog } from '@/features/projects/ProjectFormDialog';
import { ProjectList } from '@/features/projects/ProjectList';
import { ClientFormDialog } from './ClientFormDialog';
import { ContactsTab } from './ContactsTab';

const TABS = ['overview', 'projects', 'contacts', 'proposals', 'invoices', 'files', 'activity'];

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || t('common.none')}</dd>
    </div>
  );
}

function Overview({ client }) {
  const c = client.counts;
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t('clients.form.prefix')}>
              <span className="font-mono">{client.code_prefix}</span>
            </Field>
            <Field label={t('clients.form.currency')}>{client.currency}</Field>
            <Field label={t('clients.form.industry')}>{client.industry}</Field>
            <Field label={t('clients.form.website')}>
              {client.website ? (
                <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {client.website}
                </a>
              ) : null}
            </Field>
            <Field label={t('clients.form.taxId')}>{client.tax_id}</Field>
            <Field label={t('clients.form.paymentTerms')}>{String(client.payment_terms_days)}</Field>
            <Field label={t('clients.columns.primary')}>{client.primary_contact ? `${client.primary_contact.full_name} · ${client.primary_contact.email}` : null}</Field>
            <Field label={t('clients.form.billingAddress')}>
              <span className="whitespace-pre-line">{client.billing_address}</span>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('clients.form.internalNotes')}>
                <span className="whitespace-pre-line">{client.internal_notes}</span>
              </Field>
            </div>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('clients.overview.counts')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Field label={t('clients.overview.activeProjects')}>{String(c.active_projects)}</Field>
            <Field label={t('clients.overview.projects')}>{String(c.projects)}</Field>
            <Field label={t('clients.overview.contacts')}>{String(c.contacts)}</Field>
            <Field label={t('clients.overview.invoices')}>{String(c.invoices)}</Field>
            <div className="col-span-2">
              <Field label={t('clients.overview.outstanding')}>{formatMoney(client.outstanding_balance, client.currency)}</Field>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function ClientProjects({ client, me }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const projects = useProjects({ client_id: client.id, archived: 'include', page_size: 100, sort: 'created_at', order: 'desc' });
  return (
    <div className="space-y-4">
      {me.capabilities.create_projects && client.status === 'Active' ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>{t('projects.new')}</Button>
        </div>
      ) : null}
      {projects.isPending ? (
        <LoadingState rows={3} />
      ) : projects.error ? (
        <ErrorState error={projects.error} onRetry={() => projects.refetch()} />
      ) : projects.data.data.length === 0 ? (
        <EmptyState title={t('projects.emptyNone')} />
      ) : (
        <ProjectList projects={projects.data.data} dateFormat={me.workspace.date_format} showClient={false} />
      )}
      {creating ? <ProjectFormDialog me={me} clientId={client.id} onOpenChange={setCreating} onSaved={(p) => navigate(`/projects/${p.id}`)} /> : null}
    </div>
  );
}

function ClientActivity({ client, me }) {
  const [page, setPage] = useState(1);
  const activity = useClientActivity(client.id, page);
  return <ActivityFeed query={activity} page={page} onPage={setPage} timeZone={me.principal.timezone ?? me.workspace.timezone} />;
}

export function ClientDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const caps = me.capabilities;
  const query = useClient(id);
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState(null);
  const archive = useArchiveClient();
  const restore = useRestoreClient();
  const remove = useDeleteClient();

  if (query.isPending) return <LoadingState rows={6} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const client = query.data;
  const archived = client.status === 'Archived';

  return (
    <div className="space-y-6">
      <Link to="/clients" className="text-sm text-primary hover:underline">
        ← {t('clients.title')}
      </Link>
      <PageHeader
        title={client.name}
        subtitle={<ClientStatusBadge status={client.status} />}
        actions={
          <>
            {caps.edit_clients && !archived ? (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                {t('common.edit')}
              </Button>
            ) : null}
            {caps.edit_clients && !archived ? (
              <Button variant="outline" onClick={() => setDialog('archive')}>
                {t('clients.actions.archive')}
              </Button>
            ) : null}
            {caps.edit_clients && archived ? (
              <Button variant="outline" onClick={() => restore.mutate(client.id, { onSuccess: () => setNotice(t('clients.toast.restored')) })}>
                {t('clients.actions.restore')}
              </Button>
            ) : null}
            {caps.delete_clients ? (
              <Button variant="destructive" onClick={() => setDialog('delete')}>
                {t('clients.actions.delete')}
              </Button>
            ) : null}
          </>
        }
      />
      <div aria-live="polite">
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {restore.error ? <Alert variant="destructive">{restore.error.message}</Alert> : null}
      </div>

      <Tabs tabs={TABS.map((id) => ({ id, label: t(`clients.tabs.${id}`) }))} value={tab} onChange={setTab} label={client.name} />
      <TabPanel label={t(`clients.tabs.${tab}`)}>
        {tab === 'overview' ? <Overview client={client} /> : null}
        {tab === 'projects' ? <ClientProjects client={client} me={me} /> : null}
        {tab === 'contacts' ? <ContactsTab client={client} canManage={caps.manage_contacts} /> : null}
        {tab === 'proposals' ? <EmptyState title={t('common.comingLater', { phase: 'Phase 7' })} /> : null}
        {tab === 'invoices' ? <EmptyState title={t('common.comingLater', { phase: 'Phase 7' })} /> : null}
        {tab === 'files' ? <EmptyState title={t('common.comingLater', { phase: 'Phase 4' })} /> : null}
        {tab === 'activity' ? <ClientActivity client={client} me={me} /> : null}
      </TabPanel>

      {dialog === 'edit' ? (
        <ClientFormDialog client={client} defaultCurrency={me.workspace.currency} onOpenChange={(o) => !o && setDialog(null)} onSaved={() => setNotice(t('clients.toast.saved'))} />
      ) : null}
      <ConfirmDialog
        open={dialog === 'archive'}
        onOpenChange={(o) => {
          if (!o) {
            archive.reset();
            setDialog(null);
          }
        }}
        title={t('clients.confirm.archiveTitle', { name: client.name })}
        description={t('clients.confirm.archiveBody')}
        pending={archive.isPending}
        error={archive.error}
        onConfirm={() =>
          archive.mutate(client.id, {
            onSuccess: () => {
              setNotice(t('clients.toast.archived'));
              setDialog(null);
            },
          })
        }
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => {
          if (!o) {
            remove.reset();
            setDialog(null);
          }
        }}
        title={t('clients.confirm.deleteTitle', { name: client.name })}
        description={t('clients.confirm.deleteBody')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(client.id, { onSuccess: () => navigate('/clients', { replace: true }) })}
      />
    </div>
  );
}
