// FR-NOT-01: bell with unread count (refreshed every 30 s and on focus, D-31).
// The list is newest first; clicking an item marks it read and opens the record.
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMe } from '@/api/auth';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '@/api/comms';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const list = useNotifications({ enabled: open });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const box = useRef(null);
  const count = unread.data?.unread ?? 0;
  const tz = me.principal.timezone ?? me.workspace.timezone;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const go = (n) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={box}>
      <Button variant="ghost" size="icon" aria-label={count ? t('notifications.bell', { count }) : t('notifications.bellNone')} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Bell aria-hidden="true" />
        {count ? (
          <span aria-hidden="true" className="absolute end-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div role="dialog" aria-label={t('notifications.title')} className="absolute end-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-card shadow-overlay">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
            <Button variant="ghost" size="sm" disabled={!count || markAll.isPending} onClick={() => markAll.mutate()}>
              {t('notifications.markAll')}
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isPending ? (
              <div className="p-3">
                <LoadingState rows={3} />
              </div>
            ) : list.error ? (
              <ErrorState error={list.error} onRetry={() => list.refetch()} />
            ) : list.data.data.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{t('notifications.empty')}</p>
            ) : (
              <ul className="divide-y">
                {list.data.data.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => go(n)} className={cn('flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-accent', !n.read && 'bg-brand-soft')}>
                      {!n.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t('notifications.unreadDot')} /> : <span className="size-2 shrink-0" />}
                      <span className="min-w-0">
                        <span className={cn('block', !n.read && 'font-medium')}>{n.title}</span>
                        <time className="text-xs text-muted-foreground" dateTime={n.created_at}>
                          {formatDateTime(n.created_at, tz)}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
