// FR-USER-01…07: list, search and filter people; invite; change roles and rates;
// resend/revoke invitations; deactivate/reactivate; transfer ownership.
import { ROLES, USER_STATUS } from '@cpm/shared';
import { useEffect, useState } from 'react';
import { useMe } from '@/api/auth';
import {
  useDeactivateUser,
  useReactivateUser,
  useResendInvitation,
  useRevokeInvitation,
  useUsers,
} from '@/api/users';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { formatDateTime, formatMoney } from '@/lib/format';
import { EditUserDialog } from './EditUserDialog';
import { InviteUserDialog } from './InviteUserDialog';
import { TransferOwnershipDialog } from './TransferOwnershipDialog';

const PAGE_SIZE = 25;
const STATUS_VARIANT = { Active: 'success', Invited: 'warning', Deactivated: 'secondary' };

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function TeamPage() {
  const { data: me } = useMe();
  const caps = me.capabilities;
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search.trim(), 300);
  // The page number belongs to one set of filters; changing a filter goes back to page 1.
  const filterKey = `${q}|${role}|${status}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (update) => setPageState({ key: filterKey, page: typeof update === 'function' ? update(page) : update });
  const users = useUsers({ q: q.length >= 2 ? q : undefined, role, status, page, page_size: PAGE_SIZE });

  const [notice, setNotice] = useState(null);
  const [dialog, setDialog] = useState(null); // { type, user }
  const closeDialog = () => setDialog(null);

  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();

  const timeZone = me.principal.timezone ?? me.workspace.timezone;
  const currency = me.workspace.currency;
  const total = users.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** Which actions to offer on a row (the API re-checks every one). */
  function actionsFor(u) {
    const self = u.id === me.principal.id;
    const ownerTarget = u.role === ROLES.OWNER;
    const viewerIsOwner = me.principal.role === ROLES.OWNER;
    const canManageInvite = u.role === ROLES.TEAM_MEMBER ? caps.invite_users : caps.invite_any_role;
    const list = [];
    if (u.status !== USER_STATUS.INVITED && (caps.change_roles || caps.edit_rates) && (!ownerTarget || viewerIsOwner || caps.edit_rates)) {
      list.push({ key: 'edit', label: t('team.actions.edit'), onClick: () => setDialog({ type: 'edit', user: u }) });
    }
    if (u.status === USER_STATUS.INVITED && canManageInvite) {
      list.push({
        key: 'resend',
        label: t('team.actions.resend'),
        onClick: () => resend.mutate(u.id, { onSuccess: () => setNotice({ type: 'success', text: t('team.toast.resent') }) }),
      });
      list.push({ key: 'revoke', label: t('team.actions.revoke'), onClick: () => setDialog({ type: 'revoke', user: u }) });
    }
    if (caps.deactivate_users && !self && !ownerTarget) {
      if (u.status === USER_STATUS.ACTIVE) {
        list.push({ key: 'deactivate', label: t('team.actions.deactivate'), onClick: () => setDialog({ type: 'deactivate', user: u }) });
      }
      if (u.status === USER_STATUS.DEACTIVATED) {
        list.push({
          key: 'reactivate',
          label: t('team.actions.reactivate'),
          onClick: () =>
            reactivate.mutate(u.id, {
              onSuccess: () => setNotice({ type: 'success', text: t('team.toast.reactivated', { name: u.full_name }) }),
              onError: (err) => setNotice({ type: 'error', text: err.message }),
            }),
        });
      }
    }
    if (caps.transfer_ownership && u.role === ROLES.ADMIN && u.status === USER_STATUS.ACTIVE) {
      list.push({ key: 'transfer', label: t('team.actions.transfer'), onClick: () => setDialog({ type: 'transfer', user: u }) });
    }
    return list;
  }

  const filtersActive = Boolean(q || role || status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('team.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('team.subtitle')}</p>
        </div>
        {caps.invite_users ? <Button onClick={() => setDialog({ type: 'invite' })}>{t('team.invite')}</Button> : null}
      </div>

      <div aria-live="polite">
        {notice ? <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>{notice.text}</Alert> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <Input type="search" placeholder={t('team.search')} aria-label={t('team.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select aria-label={t('team.columns.role')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t('team.allRoles')}</option>
          {Object.values(ROLES).map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('team.columns.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('team.allStatuses')}</option>
          {Object.values(USER_STATUS).map((s) => (
            <option key={s} value={s}>
              {t(`userStatus.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {users.isPending ? (
        <LoadingState rows={5} />
      ) : users.error ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : users.data.data.length === 0 ? (
        <EmptyState
          title={t('team.empty')}
          action={
            filtersActive ? (
              <Button variant="outline" onClick={() => { setSearch(''); setRole(''); setStatus(''); }}>
                {t('team.emptyAction')}
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">{t('team.columns.person')}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t('team.columns.role')}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t('team.columns.status')}</th>
                  <th scope="col" className="px-4 py-3 font-medium">{t('team.columns.lastLogin')}</th>
                  {caps.view_rates ? <th scope="col" className="px-4 py-3 font-medium">{t('team.columns.rates')}</th> : null}
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">{t('team.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.data.data.map((u) => (
                  <tr key={u.id} data-testid={`user-row-${u.email}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {u.full_name}
                        {u.id === me.principal.id ? <span className="ml-1 text-muted-foreground">({t('common.you')})</span> : null}
                      </div>
                      <div className="text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">{t(`roles.${u.role}`)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[u.status]}>{t(`userStatus.${u.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDateTime(u.last_login_at, timeZone)}</td>
                    {caps.view_rates ? (
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatMoney(u.hourly_cost_rate, currency)} / {formatMoney(u.default_bill_rate, currency)}
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {actionsFor(u).map((a) => (
                          <Button key={a.key} variant="ghost" size="sm" onClick={a.onClick} aria-label={`${a.label}: ${u.full_name}`}>
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('common.pageOf', { page, pages })}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('common.previous')}
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t('common.next')}
              </Button>
            </div>
          </div>
        </>
      )}

      <InviteUserDialog
        open={dialog?.type === 'invite'}
        onOpenChange={(o) => !o && closeDialog()}
        anyRole={caps.invite_any_role}
        onInvited={(text) => setNotice({ type: 'success', text })}
      />
      {dialog?.type === 'edit' ? (
        <EditUserDialog user={dialog.user} me={me} onOpenChange={(o) => !o && closeDialog()} onSaved={(text) => setNotice({ type: 'success', text })} />
      ) : null}
      {dialog?.type === 'transfer' ? (
        <TransferOwnershipDialog user={dialog.user} onOpenChange={(o) => !o && closeDialog()} onDone={(text) => setNotice({ type: 'success', text })} />
      ) : null}
      <ConfirmDialog
        open={dialog?.type === 'deactivate'}
        onOpenChange={(o) => {
          if (!o) {
            deactivate.reset();
            closeDialog();
          }
        }}
        title={t('team.confirm.deactivateTitle', { name: dialog?.user?.full_name })}
        description={t('team.confirm.deactivateBody')}
        destructive
        pending={deactivate.isPending}
        error={deactivate.error}
        onConfirm={() =>
          deactivate.mutate(dialog.user.id, {
            onSuccess: () => {
              setNotice({ type: 'success', text: t('team.toast.deactivated', { name: dialog.user.full_name }) });
              closeDialog();
            },
          })
        }
      />
      <ConfirmDialog
        open={dialog?.type === 'revoke'}
        onOpenChange={(o) => {
          if (!o) {
            revoke.reset();
            closeDialog();
          }
        }}
        title={t('team.confirm.revokeTitle', { email: dialog?.user?.email })}
        description={t('team.confirm.revokeBody')}
        destructive
        pending={revoke.isPending}
        error={revoke.error}
        onConfirm={() =>
          revoke.mutate(dialog.user.id, {
            onSuccess: () => {
              setNotice({ type: 'success', text: t('team.toast.revoked') });
              closeDialog();
            },
          })
        }
      />
    </div>
  );
}
