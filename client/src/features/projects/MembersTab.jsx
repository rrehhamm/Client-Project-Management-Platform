// FR-PRJ-05, D-14: project members. Only Owner/Admin and the project's PM manage them.
import { PORTAL_LEVELS } from '@cpm/shared';
import { useState } from 'react';
import { useContacts } from '@/api/clients';
import { useAddMember, useMembers, useRemoveMember, useUpdateMember } from '@/api/projects';
import { useUsers } from '@/api/users';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';

function AddMember({ project, existing }) {
  const add = useAddMember();
  const users = useUsers({ assignable: true, page_size: 100 });
  const contacts = useContacts(project.client.id);
  const [userId, setUserId] = useState('');
  const [contactId, setContactId] = useState('');
  const [level, setLevel] = useState('View');
  const memberUserIds = new Set(existing.filter((m) => m.kind === 'user').map((m) => m.user_id));
  const memberContactIds = new Set(existing.filter((m) => m.kind === 'contact').map((m) => m.contact_id));

  return (
    <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
      {add.error ? (
        <Alert variant="destructive" className="md:col-span-2">
          {add.error.fields?.[0]?.message ?? add.error.message}
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="add-user">{t('members.addPerson')}</Label>
        <div className="flex gap-2">
          <Select id="add-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t('members.choosePerson')}</option>
            {(users.data?.data ?? [])
              .filter((u) => !memberUserIds.has(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({t(`roles.${u.role}`)})
                </option>
              ))}
          </Select>
          <Button disabled={!userId || add.isPending} onClick={() => add.mutate({ projectId: project.id, user_id: userId }, { onSuccess: () => setUserId('') })}>
            {t('common.add')}
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="add-contact">{t('members.addContact')}</Label>
        <div className="flex flex-wrap gap-2 sm:flex-nowrap">
          <Select id="add-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t('members.chooseContact')}</option>
            {(contacts.data?.data ?? [])
              .filter((c) => !memberContactIds.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
          </Select>
          <Select aria-label={t('members.portalLevel')} className="sm:w-32" value={level} onChange={(e) => setLevel(e.target.value)}>
            {Object.values(PORTAL_LEVELS).map((l) => (
              <option key={l} value={l}>
                {t(`portalLevel.${l}`)}
              </option>
            ))}
          </Select>
          <Button
            disabled={!contactId || add.isPending}
            onClick={() => add.mutate({ projectId: project.id, contact_id: contactId, portal_level: level }, { onSuccess: () => setContactId('') })}
          >
            {t('common.add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MembersTab({ project }) {
  const query = useMembers(project.id);
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const [removing, setRemoving] = useState(null);
  const canManage = project.permissions.manage_members && !project.archived_at;

  if (query.isPending) return <LoadingState rows={3} />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const members = query.data.data;

  return (
    <div className="space-y-4">
      {canManage ? <AddMember project={project} existing={members} /> : null}
      {update.error ? <Alert variant="destructive">{update.error.message}</Alert> : null}
      {members.length === 0 ? (
        <EmptyState title={t('members.empty')} />
      ) : (
        <ul className="divide-y rounded-lg border">
          {members.map((m) => (
            <li key={m.id} data-testid={`member-${m.email}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {m.full_name}
                  {m.kind === 'user' ? (
                    <Badge variant={m.is_pm ? 'default' : 'secondary'}>{m.is_pm ? t('members.pm') : t('members.member')}</Badge>
                  ) : (
                    <Badge variant="outline">{t('members.contact')}</Badge>
                  )}
                  {m.kind === 'user' && m.status !== 'Active' ? <Badge variant="destructive">{t('members.inactive')}</Badge> : null}
                </div>
                <div className="text-muted-foreground">{m.email}</div>
              </div>
              {canManage ? (
                <div className="flex items-center gap-2">
                  {m.kind === 'contact' ? (
                    <Select
                      aria-label={`${t('members.portalLevel')}: ${m.full_name}`}
                      className="w-32"
                      value={m.portal_level}
                      onChange={(e) => update.mutate({ projectId: project.id, memberId: m.id, portal_level: e.target.value })}
                    >
                      {Object.values(PORTAL_LEVELS).map((l) => (
                        <option key={l} value={l}>
                          {t(`portalLevel.${l}`)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={m.is_pm}
                    title={m.is_pm ? t('members.pmCannotBeRemoved') : undefined}
                    aria-label={`${t('common.remove')}: ${m.full_name}`}
                    onClick={() => setRemoving(m)}
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => {
          if (!o) {
            remove.reset();
            setRemoving(null);
          }
        }}
        title={t('members.confirmRemove', { name: removing?.full_name })}
        description={t('members.confirmRemoveBody')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate({ projectId: project.id, memberId: removing.id }, { onSuccess: () => setRemoving(null) })}
      />
    </div>
  );
}
