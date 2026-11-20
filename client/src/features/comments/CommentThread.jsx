// Comments on a task, file or board post (FR-COM-01…04). The open thread refreshes
// every 3 seconds (D-31). Internal comments carry a yellow "Internal" tag (FR-COM-02).
import { COMMENT_MAX_ATTACHMENTS } from '@cpm/shared';
import { Paperclip, X } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';
import { useMe } from '@/api/auth';
import { fileUrl, useComments, useDeleteComment, useEditComment, useMentionable, usePostComment, uploadWithProgress } from '@/api/comms';
import { useAddMember } from '@/api/projects';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/StateViews';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { t } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { useApiBase } from '@/lib/apiScope';
import { safeHtml } from '@/lib/safeHtml';
import { ImageAttachment } from './ImageAttachment';

// D-37: these image types show as a thumbnail once the virus scan is done
const THUMBNAIL_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const isThumbnailable = (a) => a.scan_status === 'Clean' && THUMBNAIL_TYPES.includes(a.mime_type);

const RichComposer = lazy(() => import('./RichComposer'));

export const InternalTag = () => (
  <Badge variant="warning">
    {t('comments.internal')}
  </Badge>
);

export function Avatar({ person, size = 'size-8' }) {
  const initials = (person?.full_name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  if (person?.has_avatar && person.kind !== 'contact') {
    return <img src={`/api/v1/avatars/${person.id}`} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold`}>
      {initials}
    </span>
  );
}

async function openAttachment(a, base) {
  const { url } = await fileUrl(a.file_id, a.version_no, { base });
  window.open(url, '_blank', 'noopener');
}

function CommentItem({ comment, people, timeZone, onReply, replyCount }) {
  const base = useApiBase();
  const edit = useEditComment();
  const remove = useDeleteComment();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const c = comment;
  return (
    <li id={`comment-${c.id}`} className="flex gap-3" data-testid={`comment-${c.id}`}>
      <Avatar person={c.author} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{c.author?.full_name ?? t('activity.system')}</span>
          <time className="text-xs text-muted-foreground" dateTime={c.created_at}>
            {formatDateTime(c.created_at, timeZone)}
          </time>
          {c.visibility === 'Internal' ? <InternalTag /> : null}
          {c.edited && !c.deleted ? <span className="text-xs text-muted-foreground">({t('comments.edited')})</span> : null}
        </div>
        {c.deleted ? (
          <p className="text-sm italic text-muted-foreground">{t('comments.deleted')}</p>
        ) : editing ? (
          <Suspense fallback={<LoadingState rows={1} />}>
            <RichComposer
              people={people}
              initialHtml={c.body}
              label={t('comments.editLabel')}
              submitLabel={t('comments.save')}
              pending={edit.isPending}
              autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={({ body, mention_user_ids }) =>
                edit
                  .mutateAsync(base ? { id: c.id, body, version: c.version } : { id: c.id, body, mention_user_ids: [...new Set([...c.mentions.filter((m) => m.id && !m.kind).map((m) => m.id), ...mention_user_ids])], version: c.version })
                  .then(() => setEditing(false))
                  .catch(() => false)
              }
            />
            {edit.error ? <Alert variant="destructive">{edit.error.message}</Alert> : null}
          </Suspense>
        ) : (
          // Cleaned on the server and again here (lib/safeHtml.js)
          <div className="text-sm [&_a]:text-brand-text [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: safeHtml(c.body) }} />
        )}
        {c.attachments.length ? (
          <ul className="flex flex-wrap items-end gap-2">
            {c.attachments.map((a) => (
              <li key={a.file_id}>
                {isThumbnailable(a) ? (
                  <ImageAttachment attachment={a} />
                ) : (
                <button type="button" className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-60" disabled={a.scan_status !== 'Clean'} onClick={() => openAttachment(a, base)}>
                  <Paperclip aria-hidden="true" className="size-3" />
                  {a.name}
                  {a.scan_status === 'Pending' ? ` (${t('comments.scanning')})` : ''}
                </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {!c.deleted && !editing ? (
          <div className="flex gap-3 text-xs">
            {onReply ? (
              <button type="button" className="text-brand-text hover:underline" onClick={onReply}>
                {replyCount ? t('comments.showReplies', { count: replyCount }) : t('comments.reply')}
              </button>
            ) : null}
            {(c.permissions?.edit ?? c.can_edit) ? (
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setEditing(true)}>
                {t('comments.edit')}
              </button>
            ) : null}
            {(c.permissions?.delete ?? c.can_delete) ? (
              <button type="button" className="text-muted-foreground hover:underline" onClick={() => setConfirming(true)}>
                {t('comments.delete')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('comments.deleteTitle')}
        description={t('comments.deleteBody')}
        confirmLabel={t('comments.delete')}
        destructive
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate(c.id, { onSuccess: () => setConfirming(false) })}
      />
    </li>
  );
}

/**
 * Composer with visibility and attachments. `targetVisibility` = the commented record's
 * visibility: Client comments are offered only on Client-visible records.
 */
export function CommentComposer({ entityType, entityId, project, targetVisibility = 'Internal', parentId, parentVisibility, placeholder, people, contacts = [] }) {
  const base = useApiBase();
  const { data: me } = useMe();
  const postComment = usePostComment();
  const addMember = useAddMember();
  const [visibility, setVisibility] = useState('Internal');
  const [files, setFiles] = useState([]); // uploaded attachments [{id, name}]
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const lastBody = useRef(null);
  const inputRef = useRef(null);
  const canShare = targetVisibility === 'Client' && parentVisibility !== 'Internal' && me.principal.kind === 'user';

  const blocked = postComment.error?.fields?.filter((f) => f.field === 'mention_user_ids' && f.user_id) ?? [];

  // FR-COM-03: contacts can be mentioned only in Client comments
  const mentionPeople = canShare && visibility === 'Client' ? [...people, ...contacts.map((c) => ({ ...c, isContact: true }))] : people;
  const contactIds = new Set(contacts.map((c) => c.id));

  const send = (value) => {
    lastBody.current = value;
    return postComment
      .mutateAsync({
        entity_type: entityType,
        entity_id: entityId,
        body: value.body,
        visibility: canShare ? visibility : undefined,
        ...(base
          ? {}
          : {
              mention_user_ids: value.mention_user_ids.filter((id) => !contactIds.has(id)),
              mention_contact_ids: value.mention_user_ids.filter((id) => contactIds.has(id)),
            }),
        attachment_file_ids: files.map((f) => f.id),
        parent_id: parentId,
      })
      .then(() => {
        setFiles([]);
        return true;
      })
      .catch(() => false);
  };

  const attach = async (list) => {
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of [...list].slice(0, COMMENT_MAX_ATTACHMENTS - files.length)) {
        const saved = await uploadWithProgress(`${base}/projects/${project.id}/files`, file);
        setFiles((f) => [...f, { id: saved.id, name: saved.name }]);
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <Suspense fallback={<LoadingState rows={1} />}>
        <RichComposer
          people={mentionPeople}
          label={t('comments.label')}
          placeholder={placeholder ?? t('comments.write')}
          submitLabel={postComment.isPending ? t('comments.posting') : t('comments.post')}
          pending={postComment.isPending || uploading}
          onSubmit={send}
          footer={
            <>
              <label className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm hover:bg-accent">
                <Paperclip aria-hidden="true" className="size-4" />
                <span>{t('comments.attach')}</span>
                <input ref={inputRef} type="file" multiple className="sr-only" disabled={files.length >= COMMENT_MAX_ATTACHMENTS || uploading} onChange={(e) => attach(e.target.files)} />
              </label>
              {canShare ? (
                <Select aria-label={t('comments.visibility')} className="h-8 w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="Internal">{t('comments.internal')}</option>
                  <option value="Client">{t('comments.client')}</option>
                </Select>
              ) : null}
            </>
          }
        />
      </Suspense>
      {files.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('comments.attach')}>
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs">
              {f.name}
              <button type="button" aria-label={t('comments.removeAttachment', { name: f.name })} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div aria-live="polite" className="space-y-2">
        {uploadError ? <Alert variant="destructive">{uploadError}</Alert> : null}
        {postComment.error ? (
          <Alert variant="destructive">
            {postComment.error.message}
            {blocked.length ? (
              <ul className="mt-2 space-y-1">
                {blocked.map((b) => (
                  <li key={b.user_id} className="flex flex-wrap items-center gap-2">
                    {b.message}
                    {/* BR-COM-02: offer to add them, if this person may manage members */}
                    {project.permissions?.manage_members ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={addMember.isPending}
                        onClick={() => addMember.mutate({ projectId: project.id, user_id: b.user_id }, { onSuccess: () => lastBody.current && send(lastBody.current) })}
                      >
                        {t('comments.addToProject', { name: b.message.replace(/ is not on this project$/, '') })}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
      </div>
    </div>
  );
}

/** A thread: comments oldest first, then the composer. */
export function CommentThread({ entityType, entityId, project, targetVisibility, parentId, parentVisibility, canComment = true, title = t('comments.title'), placeholder }) {
  const { data: me } = useMe();
  const query = useComments({ entity_type: entityType, entity_id: entityId, parent_id: parentId });
  const mentionable = useMentionable(entityType === 'Project' ? 'Project' : entityType, entityType === 'Project' ? project.id : entityId).data;
  const people = mentionable?.data ?? [];
  const timeZone = me.principal.timezone ?? me.workspace.timezone;

  return (
    <section className="space-y-3" aria-label={title}>
      {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
      {query.isPending ? (
        <LoadingState rows={2} />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
      ) : (
        <ol className="space-y-4" aria-live="polite">
          {query.data.data.map((c) => (
            <CommentItem key={c.id} comment={c} people={people} timeZone={timeZone} />
          ))}
        </ol>
      )}
      {canComment ? <CommentComposer entityType={entityType} entityId={entityId} project={project} targetVisibility={targetVisibility} parentId={parentId} parentVisibility={parentVisibility} placeholder={placeholder} people={people} contacts={mentionable?.contacts ?? []} /> : null}
    </section>
  );
}

export { CommentItem };
