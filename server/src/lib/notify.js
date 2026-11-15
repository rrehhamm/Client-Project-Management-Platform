// Notifications (FR-NOT-01/02/03) and follows (FR-NOT-05).
// notify() runs inside the caller's transaction: the in-app rows and the email
// outbox rows commit together with the change they describe. The outbox worker
// (jobs/outbox.js) sends the emails afterwards, so a slow mail server never
// blocks a request.
import { CONTACT_NOTIFICATION_EVENTS, DEFAULT_CONTACT_NOTIFICATION_PREFS, DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_EVENTS } from '@cpm/shared';
import { db } from './db.js';

/** The channel a user wants for an event: 'email' (in-app + email), 'in_app' or 'off'. */
export function channelFor(prefs, event) {
  const value = prefs && typeof prefs === 'object' ? prefs[event] : undefined;
  return value ?? DEFAULT_NOTIFICATION_PREFS[event] ?? 'in_app';
}

/** A contact's channel for an event (portal settings; unknown events: in-app). */
export function contactChannelFor(prefs, event) {
  const value = prefs && typeof prefs === 'object' ? prefs[event] : undefined;
  return value ?? DEFAULT_CONTACT_NOTIFICATION_PREFS[event] ?? 'in_app';
}
export const effectiveContactPrefs = (prefs) => Object.fromEntries(CONTACT_NOTIFICATION_EVENTS.map((e) => [e, contactChannelFor(prefs, e)]));

/** Saved preferences merged over the defaults (FR-NOT-03). */
export const effectivePrefs = (prefs) => Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, channelFor(prefs, e)]));

/**
 * Notify people about one event.
 * @param {object} tx  Prisma transaction (or db)
 * @param {object} n
 * @param {string} n.workspaceId
 * @param {string} n.event  one of NOTIFICATION_EVENTS
 * @param {string|null} n.actorId  who caused it; never notified (BR-NOT-01)
 * @param {string[]} [n.userIds]
 * @param {string[]} [n.contactIds]  BR-COM-01: ignored when n.internal is true
 * @param {boolean} [n.internal]  the content is Internal: never reaches Client Contacts
 * @param {string} n.entityType
 * @param {string} n.entityId
 * @param {object} n.payload  { title, text, link, project_code?, actor_name? } shown in-app and in email
 * @returns {Promise<number>} people notified
 */
export async function notify(tx, { workspaceId, event, actorId = null, userIds = [], contactIds = [], internal = false, entityType, entityId, payload }) {
  const users = [...new Set(userIds)].filter((id) => id && id !== actorId);
  const contacts = internal ? [] : [...new Set(contactIds)].filter((id) => id && id !== actorId);
  if (!users.length && !contacts.length) return 0;

  const rows = [];
  if (users.length) {
    const people = await tx.user.findMany({ where: { id: { in: users }, workspace_id: workspaceId, status: 'Active' }, select: { id: true, notification_prefs: true } });
    for (const u of people) {
      const channel = channelFor(u.notification_prefs, event);
      if (channel === 'off') continue;
      rows.push({ user_id: u.id, channel: 'InApp' });
      if (channel === 'email') rows.push({ user_id: u.id, channel: 'Email' });
    }
  }
  if (contacts.length) {
    // Only contacts who can sign in to the portal (FR-CON-05, NFR-PRIV-02), with their own settings
    const people = await tx.clientContact.findMany({
      where: { id: { in: contacts }, workspace_id: workspaceId, portal_access: true, anonymised_at: null, client: { archived_at: null } },
      select: { id: true, notification_prefs: true },
    });
    for (const c of people) {
      const channel = contactChannelFor(c.notification_prefs, event);
      if (channel === 'off') continue;
      rows.push({ contact_id: c.id, channel: 'InApp' });
      if (channel === 'email') rows.push({ contact_id: c.id, channel: 'Email' });
    }
  }
  if (!rows.length) return 0;

  await tx.notification.createMany({
    data: rows.map((r) => ({
      workspace_id: workspaceId,
      user_id: r.user_id ?? null,
      contact_id: r.contact_id ?? null,
      type: event,
      entity_type: entityType,
      entity_id: entityId,
      payload,
      channel: r.channel,
      // In-app rows are "delivered" when written; email rows wait for the outbox
      sent_at: r.channel === 'InApp' ? new Date() : null,
      created_by: actorId,
      updated_by: actorId,
    })),
  });
  return new Set(rows.map((r) => r.user_id ?? r.contact_id)).size;
}

/** Add followers (FR-NOT-05). Existing follows are kept. */
export async function follow(tx, { workspaceId, entityType, entityId, userIds = [], contactIds = [], actorId = null }) {
  const data = [
    ...[...new Set(userIds)].filter(Boolean).map((user_id) => ({ user_id })),
    ...[...new Set(contactIds)].filter(Boolean).map((contact_id) => ({ contact_id })),
  ].map((who) => ({ workspace_id: workspaceId, entity_type: entityType, entity_id: entityId, created_by: actorId, updated_by: actorId, ...who }));
  if (data.length) await tx.follower.createMany({ data, skipDuplicates: true });
}

/** Followers of one record: { userIds, contactIds }. */
export async function followersOf(entityType, entityId, client = db) {
  const rows = await client.follower.findMany({ where: { entity_type: entityType, entity_id: entityId }, select: { user_id: true, contact_id: true } });
  return { userIds: rows.map((r) => r.user_id).filter(Boolean), contactIds: rows.map((r) => r.contact_id).filter(Boolean) };
}
