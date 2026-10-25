// Project structure: milestones, tasks (with subtasks), checklists, dependencies
// and default members, with dates as day offsets from the project start.
// Used to save templates (FR-PRJ-03), create from them (FR-PRJ-02) and to
// duplicate projects (FR-PRJ-12). Never carries assignees, comments, files or
// time (D-26).
import { PROJECT_ROLE, USER_STATUS } from '@cpm/shared';
import { fromDbDate, toDbDate } from '../../lib/dates.js';
import { recalculateProgress } from '../projects/common.js';
import { POSITION_GAP } from '../tasks/common.js';

const DAY = 86_400_000;
const offsetOf = (date, start) => (date ? Math.round((Date.parse(`${fromDbDate(date)}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) : null);
const dateAt = (start, offset) => (offset === null || offset === undefined ? null : new Date(Date.parse(`${start}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10));

/** Read a project's structure (deleted items are left out). */
export async function snapshotProject(tx, project) {
  const start = fromDbDate(project.start_date);
  const [milestones, tasks, checklist, deps, members] = await Promise.all([
    tx.milestone.findMany({ where: { project_id: project.id, deleted_at: null }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }),
    tx.task.findMany({ where: { project_id: project.id, deleted_at: null }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] }),
    tx.taskChecklistItem.findMany({ where: { task: { project_id: project.id, deleted_at: null } }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] }),
    tx.taskDependency.findMany({ where: { successor: { project_id: project.id, deleted_at: null }, predecessor: { deleted_at: null } } }),
    tx.projectMember.findMany({ where: { project_id: project.id, user_id: { not: null } }, select: { user_id: true } }),
  ]);
  const taskIds = new Set(tasks.map((t) => t.id));
  return {
    milestones: milestones.map((m) => ({
      key: m.id,
      title: m.title,
      description: m.description,
      due_offset_days: offsetOf(m.due_date, start),
      amount: m.amount,
      visibility: m.visibility,
      sort_order: m.sort_order,
    })),
    tasks: tasks
      .filter((t) => !t.parent_task_id || taskIds.has(t.parent_task_id))
      .map((t) => ({
        key: t.id,
        parent_key: t.parent_task_id,
        milestone_key: t.milestone_id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        visibility: t.visibility,
        estimate_minutes: t.estimate_minutes,
        is_billable: t.is_billable,
        labels: t.labels,
        start_offset_days: offsetOf(t.start_date, start),
        due_offset_days: offsetOf(t.due_date, start),
        sort_order: t.sort_order,
        checklist: checklist.filter((c) => c.task_id === t.id).map((c) => c.text),
        predecessor_keys: deps.filter((d) => d.successor_id === t.id && taskIds.has(d.predecessor_id)).map((d) => d.predecessor_id),
      })),
    member_user_ids: members.map((m) => m.user_id),
  };
}

/** Write a structure as template rows. */
export async function writeTemplateRows(tx, template, structure, viewer) {
  const audit = { workspace_id: template.workspace_id, template_id: template.id, created_by: viewer.id, updated_by: viewer.id };
  const msIds = new Map();
  for (const m of structure.milestones) {
    const row = await tx.templateMilestone.create({
      data: { ...audit, title: m.title, description: m.description, due_offset_days: m.due_offset_days ?? 0, amount: m.amount, visibility: m.visibility, sort_order: m.sort_order },
    });
    msIds.set(m.key, row.id);
  }
  const taskIds = new Map();
  const ordered = [...structure.tasks.filter((t) => !t.parent_key), ...structure.tasks.filter((t) => t.parent_key)];
  for (const t of ordered) {
    const row = await tx.templateTask.create({
      data: {
        ...audit,
        parent_id: t.parent_key ? taskIds.get(t.parent_key) : null,
        template_milestone_id: t.milestone_key ? (msIds.get(t.milestone_key) ?? null) : null,
        title: t.title,
        description: t.description,
        priority: t.priority,
        visibility: t.visibility,
        estimate_minutes: t.estimate_minutes,
        is_billable: t.is_billable,
        labels: t.labels,
        start_offset_days: t.start_offset_days,
        due_offset_days: t.due_offset_days,
        sort_order: t.sort_order,
        checklist: t.checklist,
      },
    });
    taskIds.set(t.key, row.id);
  }
  // Dependencies point at template task ids
  for (const t of structure.tasks) {
    const preds = t.predecessor_keys.map((k) => taskIds.get(k)).filter(Boolean);
    if (preds.length) await tx.templateTask.update({ where: { id: taskIds.get(t.key) }, data: { predecessor_ids: preds } });
  }
  if (structure.member_user_ids.length) {
    await tx.templateMember.createMany({ data: [...new Set(structure.member_user_ids)].map((user_id) => ({ ...audit, user_id })), skipDuplicates: true });
  }
}

/** Read a template back into a structure. */
export async function structureFromTemplate(tx, templateId) {
  const [milestones, tasks, members] = await Promise.all([
    tx.templateMilestone.findMany({ where: { template_id: templateId }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }),
    tx.templateTask.findMany({ where: { template_id: templateId }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }),
    tx.templateMember.findMany({ where: { template_id: templateId }, select: { user_id: true } }),
  ]);
  return {
    milestones: milestones.map((m) => ({ key: m.id, title: m.title, description: m.description, due_offset_days: m.due_offset_days, amount: m.amount, visibility: m.visibility, sort_order: m.sort_order })),
    tasks: tasks.map((t) => ({
      key: t.id,
      parent_key: t.parent_id,
      milestone_key: t.template_milestone_id,
      title: t.title,
      description: t.description,
      priority: t.priority,
      visibility: t.visibility,
      estimate_minutes: t.estimate_minutes,
      is_billable: t.is_billable,
      labels: t.labels,
      start_offset_days: t.start_offset_days,
      due_offset_days: t.due_offset_days,
      sort_order: t.sort_order,
      checklist: t.checklist,
      predecessor_keys: t.predecessor_ids,
    })),
    member_user_ids: members.map((m) => m.user_id),
  };
}

/**
 * Create the structure inside `project` (dates shifted to its start date).
 * Default members are added only if still active (D-26). Milestone amounts are
 * kept only for Fixed projects (FR-MS-04).
 */
export async function applyStructure(tx, structure, project, viewer) {
  const start = fromDbDate(project.start_date);
  const base = { workspace_id: project.workspace_id, project_id: project.id, created_by: viewer.id, updated_by: viewer.id };

  const activeUsers = new Set(
    (await tx.user.findMany({ where: { id: { in: structure.member_user_ids }, workspace_id: project.workspace_id, status: USER_STATUS.ACTIVE }, select: { id: true } })).map((u) => u.id),
  );
  for (const userId of structure.member_user_ids) {
    if (!activeUsers.has(userId)) continue;
    await tx.projectMember.upsert({
      where: { project_id_user_id: { project_id: project.id, user_id: userId } },
      update: {},
      create: { ...base, user_id: userId, project_role: PROJECT_ROLE.MEMBER },
    });
  }

  const msIds = new Map();
  for (const [i, m] of structure.milestones.entries()) {
    const row = await tx.milestone.create({
      data: {
        ...base,
        title: m.title,
        description: m.description,
        due_date: toDbDate(dateAt(start, m.due_offset_days ?? 0)),
        amount: project.billing_type === 'Fixed' ? m.amount : null,
        visibility: m.visibility,
        sort_order: i,
      },
    });
    msIds.set(m.key, row.id);
  }

  const taskIds = new Map();
  const tops = structure.tasks.filter((t) => !t.parent_key);
  const subs = structure.tasks.filter((t) => t.parent_key);
  const counters = new Map();
  for (const t of [...tops, ...subs]) {
    const parentId = t.parent_key ? taskIds.get(t.parent_key) : null;
    if (t.parent_key && !parentId) continue;
    const n = (counters.get(parentId) ?? 0) + 1;
    counters.set(parentId, n);
    const startDate = dateAt(start, t.start_offset_days);
    const dueDate = dateAt(start, t.due_offset_days);
    const row = await tx.task.create({
      data: {
        ...base,
        parent_task_id: parentId,
        milestone_id: t.milestone_key ? (msIds.get(t.milestone_key) ?? null) : null,
        title: t.title,
        description: t.description,
        priority: t.priority,
        visibility: t.visibility,
        estimate_minutes: t.estimate_minutes,
        is_billable: t.is_billable,
        labels: t.labels,
        start_date: toDbDate(startDate),
        due_date: toDbDate(dueDate && startDate && dueDate < startDate ? startDate : dueDate),
        sort_order: n * POSITION_GAP,
      },
    });
    taskIds.set(t.key, row.id);
    if (t.checklist.length) {
      await tx.taskChecklistItem.createMany({
        data: t.checklist.map((text, idx) => ({ workspace_id: project.workspace_id, task_id: row.id, text, sort_order: idx, created_by: viewer.id, updated_by: viewer.id })),
      });
    }
  }
  for (const t of structure.tasks) {
    const successor = taskIds.get(t.key);
    for (const key of t.predecessor_keys) {
      const predecessor = taskIds.get(key);
      if (successor && predecessor) {
        await tx.taskDependency.create({ data: { workspace_id: project.workspace_id, predecessor_id: predecessor, successor_id: successor, created_by: viewer.id, updated_by: viewer.id } });
      }
    }
  }
  await recalculateProgress(project.id, tx);
  return { milestones: msIds.size, tasks: taskIds.size };
}
