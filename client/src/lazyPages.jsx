// Pages loaded on demand, so the first download stays small.
import { lazy, Suspense } from 'react';
import { LoadingState } from '@/components/StateViews';

const load = (importer, name) => lazy(() => importer().then((m) => ({ default: m[name] })));

const Account = load(() => import('@/features/account/AccountPage'), 'AccountPage');
const Team = load(() => import('@/features/team/TeamPage'), 'TeamPage');
const Clients = load(() => import('@/features/clients/ClientsPage'), 'ClientsPage');
const ClientDetail = load(() => import('@/features/clients/ClientDetailPage'), 'ClientDetailPage');
const Projects = load(() => import('@/features/projects/ProjectsPage'), 'ProjectsPage');
const ProjectDetail = load(() => import('@/features/projects/ProjectDetailPage'), 'ProjectDetailPage');
const MyTasks = load(() => import('@/features/tasks/MyTasksPage'), 'MyTasksPage');
const Templates = load(() => import('@/features/templates/TemplatesPage'), 'TemplatesPage');
const WorkspaceSettings = load(() => import('@/features/settings/WorkspaceSettingsPage'), 'WorkspaceSettingsPage');

const fallback = <LoadingState rows={5} />;

export const AccountPage = () => (
  <Suspense fallback={fallback}>
    <Account />
  </Suspense>
);
export const TeamPage = () => (
  <Suspense fallback={fallback}>
    <Team />
  </Suspense>
);
export const ClientsPage = () => (
  <Suspense fallback={fallback}>
    <Clients />
  </Suspense>
);
export const ClientDetailPage = () => (
  <Suspense fallback={fallback}>
    <ClientDetail />
  </Suspense>
);
export const ProjectsPage = () => (
  <Suspense fallback={fallback}>
    <Projects />
  </Suspense>
);
export const ProjectDetailPage = () => (
  <Suspense fallback={fallback}>
    <ProjectDetail />
  </Suspense>
);
export const WorkspaceSettingsPage = () => (
  <Suspense fallback={fallback}>
    <WorkspaceSettings />
  </Suspense>
);
export const MyTasksPage = () => (
  <Suspense fallback={fallback}>
    <MyTasks />
  </Suspense>
);
export const TemplatesPage = () => (
  <Suspense fallback={fallback}>
    <Templates />
  </Suspense>
);
