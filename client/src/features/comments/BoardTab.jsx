// FR-COM-06 project message board: posts newest first, one level of replies (D-34 d).
import { useState } from 'react';
import { useMe } from '@/api/auth';
import { useComments, useMentionable } from '@/api/comms';
import { EmptyState, ErrorState, LoadingState } from '@/components/StateViews';
import { t } from '@/i18n';
import { CommentComposer, CommentItem, CommentThread } from './CommentThread';

function Post({ post, project, people, timeZone }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <ol>
        <CommentItem comment={post} people={people} timeZone={timeZone} onReply={post.deleted ? null : () => setOpen((o) => !o)} replyCount={post.reply_count} />
      </ol>
      {open ? (
        <div className="ml-11 border-l pl-4">
          <CommentThread entityType="Project" entityId={project.id} project={project} parentId={post.id} parentVisibility={post.visibility} targetVisibility="Client" title={null} placeholder={t('comments.write')} />
        </div>
      ) : null}
    </li>
  );
}

export function BoardTab({ project }) {
  const { data: me } = useMe();
  const posts = useComments({ entity_type: 'Project', entity_id: project.id, page_size: 50 });
  const people = useMentionable('Project', project.id).data?.data ?? [];
  const timeZone = me.principal.timezone ?? me.workspace.timezone;
  const writable = !project.archived_at;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('board.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('board.subtitle')}</p>
      </div>
      {writable ? <CommentComposer entityType="Project" entityId={project.id} project={project} targetVisibility={project.portal_enabled ? 'Client' : 'Internal'} placeholder={t('board.write')} people={people} /> : null}
      {posts.isPending ? (
        <LoadingState rows={3} />
      ) : posts.error ? (
        <ErrorState error={posts.error} onRetry={() => posts.refetch()} />
      ) : posts.data.data.length === 0 ? (
        <EmptyState body={t('board.empty')} />
      ) : (
        <ul className="space-y-4">
          {posts.data.data.map((p) => (
            <Post key={p.id} post={p} project={project} people={people} timeZone={timeZone} />
          ))}
        </ul>
      )}
    </div>
  );
}
