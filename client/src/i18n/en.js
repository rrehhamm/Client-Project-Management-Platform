// All UI text lives here (NFR-I18N-01). Arabic + RTL is Phase 2 (OD-12): add ar.js
// with the same keys.
export const en = {
  app: {
    name: 'Client Project Management',
    skipToContent: 'Skip to main content',
  },
  states: {
    loading: 'Loading…',
    retry: 'Try again',
    errorTitle: 'Something went wrong',
    errorBody: 'We could not load this. Check your connection and try again.',
    emptyTitle: 'Nothing here yet',
    unauthorizedTitle: 'You do not have access',
    unauthorizedBody: 'Ask your workspace admin if you think you should be able to see this.',
  },
  notFound: {
    title: 'Page not found',
    body: 'The page you are looking for does not exist or was moved.',
    home: 'Go to home',
  },
  system: {
    title: 'System status',
    subtitle: 'Phase 0 — foundations. Sign-in and the workspace arrive in Phase 1.',
    allOk: 'All services are running',
    degraded: 'Some services are unavailable',
    checks: {
      database: 'Database',
      storage: 'File storage',
      mail: 'Email',
    },
    ok: 'OK',
    down: 'Unavailable',
  },
  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'Cannot reach the server. Check your connection.',
  },
};
