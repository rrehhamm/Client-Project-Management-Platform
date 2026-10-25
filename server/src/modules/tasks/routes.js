// /api/v1/projects/:id/tasks, /api/v1/tasks, /api/v1/me/tasks — every route goes through authorize().
import {
  checklistItemCreateSchema,
  checklistItemUpdateSchema,
  dependencyCreateSchema,
  taskBulkSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskMoveSchema,
  taskPositionSchema,
  taskStatusSchema,
  taskUpdateSchema,
} from '@cpm/shared';
import { Router } from 'express';
import { authorize, authorizeFields } from '../../auth/authorize.js';
import { validateBody, validateQuery } from '../../lib/validate.js';
import { loadProjectContext } from '../projects/common.js';
import { loadTaskContext } from './common.js';
import * as extras from './extras.js';
import * as service from './service.js';

/** D-24: which permission each PATCH field needs (rule 3). */
export const TASK_FIELD_ACTIONS = Object.freeze({
  title: 'task.editDetails',
  priority: 'task.editDetails',
  start_date: 'task.editDetails',
  due_date: 'task.editDetails',
  labels: 'task.editDetails',
  description: 'task.editWork',
  estimate_minutes: 'task.editWork',
  visibility: 'task.changeVisibility',
  apply_to_subtasks: 'task.changeVisibility',
  milestone_id: 'task.changeMilestone',
  is_billable: 'task.changeBillable',
  assignee_ids: 'task.assignSelf', // the exact add/remove rule is checked in the service (auth/taskAssignment.js)
  version: null,
});

const project = { load: (req) => loadProjectContext(req, req.params.id), readAction: 'project.read' };
const task = { load: (req) => loadTaskContext(req), readAction: 'task.read' };

// Under /projects
export const projectTasksRouter = Router();

projectTasksRouter.get('/:id/tasks', authorize('project.read', project), validateQuery(taskListQuerySchema), async (req, res) => {
  res.json(await service.listTasks(req.principal, req.ctx, req.validQuery));
});
projectTasksRouter.post('/:id/tasks', authorize('task.create', project), validateBody(taskCreateSchema), async (req, res) => {
  res.status(201).json(await service.createTask(req.principal, req.ctx, req.body, req));
});
projectTasksRouter.get('/:id/labels', authorize('project.read', project), async (req, res) => {
  res.json(await service.labelsInUse(req.ctx.project));
});

// Under /tasks
export const tasksRouter = Router();

// Bulk first, so "bulk" is not taken for a task id
tasksRouter.post('/bulk', authorize('self.internalApp'), validateBody(taskBulkSchema), async (req, res) => {
  res.json(await extras.bulkTasks(req.principal, req.body, req));
});

tasksRouter.get('/:taskId', authorize('task.read', task), async (req, res) => {
  res.json(await service.getTaskDetail(req.principal, req.ctx));
});
// Readers reach the field check; each field then needs its own permission (D-24)
tasksRouter.patch('/:taskId', authorize('task.read', task), authorizeFields(TASK_FIELD_ACTIONS), validateBody(taskUpdateSchema), async (req, res) => {
  res.json(await service.updateTask(req.principal, req.ctx, req.body, req));
});
tasksRouter.post('/:taskId/status', authorize('task.editWork', task), validateBody(taskStatusSchema), async (req, res) => {
  res.json(await service.changeTaskStatus(req.principal, req.ctx, req.body, req));
});
tasksRouter.put('/:taskId/position', authorize('task.editWork', task), validateBody(taskPositionSchema), async (req, res) => {
  res.json(await service.setTaskPosition(req.principal, req.ctx, req.body, req));
});
tasksRouter.post('/:taskId/move', authorize('task.move', task), validateBody(taskMoveSchema), async (req, res) => {
  res.json(await service.moveTask(req.principal, req.ctx, req.body, req));
});
tasksRouter.delete('/:taskId', authorize('task.delete', task), async (req, res) => {
  res.json(await service.deleteTask(req.principal, req.ctx, req));
});

tasksRouter.post('/:taskId/checklist', authorize('task.editWork', task), validateBody(checklistItemCreateSchema), async (req, res) => {
  res.status(201).json(await extras.addChecklistItem(req.principal, req.ctx, req.body, req));
});
tasksRouter.patch('/:taskId/checklist/:itemId', authorize('task.editWork', task), validateBody(checklistItemUpdateSchema), async (req, res) => {
  const item = await extras.findChecklistItem(req.ctx, req.params.itemId);
  res.json(await extras.updateChecklistItem(req.principal, req.ctx, item, req.body, req));
});
tasksRouter.delete('/:taskId/checklist/:itemId', authorize('task.editWork', task), async (req, res) => {
  const item = await extras.findChecklistItem(req.ctx, req.params.itemId);
  await extras.deleteChecklistItem(req.principal, req.ctx, item, req);
  res.status(204).end();
});

tasksRouter.post('/:taskId/dependencies', authorize('task.manageDependencies', task), validateBody(dependencyCreateSchema), async (req, res) => {
  const { predecessor, created } = await extras.addDependency(req.principal, req.ctx, req.body, req);
  res.status(created ? 201 : 200).json({ predecessor });
});
tasksRouter.delete('/:taskId/dependencies/:predecessorId', authorize('task.manageDependencies', task), async (req, res) => {
  await extras.removeDependency(req.principal, req.ctx, req.params.predecessorId, req);
  res.status(204).end();
});

// Under /me
export const meRouter = Router();

meRouter.get('/tasks', authorize('self.internalApp'), async (req, res) => {
  res.json(await service.myTasks(req.principal));
});
