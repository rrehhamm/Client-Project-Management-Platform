import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { AuthLayout } from '@/components/AuthLayout';
import { InternalLayout } from '@/components/InternalLayout';
import { PortalLayout } from '@/components/PortalLayout';
import { AccountPage } from '@/features/account/AccountPage';
import { AcceptInvitePage } from '@/features/auth/AcceptInvitePage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { PublicOnly, RequireCapability, RequireSession } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { VerifyEmailPage } from '@/features/auth/VerifyEmailPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PortalHomePage } from '@/features/portal/PortalHomePage';
import { NotFoundPage } from '@/features/system/NotFoundPage';
import { RouteErrorPage } from '@/features/system/RouteErrorPage';
import { SystemStatusPage } from '@/features/system/SystemStatusPage';
import { TeamPage } from '@/features/team/TeamPage';

export const routes = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      // Sign-in pages: signed-in visitors are sent home
      {
        element: <PublicOnly />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/forgot-password', element: <ForgotPasswordPage /> },
            ],
          },
        ],
      },
      // Links from emails work whether or not someone is signed in
      {
        element: <AuthLayout />,
        children: [
          { path: '/reset-password', element: <ResetPasswordPage /> },
          { path: '/accept-invite', element: <AcceptInvitePage /> },
          { path: '/verify-email', element: <VerifyEmailPage /> },
        ],
      },
      // Internal app (Owner, Admin, PM, Team Member, Finance)
      {
        element: <RequireSession kind="user" />,
        children: [
          {
            element: <InternalLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: '/team', element: <RequireCapability capability="manage_team"><TeamPage /></RequireCapability> },
              { path: '/account', element: <AccountPage /> },
            ],
          },
        ],
      },
      // Client portal (Client Contacts)
      {
        path: '/portal',
        element: <RequireSession kind="contact" />,
        children: [
          {
            element: <PortalLayout />,
            children: [
              { index: true, element: <PortalHomePage /> },
              { path: 'account', element: <AccountPage /> },
            ],
          },
        ],
      },
      // Public pages
      {
        element: <AppShell />,
        children: [
          { path: '/status', element: <SystemStatusPage /> },
          { path: '/dashboard', element: <Navigate to="/" replace /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
