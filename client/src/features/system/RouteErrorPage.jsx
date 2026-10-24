// Shown when a route throws while rendering. Never shows technical details.
import { ErrorState } from '@/components/StateViews';

export function RouteErrorPage() {
  return <ErrorState onRetry={() => window.location.reload()} />;
}
