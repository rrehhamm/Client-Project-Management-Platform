// Append-only activity log writer (rule 9, BR-ACT-01, BR-AUTH-06).
import { ACTOR_TYPES } from '@cpm/shared';
import { db } from './db.js';
import { toPlainJson } from './json.js';
import { getDefaultWorkspaceId } from './workspace.js';

export function actorOf(principal) {
  if (!principal) return { type: ACTOR_TYPES.SYSTEM, id: null };
  return { type: principal.kind === 'contact' ? ACTOR_TYPES.CONTACT : ACTOR_TYPES.USER, id: principal.id };
}

/**
 * Write one activity log entry.
 * @param {object} entry
 * @param {import('express').Request} [entry.req]  supplies ip, user agent, request id and default actor
 * @param {{type: string, id: string|null}} [entry.actor]  overrides the actor (e.g. the user who just logged in)
 * @param {object} [client]  Prisma client or transaction
 */
export async function writeAudit(
  { req, actor, workspaceId, action, entityType, entityId = null, projectId = null, clientId = null, before, after },
  client = db,
) {
  const who = actor ?? actorOf(req?.principal);
  await client.activityLog.create({
    data: {
      workspace_id: workspaceId ?? req?.principal?.workspace_id ?? (await getDefaultWorkspaceId()),
      actor_type: who.type,
      actor_id: who.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      project_id: projectId,
      client_id: clientId,
      before: toPlainJson(before),
      after: toPlainJson(after),
      ip: req?.ip ?? null,
      user_agent: req?.get?.('user-agent')?.slice(0, 512) ?? null,
      request_id: req?.id ?? null,
      created_by: who.id,
      updated_by: who.id,
    },
  });
}

/** Keep only the listed keys (FR-ACT-02 before/after values). */
export function pick(record, keys) {
  if (!record) return null;
  return Object.fromEntries(keys.filter((k) => k in record).map((k) => [k, record[k]]));
}
