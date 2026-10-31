// FR-ACT-02 audit log: Owner/Admin view of every entry, with filters and CSV export.
// The log is append-only (BR-ACT-01): there is no route that changes or removes entries.
import { auditQuerySchema } from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { writeAudit } from '../../lib/audit.js';
import { addDays } from '../../lib/dates.js';
import { db } from '../../lib/db.js';
import { validateQuery } from '../../lib/validate.js';

export const CSV_MAX_ROWS = 10_000;

/** Start of a workspace-local day as a UTC instant. */
function localDayStart(iso, timeZone) {
  const guess = new Date(`${iso}T00:00:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

async function whereFor(principal, q) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: principal.workspace_id }, select: { timezone: true } });
  const created = {};
  if (q.from) created.gte = localDayStart(q.from, ws.timezone);
  if (q.to) created.lt = localDayStart(addDays(q.to, 1), ws.timezone);
  return {
    workspace_id: principal.workspace_id,
    ...(q.actor_id ? { actor_id: q.actor_id } : {}),
    ...(q.entity_type ? { entity_type: q.entity_type } : {}),
    // "task." matches every task action; a full name matches one action
    ...(q.action ? { action: q.action.endsWith('.') ? { startsWith: q.action } : q.action } : {}),
    ...(Object.keys(created).length ? { created_at: created } : {}),
  };
}

async function withActors(rows) {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
  const [users, contacts] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true, email: true } }),
    db.clientContact.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true, email: true } }),
  ]);
  const people = new Map([...users, ...contacts].map((p) => [p.id, p]));
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    actor: { type: r.actor_type, id: r.actor_id, name: people.get(r.actor_id)?.full_name ?? null, email: people.get(r.actor_id)?.email ?? null },
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    project_id: r.project_id,
    client_id: r.client_id,
    before: r.before,
    after: r.after,
    ip: r.ip,
    user_agent: r.user_agent,
    request_id: r.request_id,
  }));
}

export const auditRouter = Router();

auditRouter.get('/', authorize('audit.readAll'), validateQuery(auditQuerySchema), async (req, res) => {
  const q = req.validQuery;
  const where = await whereFor(req.principal, q);
  const [rows, total] = await Promise.all([
    db.activityLog.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.page_size, take: q.page_size }),
    db.activityLog.count({ where }),
  ]);
  res.json({ data: await withActors(rows), page: q.page, page_size: q.page_size, total });
});

/** One CSV cell. Leading = + - @ are neutralised so spreadsheets never run them as formulas. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

auditRouter.get('/export.csv', authorize('audit.readAll'), validateQuery(auditQuerySchema.omit({ page: true, page_size: true })), async (req, res) => {
  const where = await whereFor(req.principal, req.validQuery);
  const rows = await withActors(await db.activityLog.findMany({ where, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: CSV_MAX_ROWS }));
  const header = ['created_at', 'actor_type', 'actor_name', 'actor_email', 'action', 'entity_type', 'entity_id', 'project_id', 'client_id', 'before', 'after', 'ip', 'user_agent', 'request_id'];
  const lines = rows.map((r) =>
    [r.created_at.toISOString(), r.actor.type, r.actor.name, r.actor.email, r.action, r.entity_type, r.entity_id, r.project_id, r.client_id, r.before, r.after, r.ip, r.user_agent, r.request_id].map(csvCell).join(','),
  );
  await writeAudit({ req, action: 'audit.exported', entityType: 'ActivityLog', after: { filters: req.validQuery, rows: rows.length } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read the file as UTF-8
  res.send(`${BOM}${[header.join(','), ...lines].join('\r\n')}\r\n`);
});
