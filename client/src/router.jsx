import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { NotFoundPage } from '@/features/system/NotFoundPage';
import { RouteErrorPage } from '@/features/system/RouteErrorPage';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';

// Route table. Phase 1 adds /login, protected internal routes and the /portal tree.
export const routes = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <SystemStatusPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
