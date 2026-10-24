// The platform runs one workspace for now (DECISIONS.md D-05). Requests without a
// signed-in principal (login, forgot password) are attributed to it.
import { db } from './db.js';

let cachedId = null;

export async function getDefaultWorkspaceId() {
  if (cachedId) return cachedId;
  const ws = await db.workspace.findFirst({ orderBy: { created_at: 'asc' }, select: { id: true } });
  if (!ws) throw new Error('No workspace exists. Run `npm run db:seed -w server`.');
  cachedId = ws.id;
  return cachedId;
}

export function getWorkspace(id) {
  return db.workspace.findUniqueOrThrow({ where: { id } });
}
