// FR-SRCH-01 global search: clients, projects, tasks, files and contacts by name,
// only among records the viewer may open (TC-SRCH-001), top 20 grouped by type.
import { ROLES, SEARCH_LIMIT } from '@cpm/shared';
import { can } from '../../auth/can.js';
import { clientScope, projectScope } from '../../auth/scopes.js';
import { db } from '../../lib/db.js';

const PER_TYPE = 10;

export async function search(viewer, term) {
  const like = { contains: term, mode: 'insensitive' };
  const ws = viewer.workspace_id;
  const visibleProject = { workspace_id: ws, deleted_at: null, ...projectScope(viewer) };
  const seesClients = can(viewer, 'client.list');
  // Team Members see client names only for their projects and no contact details (§4.2)
  const seesContacts = seesClients && viewer.role !== ROLES.TEAM_MEMBER;

  const [clients, projects, tasks, files, contacts] = await Promise.all([
    seesClients
      ? db.client.findMany({ where: { workspace_id: ws, ...clientScope(viewer), name: like }, select: { id: true, name: true, status: true }, orderBy: { name: 'asc' }, take: PER_TYPE })
      : [],
    db.project.findMany({ where: { ...visibleProject, OR: [{ name: like }, { code: { contains: term.toUpperCase() } }] }, select: { id: true, name: true, code: true, status: true, archived_at: true }, orderBy: { name: 'asc' }, take: PER_TYPE }),
    db.task.findMany({ where: { workspace_id: ws, deleted_at: null, title: like, project: visibleProject }, select: { id: true, title: true, status: true, project: { select: { id: true, code: true } } }, orderBy: { updated_at: 'desc' }, take: PER_TYPE }),
    db.file.findMany({ where: { workspace_id: ws, deleted_at: null, name: like, project: visibleProject, versions: { some: { deleted_at: null } } }, select: { id: true, name: true, project: { select: { id: true, code: true } } }, orderBy: { updated_at: 'desc' }, take: PER_TYPE }),
    seesContacts
      ? db.clientContact.findMany({ where: { workspace_id: ws, client: clientScope(viewer), OR: [{ full_name: like }, { email: like }] }, select: { id: true, full_name: true, email: true, client: { select: { id: true, name: true } } }, orderBy: { full_name: 'asc' }, take: PER_TYPE })
      : [],
  ]);

  // Top 20 overall, keeping every type represented in order
  const groups = [
    ['clients', clients.map((c) => ({ id: c.id, title: c.name, subtitle: c.status, link: `/clients/${c.id}` }))],
    ['projects', projects.map((p) => ({ id: p.id, title: p.name, subtitle: p.code, link: `/projects/${p.id}` }))],
    ['tasks', tasks.map((t) => ({ id: t.id, title: t.title, subtitle: t.project.code, link: `/projects/${t.project.id}?tab=tasks&task=${t.id}` }))],
    ['files', files.map((f) => ({ id: f.id, title: f.name, subtitle: f.project.code, link: `/projects/${f.project.id}?tab=files&file=${f.id}` }))],
    ['contacts', contacts.map((c) => ({ id: c.id, title: c.full_name, subtitle: `${c.client.name} · ${c.email}`, link: `/clients/${c.client.id}?tab=contacts` }))],
  ];
  let left = SEARCH_LIMIT;
  const out = {};
  // Round-robin, so one busy type cannot push the others out
  const taken = Object.fromEntries(groups.map(([k]) => [k, []]));
  for (let i = 0; left > 0 && groups.some(([, items]) => items.length > i); i += 1) {
    for (const [key, items] of groups) {
      if (left > 0 && items[i]) {
        taken[key].push(items[i]);
        left -= 1;
      }
    }
  }
  for (const [key] of groups) out[key] = taken[key];
  return { q: term, total: SEARCH_LIMIT - left, groups: out };
}
