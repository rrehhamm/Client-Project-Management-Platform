// Project templates: FR-PRJ-02/03, D-26.
import { pick, writeAudit } from '../../lib/audit.js';
import { db } from '../../lib/db.js';
import { conflict, fieldError, notFound, staleUpdate } from '../../lib/errors.js';
import { isUuid } from '../../lib/validate.js';
import { snapshotProject, writeTemplateRows } from './structure.js';

const normalize = (n) => n.trim().toLowerCase();
const duplicate = () => conflict('A template with this name already exists', [{ field: 'name', message: 'Already used' }]); // FR-PRJ-03

async function counts(templateIds) {
  if (!templateIds.length) return new Map();
  const [ms, tasks, members] = await Promise.all([
    db.templateMilestone.groupBy({ by: ['template_id'], where: { template_id: { in: templateIds } }, _count: { _all: true } }),
    db.templateTask.groupBy({ by: ['template_id'], where: { template_id: { in: templateIds } }, _count: { _all: true } }),
    db.templateMember.groupBy({ by: ['template_id'], where: { template_id: { in: templateIds } }, _count: { _all: true } }),
  ]);
  const get = (rows, id) => rows.find((r) => r.template_id === id)?._count._all ?? 0;
  return new Map(templateIds.map((id) => [id, { milestones: get(ms, id), tasks: get(tasks, id), members: get(members, id) }]));
}

const toDto = (t, c) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  billing_type: t.billing_type,
  source_project_id: t.source_project_id,
  counts: c ?? { milestones: 0, tasks: 0, members: 0 },
  created_at: t.created_at,
  updated_at: t.updated_at,
  version: t.version,
});

export async function findTemplate(workspaceId, id) {
  const t = isUuid(id) ? await db.projectTemplate.findFirst({ where: { id, workspace_id: workspaceId } }) : null;
  if (!t) throw notFound('Template not found');
  return t;
}

export async function listTemplates(viewer) {
  const rows = await db.projectTemplate.findMany({ where: { workspace_id: viewer.workspace_id }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 });
  const c = await counts(rows.map((r) => r.id));
  return { data: rows.map((r) => toDto(r, c.get(r.id))) };
}

export async function getTemplate(viewer, template) {
  const [c, milestones, tasks] = await Promise.all([
    counts([template.id]),
    db.templateMilestone.findMany({ where: { template_id: template.id }, orderBy: { sort_order: 'asc' } }),
    db.templateTask.findMany({ where: { template_id: template.id, parent_id: null }, orderBy: { sort_order: 'asc' }, take: 200 }),
  ]);
  return {
    ...toDto(template, c.get(template.id)),
    milestones: milestones.map((m) => ({ id: m.id, title: m.title, due_offset_days: m.due_offset_days })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, due_offset_days: t.due_offset_days })),
  };
}

/** FR-PRJ-03: save a project's structure as a new template. */
export async function saveTemplate(viewer, ctx, { name, description }, req) {
  const { project } = ctx;
  if (await db.projectTemplate.findFirst({ where: { workspace_id: viewer.workspace_id, name_normalized: normalize(name) }, select: { id: true } })) throw duplicate();
  const created = await db.$transaction(async (tx) => {
    const structure = await snapshotProject(tx, project);
    const template = await tx.projectTemplate.create({
      data: {
        workspace_id: viewer.workspace_id,
        name,
        name_normalized: normalize(name),
        description: description ?? null,
        billing_type: project.billing_type,
        source_project_id: project.id,
        created_by: viewer.id,
        updated_by: viewer.id,
      },
    });
    await writeTemplateRows(tx, template, structure, viewer);
    await writeAudit(
      { req, action: 'template.created', entityType: 'ProjectTemplate', entityId: template.id, projectId: project.id, clientId: project.client_id, after: { name, milestones: structure.milestones.length, tasks: structure.tasks.length } },
      tx,
    );
    return template;
  });
  return getTemplate(viewer, created);
}

export async function updateTemplate(viewer, template, { version, ...changes }, req) {
  if (changes.name !== undefined && normalize(changes.name) !== template.name_normalized) {
    if (await db.projectTemplate.findFirst({ where: { workspace_id: viewer.workspace_id, name_normalized: normalize(changes.name), id: { not: template.id } }, select: { id: true } })) throw duplicate();
  }
  const data = { ...changes, version: { increment: 1 }, updated_by: viewer.id };
  if (changes.name !== undefined) data.name_normalized = normalize(changes.name);
  const res = await db.projectTemplate.updateMany({ where: { id: template.id, version }, data });
  if (res.count !== 1) throw staleUpdate();
  const after = await db.projectTemplate.findUniqueOrThrow({ where: { id: template.id } });
  await writeAudit({ req, action: 'template.updated', entityType: 'ProjectTemplate', entityId: template.id, before: pick(template, ['name', 'description']), after: pick(after, ['name', 'description']) });
  return getTemplate(viewer, after);
}

export async function deleteTemplate(_viewer, template, req) {
  await db.$transaction(async (tx) => {
    await tx.projectTemplate.delete({ where: { id: template.id } }); // rows cascade; projects keep a null source
    await writeAudit({ req, action: 'template.deleted', entityType: 'ProjectTemplate', entityId: template.id, before: { name: template.name } }, tx);
  });
}

/** For POST /projects with template_id: the template must be in the caller's workspace. */
export async function assertTemplateUsable(workspaceId, templateId) {
  const t = await db.projectTemplate.findFirst({ where: { id: templateId, workspace_id: workspaceId }, select: { id: true } });
  if (!t) throw fieldError('template_id', 'Template not found');
}
