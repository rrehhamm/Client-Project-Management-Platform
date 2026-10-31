// FR-NOT-05: follow or unfollow a task, file or project.
import { Bell, BellOff } from 'lucide-react';
import { useFollowing, useSetFollowing } from '@/api/comms';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

export function FollowButton({ entityType, entityId }) {
  const state = useFollowing(entityType, entityId);
  const set = useSetFollowing(entityType, entityId);
  if (state.isPending || state.error) return null;
  const on = state.data.following;
  return (
    <Button variant="outline" size="sm" aria-pressed={on} title={t('notifications.followHint')} disabled={set.isPending} onClick={() => set.mutate(!on)}>
      {on ? <BellOff aria-hidden="true" /> : <Bell aria-hidden="true" />}
      {on ? t('notifications.following') : t('notifications.follow')}
    </Button>
  );
}
