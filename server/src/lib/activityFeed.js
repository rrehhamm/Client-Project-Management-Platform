// Reads activity entries for feeds (FR-ACT-01), newest first, with actor names.
// IP and user agent are left out: they belong to the admin audit view (FR-ACT-02, Phase 4).
import { db } from './db.js';

export async function listActivity(where, { page, page_size: pageSize }) {
  const [rows, total] = await Promise.all([
    db.activityLog.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.activityLog.count({ where }),
  ]);

  const userIds = [...new Set(rows.filter((r) => r.actor_type === 'User' && r.actor_id).map((r) => r.actor_id))];
  const contactIds = [...new Set(rows.filter((r) => r.actor_type === 'Contact' && r.actor_id).map((r) => r.actor_id))];
  const [users, contacts] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } }) : [],
    contactIds.length ? db.clientContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, full_name: true } }) : [],
  ]);
  const names = new Map([...users, ...contacts].map((x) => [x.id, x.full_name]));

  return {
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      project_id: r.project_id,
      client_id: r.client_id,
      actor: { type: r.actor_type, id: r.actor_id, name: r.actor_id ? (names.get(r.actor_id) ?? null) : null },
      before: r.before,
      after: r.after,
      created_at: r.created_at,
    })),
    page,
    page_size: pageSize,
    total,
  };
}
