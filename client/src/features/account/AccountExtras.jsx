// Account page additions: profile photo (FR-AUTH-13) and notification settings (FR-NOT-03).
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from '@cpm/shared';
import { useRef, useState } from 'react';
import { useAvatar, usePreferences, useSavePreferences } from '@/api/comms';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Avatar } from '@/features/comments/CommentThread';
import { t } from '@/i18n';

export function AvatarForm({ me }) {
  const { upload, remove } = useAvatar();
  const [notice, setNotice] = useState(null);
  const input = useRef(null);
  const error = upload.error ?? remove.error;
  const person = { kind: 'user', id: me.principal.id, full_name: me.principal.full_name, has_avatar: me.principal.has_avatar };
  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* key: reload the image after a change */}
      <Avatar key={`${me.principal.version}`} person={person} size="size-16" />
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('account.avatar.body')}</p>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
            {t('account.avatar.upload')}
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) upload.mutate(f, { onSuccess: () => setNotice(t('account.avatar.saved')) });
                e.target.value = '';
              }}
            />
          </label>
          {me.principal.has_avatar ? (
            <Button variant="ghost" onClick={() => remove.mutate(undefined, { onSuccess: () => setNotice(t('account.avatar.removed')) })} disabled={remove.isPending}>
              {t('account.avatar.remove')}
            </Button>
          ) : null}
        </div>
        <div aria-live="polite">
          {error ? <Alert variant="destructive">{error.message}</Alert> : notice ? <Alert variant="success">{notice}</Alert> : null}
        </div>
      </div>
    </div>
  );
}

export function NotificationPrefsForm() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const [saved, setSaved] = useState(false);
  if (prefs.isPending) return <LoadingState rows={3} />;
  if (prefs.error) return <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />;
  const values = prefs.data.preferences;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('notifications.prefsBody')}</p>
      <ul className="divide-y rounded-md border">
        {NOTIFICATION_EVENTS.map((e) => (
          <li key={e} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <label htmlFor={`pref-${e}`} className="text-sm">
              {t(`notifications.events.${e}`)}
            </label>
            <Select
              id={`pref-${e}`}
              className="w-44"
              value={values[e]}
              onChange={(ev) => {
                setSaved(false);
                save.mutate({ [e]: ev.target.value }, { onSuccess: () => setSaved(true) });
              }}
            >
              {NOTIFICATION_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t(`notifications.channels.${c}`)}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      <div aria-live="polite">{save.error ? <Alert variant="destructive">{save.error.message}</Alert> : saved ? <Alert variant="success">{t('notifications.prefsSaved')}</Alert> : null}</div>
    </div>
  );
}
