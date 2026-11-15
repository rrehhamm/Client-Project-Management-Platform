// Comments: FR-COM-01…04, FR-COM-06 (message board), BR-COM-01/02, FR-NOT-02/05.
// A comment sits on the record it is about (project, task or file). Internal
// comments never reach Client Contacts (BR-COM-01): not in lists, not in notifications.
import { COMMENT_EDIT_WINDOW_HOURS, COMMENT_MAX_ATTACHMENTS, COMMENT_MAX_CHARS } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { AppError, conflict, fieldError, notFound, staleUpdate } from '../../lib/errors.js';
import { follow, followersOf, notify } from '../../lib/notify.js';
import { cleanRichText, visibleText } from '../../lib/richText.js';
import { isUuid } from '../../lib/validate.js';
import { loadFileContext } from '../files/common.js';
import { assertWritable, loadProjectContext, membershipOf } from '../projects/common.js';
import { loadTaskContext } from '../tasks/common.js';

// ---------------------------------------------------------------------------
// The record a comment is about
// ---------------------------------------------------------------------------

/** ctx for can(): { project, membership, record = the commented record, target: {type, id, title, link, visibility} }. */
export async function loadTarget(req, { entity_type: type, entity_id: id }) {
  if (type === 'Project') {
    const ctx = await loadProjectContext(req, id);
    // The project itself is always visible to its portal contacts; Internal posts are filtered per comment
    return { ...ctx, record: { ...ctx.project, visibility: 'Client' }, target: { type, id, title: ctx.project.name, link: `/projects/${id}?tab=board`, visibility: 'Client' } };
  }
  if (type === 'Task') {
    const ctx = await loadTaskContext(req, id);
    return { ...ctx, target: { type, id, title: ctx.task.title, link: `/projects/${ctx.project.id}?tab=tasks&task=${id}`, visibility: ctx.task.visibility } };
  }
  if (type === 'File') {
    const ctx = await loadFileContext(req, id);
    return { ...ctx, target: { type, id, title: ctx.file.name, link: `/projects/${ctx.project.id}?tab=files&file=${id}`, visibility: ctx.file.visibility } };
  }
  throw notFound();
}

const commentInclude = {
  author_user: { select: { id: true, full_name: true, status: true, avatar_key: true } },
  author_contact: { select: { id: true, full_name: true } },
  mentions: { include: { user: { select: { id: true, full_name: true } }, contact: { select: { id: true, full_name: true } } } },
  attachments: { include: { file: { include: { versions: { where: { deleted_at: null }, orderBy: { version_no: 'desc' }, take: 1 } } } } },
  _count: { select: { replies: { where: { deleted_at: null } } } },
};

/** authorize() loader for /comments/:commentId. record = the comment (isOwn, visibility). */
export async function loadCommentContext(req) {
  const id = req.params.commentId;
  const comment = isUuid(id) ? await db.comment.findFirst({ where: { id, workspace_id: req.principal.workspace_id }, include: commentInclude }) : null;
  if (!comment) throw notFound('Comment not found');
  const ctx = await loadTarget(req, { entity_type: comment.entity_type, entity_id: comment.entity_id });
  return { ...ctx, comment, record: comment };
}

function toCommentDto(c, viewer, ctx) {
  const deleted = Boolean(c.deleted_at);
  const full = ctx ? { ...ctx, record: c } : null;
  return {
    id: c.id,
    entity_type: c.entity_type,
    entity_id: c.entity_id,
    parent_id: c.parent_comment_id,
    // FR-COM-04: a deleted comment shows as a placeholder
    body: deleted ? null : c.body,
    deleted,
    visibility: c.visibility,
    author: c.author_user ? { kind: 'user', id: c.author_user.id, full_name: c.author_user.full_name, has_avatar: Boolean(c.author_user.avatar_key) } : c.author_contact ? { kind: 'contact', id: c.author_contact.id, full_name: c.author_contact.full_name } : null,
    mentions: deleted ? [] : c.mentions.map((m) => m.user ?? m.contact).filter(Boolean),
    attachments: deleted
      ? []
      : c.attachments
          .filter((a) => !a.file.deleted_at && (viewer.kind !== 'contact' || a.file.visibility === 'Client'))
          .map((a) => ({ file_id: a.file.id, name: a.file.name, mime_type: a.file.versions[0]?.mime_type ?? null, scan_status: a.file.versions[0]?.scan_status ?? null, version_no: a.file.versions[0]?.version_no ?? null })),
    edited: Boolean(c.edited_at),
    reply_count: c._count?.replies ?? 0,
    created_at: c.created_at,
    version: c.version,
    permissions: full && !deleted ? { edit: can(viewer, 'comment.update', full) && editable(c), delete: can(viewer, 'comment.delete', full) } : { edit: false, delete: false },
  };
}

const editable = (c) => Date.now() - new Date(c.created_at).getTime() <= COMMENT_EDIT_WINDOW_HOURS * 3_600_000; // D-34 (a)

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listComments(viewer, ctx, q) {
  const board = q.entity_type === 'Project';
  const where = {
    entity_type: q.entity_type,
    entity_id: q.entity_id,
    parent_comment_id: q.parent_id ?? null,
    ...(viewer.kind === 'contact' ? { visibility: 'Client' } : {}), // BR-COM-01
  };
  const [rows, total] = await Promise.all([
    db.comment.findMany({
      where,
      include: commentInclude,
      // The message board shows the newest post first; threads read oldest first
      orderBy: board && !q.parent_id ? [{ created_at: 'desc' }, { id: 'desc' }] : [{ created_at: 'asc' }, { id: 'asc' }],
      skip: (q.page - 1) * q.page_size,
      take: q.page_size,
    }),
    db.comment.count({ where }),
  ]);
  return { data: rows.map((c) => toCommentDto(c, viewer, ctx)), page: q.page, page_size: q.page_size, total };
}

/** "@" picker (FR-COM-03): active internal members; contacts only for Client comments. */
export async function mentionable(ctx) {
  const [users, contacts] = await Promise.all([
    db.projectMember.findMany({
      where: { project_id: ctx.project.id, user_id: { not: null }, user: { status: 'Active' } },
      include: { user: { select: { id: true, full_name: true, role: true } } },
      orderBy: { user: { full_name: 'asc' } },
    }),
    ctx.project.portal_enabled
      ? db.projectMember.findMany({
          where: { project_id: ctx.project.id, contact_id: { not: null }, contact: { portal_access: true, anonymised_at: null } },
          include: { contact: { select: { id: true, full_name: true } } },
          orderBy: { contact: { full_name: 'asc' } },
        })
      : [],
  ]);
  return { data: users.map((m) => m.user), contacts: contacts.map((m) => m.contact) };
}

/** FR-COM-03: contacts can be mentioned only in Client comments, and only if they are on the project. */
async function checkContactMentions(ctx, ids, visibility) {
  const wanted = [...new Set(ids ?? [])];
  if (!wanted.length) return [];
  if (visibility !== 'Client') throw fieldError('mention_contact_ids', 'Client contacts can be mentioned only in comments visible to the client');
  const rows = await db.projectMember.findMany({ where: { project_id: ctx.project.id, contact_id: { in: wanted }, contact: { portal_access: true, anonymised_at: null } }, select: { contact_id: true } });
  if (rows.length !== wanted.length) throw fieldError('mention_contact_ids', 'Mention contacts who use the portal for this project');
  return wanted;
}

/** Where a contact opens the commented item in the portal. */
export function portalLinkFor(ctx, commentId) {
  const base = `/portal/projects/${ctx.project.id}`;
  const tail = commentId ? `&comment=${commentId}` : '';
  if (ctx.target.type === 'Task') return `${base}?task=${ctx.target.id}${tail}`;
  if (ctx.target.type === 'File') return `${base}?tab=files&file=${ctx.target.id}${tail}`;
  return `${base}?tab=messages${tail}`;
}

// ---------------------------------------------------------------------------
// Rules shared by create and edit
// ---------------------------------------------------------------------------

function cleanBody(body) {
  const html = cleanRichText(body);
  const text = html ? visibleText(html) : '';
  if (!text.trim()) throw fieldError('body', 'Write a comment');
  if (text.length > COMMENT_MAX_CHARS) throw fieldError('body', `Comments can be at most ${COMMENT_MAX_CHARS.toLocaleString('en')} characters`);
  return { html, text };
}

/**
 * BR-COM-02: everyone mentioned must be able to read the item. People who are not
 * on the project are listed, so the UI can offer "Add to project" (if allowed).
 */
async function checkMentions(viewer, ctx, userIds) {
  const ids = [...new Set(userIds ?? [])];
  if (!ids.length) return [];
  const users = await db.user.findMany({ where: { id: { in: ids }, workspace_id: viewer.workspace_id, status: 'Active' } });
  const problems = [];
  for (const id of ids) {
    const u = users.find((x) => x.id === id);
    if (!u) {
      problems.push({ field: 'mention_user_ids', message: 'This person cannot be mentioned' });
      continue;
    }
    const principal = { kind: 'user', id: u.id, role: u.role, workspace_id: u.workspace_id };
    const membership = await membershipOf(principal, ctx.project.id);
    if (!can(principal, 'comment.read', { ...ctx, membership })) problems.push({ field: 'mention_user_ids', message: `${u.full_name} is not on this project`, user_id: u.id });
  }
  if (problems.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Some people you mentioned cannot see this item. Add them to the project first.', problems);
  }
  return users.map((u) => u.id);
}

async function checkAttachments(ctx, fileIds, visibility) {
  const ids = [...new Set(fileIds ?? [])];
  if (!ids.length) return [];
  if (ids.length > COMMENT_MAX_ATTACHMENTS) throw fieldError('attachment_file_ids', `At most ${COMMENT_MAX_ATTACHMENTS} files per comment`);
  const files = await db.file.findMany({ where: { id: { in: ids }, project_id: ctx.project.id, deleted_at: null }, select: { id: true, visibility: true } });
  if (files.length !== ids.length) throw fieldError('attachment_file_ids', 'Attach files of this project');
  // BR-COM-01: a Client comment cannot carry Internal files
  if (visibility === 'Client' && files.some((f) => f.visibility !== 'Client')) throw fieldError('attachment_file_ids', 'Share the attached files with the client first, or make the comment Internal');
  return ids;
}

const mentionLink = (ctx, commentId) => `${ctx.target.link}${ctx.target.link.includes('?') ? '&' : '?'}comment=${commentId}`;

/** Mentioned people and followers hear about a comment; never the author (BR-NOT-01). */
async function notifyComment(tx, viewer, ctx, comment, { text, mentioned, mentionedContacts = [], thread }) {
  const internal = comment.visibility !== 'Client';
  const snippet = text.length > 200 ? `${text.slice(0, 197)}…` : text;
  const base = { workspaceId: ctx.project.workspace_id, actorId: viewer.id, internal, entityType: ctx.target.type, entityId: ctx.target.id };
  const payload = (title) => ({ title, subject: title, text: `${viewer.full_name}: "${snippet}"`, link: mentionLink(ctx, comment.id), actor_name: viewer.full_name, project_code: ctx.project.code });
  // Contacts get portal links and reply to the PM (BR-NOT-02)
  const pm = internal ? null : await tx.user.findUnique({ where: { id: ctx.project.pm_user_id }, select: { email: true } });
  const contactPayload = (title) => ({ title, subject: title, text: `${viewer.full_name}: "${snippet}"`, link: portalLinkFor(ctx, comment.id), reply_to: pm?.email });
  const mentionTitle = `${viewer.full_name} mentioned you on "${ctx.target.title}"`;
  await notify(tx, { ...base, event: 'mentioned', userIds: mentioned, payload: payload(mentionTitle) });
  await notify(tx, { ...base, event: 'mentioned', contactIds: mentionedContacts, payload: contactPayload(mentionTitle) });
  const followers = await followersOf(thread.type, thread.id, tx);
  const commentTitle = `${viewer.full_name} commented on "${ctx.target.title}"`;
  await notify(tx, { ...base, event: 'comment_on_followed', userIds: followers.userIds.filter((id) => !mentioned.includes(id)), payload: payload(commentTitle) });
  await notify(tx, { ...base, event: 'comment_on_followed', contactIds: followers.contactIds.filter((id) => !mentionedContacts.includes(id)), payload: contactPayload(commentTitle) });
}

// ---------------------------------------------------------------------------
// Create, edit, delete
// ---------------------------------------------------------------------------

export async function createComment(viewer, ctx, body, req) {
  assertWritable(ctx.project);
  const { html, text } = cleanBody(body.body);

  // FR-COM-02: contacts always post Client comments; internal users default to Internal
  let visibility = viewer.kind === 'contact' ? 'Client' : (body.visibility ?? 'Internal');
  if (visibility === 'Client' && ctx.target.visibility !== 'Client') throw fieldError('visibility', 'This item is internal, so its comments stay internal');

  let parent = null;
  if (body.parent_id) {
    if (ctx.target.type !== 'Project') throw fieldError('parent_id', 'Replies are only for message-board posts');
    parent = await db.comment.findFirst({ where: { id: body.parent_id, entity_type: 'Project', entity_id: ctx.project.id, parent_comment_id: null, deleted_at: null } });
    if (!parent) throw fieldError('parent_id', 'Reply to a post of this project'); // D-34 (d): one reply level
    if (parent.visibility === 'Internal') {
      if (body.visibility === 'Client') throw fieldError('visibility', 'Replies to an internal post stay internal');
      visibility = 'Internal';
    }
  }

  const mentioned = viewer.kind === 'user' ? await checkMentions(viewer, ctx, body.mention_user_ids) : [];
  const mentionedContacts = viewer.kind === 'user' ? await checkContactMentions(ctx, body.mention_contact_ids, visibility) : [];
  const attachments = await checkAttachments(ctx, body.attachment_file_ids, visibility);

  const created = await db.$transaction(async (tx) => {
    const c = await tx.comment.create({
      data: {
        workspace_id: ctx.project.workspace_id,
        project_id: ctx.project.id,
        entity_type: ctx.target.type,
        entity_id: ctx.target.id,
        parent_comment_id: parent?.id ?? null,
        author_user_id: viewer.kind === 'user' ? viewer.id : null,
        author_contact_id: viewer.kind === 'contact' ? viewer.id : null,
        body: html,
        visibility,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    if (mentioned.length) {
      await tx.mention.createMany({ data: mentioned.map((user_id) => ({ workspace_id: c.workspace_id, comment_id: c.id, user_id, created_by: viewer.id, updated_by: viewer.id })) });
    }
    if (mentionedContacts.length) {
      await tx.mention.createMany({ data: mentionedContacts.map((contact_id) => ({ workspace_id: c.workspace_id, comment_id: c.id, contact_id, created_by: viewer.id, updated_by: viewer.id })) });
    }
    if (attachments.length) {
      await tx.commentAttachment.createMany({ data: attachments.map((file_id) => ({ workspace_id: c.workspace_id, comment_id: c.id, file_id, created_by: viewer.id, updated_by: viewer.id })) });
    }
    // FR-NOT-05: the commenter follows the item (board: the post's thread)
    const thread = ctx.target.type === 'Project' ? { type: parent ? 'Comment' : 'Project', id: parent?.id ?? ctx.project.id } : { type: ctx.target.type, id: ctx.target.id };
    const followAs = ctx.target.type === 'Project' ? { type: 'Comment', id: parent?.id ?? c.id } : thread;
    await notifyComment(tx, viewer, ctx, c, { text, mentioned, mentionedContacts, thread });
    await follow(tx, { workspaceId: c.workspace_id, entityType: followAs.type, entityId: followAs.id, userIds: viewer.kind === 'user' ? [viewer.id] : [], contactIds: viewer.kind === 'contact' ? [viewer.id] : [], actorId: viewer.id });
    await writeAudit(
      { req, action: parent ? 'comment.replied' : 'comment.created', entityType: 'Comment', entityId: c.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { on: ctx.target.type, on_id: ctx.target.id, on_title: ctx.target.title, visibility, mentions: mentioned.length + mentionedContacts.length, attachments: attachments.length } },
      tx,
    );
    return c;
  });
  const row = await db.comment.findUniqueOrThrow({ where: { id: created.id }, include: commentInclude });
  return toCommentDto(row, viewer, ctx);
}

export async function updateComment(viewer, ctx, { body, mention_user_ids: mentionIds, version }, req) {
  const c = ctx.comment;
  assertWritable(ctx.project);
  if (c.deleted_at) throw notFound('Comment not found');
  if (!editable(c)) throw conflict(`Comments can be edited for ${COMMENT_EDIT_WINDOW_HOURS} hours after posting`); // FR-COM-04
  const { html, text } = cleanBody(body);
  const already = c.mentions.map((m) => m.user_id).filter(Boolean);
  const mentioned = mentionIds !== undefined ? await checkMentions(viewer, ctx, mentionIds) : already;
  const added = mentioned.filter((id) => !already.includes(id));

  await db.$transaction(async (tx) => {
    const res = await tx.comment.updateMany({ where: { id: c.id, version, deleted_at: null }, data: { body: html, edited_at: new Date(), version: { increment: 1 }, updated_by: viewer.id } });
    if (res.count !== 1) throw staleUpdate();
    if (mentionIds !== undefined) {
      await tx.mention.deleteMany({ where: { comment_id: c.id, user_id: { notIn: mentioned } } });
      if (added.length) await tx.mention.createMany({ data: added.map((user_id) => ({ workspace_id: c.workspace_id, comment_id: c.id, user_id, created_by: viewer.id, updated_by: viewer.id })) });
    }
    // Only people newly mentioned are told; followers already heard about this comment
    if (added.length) {
      await notify(tx, {
        workspaceId: c.workspace_id,
        event: 'mentioned',
        actorId: viewer.id,
        userIds: added,
        internal: c.visibility !== 'Client',
        entityType: ctx.target.type,
        entityId: ctx.target.id,
        payload: { title: `${viewer.full_name} mentioned you on "${ctx.target.title}"`, subject: `${viewer.full_name} mentioned you on "${ctx.target.title}"`, text: `${viewer.full_name}: "${text.slice(0, 200)}"`, link: mentionLink(ctx, c.id), actor_name: viewer.full_name },
      });
    }
    await writeAudit({ req, action: 'comment.edited', entityType: 'Comment', entityId: c.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { on: ctx.target.type, on_id: ctx.target.id, on_title: ctx.target.title } }, tx);
  });
  const row = await db.comment.findUniqueOrThrow({ where: { id: c.id }, include: commentInclude });
  return toCommentDto(row, viewer, ctx);
}

export async function deleteComment(viewer, ctx, req) {
  const c = ctx.comment;
  assertWritable(ctx.project);
  if (c.deleted_at) return;
  await db.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: c.id }, data: { deleted_at: new Date(), version: { increment: 1 }, updated_by: viewer.id } });
    await writeAudit({ req, action: 'comment.deleted', entityType: 'Comment', entityId: c.id, projectId: ctx.project.id, clientId: ctx.project.client_id, after: { on: ctx.target.type, on_id: ctx.target.id, on_title: ctx.target.title, by_author: c.created_by === viewer.id } }, tx);
  });
}
