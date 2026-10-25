// FR-PRJ-08: project overview, plus milestones, members, activity and settings.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMe } from '@/api/auth';
import { useArchiveProject, useChangeProjectStatus, useDeleteProject, useMilestones, useProject, useProjectActivity } from '@/api/projects';
import { ActivityFeed } from '@/components/ActivityFeed';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { ProgressBar } from '@/components/ProgressBar';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { MilestoneStatusBadge, OverdueBadge, ProjectStatusBadge } from '@/components/StatusBadges';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { t } from '@/i18n';
import { formatDate, formatMoney } from '@/lib/format';
import { useTabParam } from '@/lib/useTabParam';
import { MembersTab } from './MembersTab';
import { MilestonesTab } from './MilestonesTab';
import { ProjectSettingsForm } from './ProjectSettingsForm';

const TABS = ['overview', 'milestones', 'members', 'activity', 'settings'];

/** Button label for a status change (BRD 16.1). */
function transitionLabel(from, to) {
  if (from === 'Completed' && to === 'InProgress') return t('projects.actions.reopen');
  if (from === 'OnHold' && to === 'InProgress') return t('projects.actions.resume');
  return t(`projects.actions.${to}`);
}

function Overview({ project, me }) {
  const milestones = useMilestones(project.id);
  const df = me.workspace.date_format;
  const [page, setPage] = useState(1);
  const activity = useProjectActivity(project.id, page);
  const totalTasks = Object.values(project.task_summary).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('projects.overview.milestones')}</CardTitle>
          </CardHeader>
          <CardContent>
            {milestones.isPending ? (
              <LoadingState rows={2} />
            ) : milestones.error ? (
              <ErrorState error={milestones.error} onRetry={() => milestones.refetch()} />
            ) : milestones.data.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('milestones.empty')}</p>
            ) : (
              <ol className="relative space-y-4 border-l pl-6">
                {milestones.data.data.map((m) => (
                  <li key={m.id} className="relative">
                    <span aria-hidden="true" className={`absolute -left-[1.85rem] top-1 size-3 rounded-full border-2 border-background ${m.status === 'Completed' ? 'bg-success' : m.is_overdue ? 'bg-destructive' : 'bg-muted-foreground'}`} />
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {m.title}
                      <MilestoneStatusBadge status={m.status} />
                      {m.is_overdue ? <Badge variant="destructive">{t('milestones.overdue')}</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDate(m.due_date, df)}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('projects.overview.recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed query={activity} page={page} onPage={setPage} timeZone={me.principal.timezone ?? me.workspace.timezone} />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('projects.overview.tasks')}</CardTitle>
          </CardHeader>
          <CardContent>
            {totalTasks === 0 ? (
              <p className="text-sm text-muted-foreground">{t('projects.overview.tasksLater')}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(project.task_summary).map(([s, n]) => (
                  <div key={s} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(`taskStatus.${s}`)}</dt>
                    <dd className="tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
        {'budget_amount' in project ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('projects.overview.budget')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                {project.budget_amount !== null
                  ? formatMoney(project.budget_amount, project.currency)
                  : project.budget_minutes !== null
                    ? `${project.budget_minutes / 60} h`
                    : t('projects.overview.noBudget')}
              </p>
              <p className="text-xs text-muted-foreground">{t('projects.overview.budgetUsedLater')}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function DeleteDialog({ project, onOpenChange, onDeleted }) {
  const remove = useDeleteProject();
  const [typed, setTyped] = useState('');
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects.confirm.deleteTitle', { name: project.name })}</DialogTitle>
          <DialogDescription>{t('projects.confirm.deleteBody')}</DialogDescription>
        </DialogHeader>
        {remove.error ? <Alert variant="destructive">{remove.error.fields?.[0]?.message ?? remove.error.message}</Alert> : null}
        <FormField label={t('projects.confirm.typeName')}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={typed.trim() !== project.name || remove.isPending} onClick={() => remove.mutate({ id: project.id, confirm_name: typed }, { onSuccess: onDeleted })}>
            {t('projects.actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectActivity({ project, me }) {
  const [page, setPage] = useState(1);
  const activity = useProjectActivity(project.id, page);
  return <ActivityFeed query={activity} page={page} onPage={setPage} timeZone={me.principal.timezone ?? me.workspace.timezone} />;
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const query = useProject(id);
  const changeStatus = useChangeProjectStatus();
  const archive = useArchiveProject();
  const [tab, setTab] = useTabParam(TABS, 'overview');
  const [pendingStatus, setPendingStatus] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState(null);

  if (query.isPending) return <LoadingState rows={6} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const p = query.data;
  const df = me.workspace.date_format;
  const canUpdate = p.permissions.update;
  const archived = Boolean(p.archived_at);
  const visibleTabs = TABS.filter((x) => x !== 'settings' || (canUpdate && !archived));
  const activeTab = visibleTabs.includes(tab) ? tab : 'overview';
  const statusError = changeStatus.error ?? archive.error;

  return (
    <div className="space-y-6">
      <Link to="/projects" className="text-sm text-primary hover:underline">
        ← {t('projects.title')}
      </Link>
      <PageHeader
        title={p.name}
        subtitle={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.code}</span>
            <span aria-hidden="true">·</span>
            <Link to={`/clients/${p.client.id}`} className="text-primary hover:underline">
              {p.client.name}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{p.pm.full_name}</span>
          </div>
        }
        actions={
          canUpdate ? (
            <>
              {!archived
                ? p.allowed_transitions.map((s) => (
                    <Button key={s} variant={s === 'Cancelled' ? 'outline' : 'secondary'} onClick={() => setPendingStatus(s)}>
                      {transitionLabel(p.status, s)}
                    </Button>
                  ))
                : null}
              {['Completed', 'Cancelled'].includes(p.status) ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    archive.mutate(
                      { id: p.id, archive: !archived },
                      { onSuccess: () => setNotice(archived ? t('projects.toast.unarchived') : t('projects.toast.archived')) },
                    )
                  }
                >
                  {archived ? t('projects.actions.unarchive') : t('projects.actions.archive')}
                </Button>
              ) : null}
              {p.permissions.delete ? (
                <Button variant="destructive" onClick={() => setDeleting(true)}>
                  {t('projects.actions.delete')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ProjectStatusBadge status={p.status} />
          {p.is_overdue ? <OverdueBadge /> : null}
          {archived ? <Badge variant="outline">{t('projects.archived')}</Badge> : null}
          <span className="text-sm text-muted-foreground">
            {t('projects.overview.dates', { start: formatDate(p.start_date, df), due: p.due_date ? formatDate(p.due_date, df) : t('projects.overview.noDue') })}
          </span>
        </div>
        <div className="mt-3 max-w-sm">
          <ProgressBar value={p.progress_pct} />
        </div>
      </PageHeader>

      <div aria-live="polite">
        {archived ? <Alert>{t('projects.readOnly')}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {statusError ? (
          <Alert variant="destructive">
            {statusError.message}
            {statusError.fields?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {statusError.fields.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
      </div>

      <Tabs tabs={visibleTabs.map((x) => ({ id: x, label: t(`projects.tabs.${x}`) }))} value={activeTab} onChange={setTab} label={p.name} />
      <TabPanel label={t(`projects.tabs.${activeTab}`)}>
        {activeTab === 'overview' ? <Overview project={p} me={me} /> : null}
        {activeTab === 'milestones' ? <MilestonesTab project={p} dateFormat={df} /> : null}
        {activeTab === 'members' ? <MembersTab project={p} /> : null}
        {activeTab === 'activity' ? <ProjectActivity project={p} me={me} /> : null}
        {activeTab === 'settings' ? <ProjectSettingsForm project={p} onSaved={() => setNotice(t('projects.toast.saved'))} /> : null}
      </TabPanel>

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        onOpenChange={(o) => !o && setPendingStatus(null)}
        title={t('projects.confirm.statusTitle', { status: pendingStatus ? t(`projectStatus.${pendingStatus}`) : '' })}
        description={t('projects.confirm.statusBody')}
        destructive={pendingStatus === 'Cancelled'}
        pending={changeStatus.isPending}
        onConfirm={() =>
          changeStatus.mutate(
            { id: p.id, status: pendingStatus, version: p.version },
            {
              onSuccess: () => setNotice(t('projects.toast.status', { status: t(`projectStatus.${pendingStatus}`) })),
              onSettled: () => setPendingStatus(null),
            },
          )
        }
      />
      {deleting ? <DeleteDialog project={p} onOpenChange={setDeleting} onDeleted={() => navigate('/projects', { replace: true })} /> : null}
    </div>
  );
}
