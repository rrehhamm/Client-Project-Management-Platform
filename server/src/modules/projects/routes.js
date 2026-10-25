// /api/v1/projects and /api/v1/milestones — every route goes through authorize().
import {
  memberAddSchema,
  memberUpdateSchema,
  milestoneCreateSchema,
  milestoneOrderSchema,
  milestoneUpdateSchema,
  paginationSchema,
  projectCreateSchema,
  projectDeleteSchema,
  projectListQuerySchema,
  projectStatusSchema,
  projectUpdateSchema,
} from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { activityScope } from '../../auth/scopes.js';
import { listActivity } from '../../lib/activityFeed.js';
import { forbidden } from '../../lib/errors.js';
import { validateBody, validateQuery } from '../../lib/validate.js';
import { loadProjectContext } from './common.js';
import * as members from './members.js';
import * as milestones from './milestones.js';
import * as service from './service.js';

const load = (req) => loadProjectContext(req, req.params.id);
const loadIncludingDeleted = (req) => loadProjectContext(req, req.params.id, { includeDeleted: true });
/** For contacts, a project they cannot read answers 404 (BR-CLI-01). */
const opts = (extra = {}) => ({ load, readAction: 'project.read', ...extra });

export const projectsRouter = Router();

projectsRouter.get(
  '/',
  validateQuery(projectListQuerySchema),
  // The 30-day trash is for those who may delete projects (FR-PRJ-11)
  (req, res, next) => (req.validQuery.deleted ? authorize('project.delete')(req, res, next) : authorize('project.list')(req, res, next)),
  async (req, res) => res.json(await service.listProjects(req.principal, req.validQuery)),
);
projectsRouter.post('/', authorize('project.create'), validateBody(projectCreateSchema), async (req, res) => {
  res.status(201).json(await service.createProject(req.principal, req.body, req));
});
projectsRouter.get('/:id', authorize('project.read', opts()), async (req, res) => {
  res.json(await service.getProjectDetail(req.principal, req.ctx.project));
});
projectsRouter.patch('/:id', authorize('project.update', opts()), validateBody(projectUpdateSchema), async (req, res) => {
  res.json(await service.updateProject(req.principal, req.ctx.project, req.body, req));
});
projectsRouter.post('/:id/status', authorize('project.update', opts()), validateBody(projectStatusSchema), async (req, res) => {
  res.json(await service.changeStatus(req.principal, req.ctx.project, req.body, req));
});
projectsRouter.post('/:id/archive', authorize('project.update', opts()), async (req, res) => {
  res.json(await service.archiveProject(req.principal, req.ctx.project, req));
});
projectsRouter.post('/:id/unarchive', authorize('project.update', opts()), async (req, res) => {
  res.json(await service.unarchiveProject(req.principal, req.ctx.project, req));
});
projectsRouter.delete('/:id', authorize('project.delete', opts()), validateBody(projectDeleteSchema), async (req, res) => {
  await service.deleteProject(req.principal, req.ctx.project, req.body, req);
  res.status(204).end();
});
projectsRouter.post('/:id/restore', authorize('project.delete', { load: loadIncludingDeleted }), async (req, res) => {
  res.json(await service.restoreProject(req.principal, req.ctx.project, req));
});

// Members (FR-PRJ-05, D-14)
projectsRouter.get('/:id/members', authorize('projectMember.read', opts()), async (req, res) => {
  res.json(await members.listMembers(req.principal, req.ctx.project));
});
projectsRouter.post('/:id/members', authorize('projectMember.manage', opts()), validateBody(memberAddSchema), async (req, res) => {
  const { member, created } = await members.addMember(req.principal, req.ctx.project, req.body, req);
  res.status(created ? 201 : 200).json(member);
});
projectsRouter.patch('/:id/members/:memberId', authorize('projectMember.manage', opts()), validateBody(memberUpdateSchema), async (req, res) => {
  const member = await members.findMember(req.ctx.project, req.params.memberId);
  res.json(await members.updateMember(req.principal, req.ctx.project, member, req.body, req));
});
projectsRouter.delete('/:id/members/:memberId', authorize('projectMember.manage', opts()), async (req, res) => {
  const member = await members.findMember(req.ctx.project, req.params.memberId);
  await members.removeMember(req.principal, req.ctx.project, member, req);
  res.status(204).end();
});

// Activity (FR-PRJ-08, FR-ACT-01 feed)
projectsRouter.get('/:id/activity', authorize('project.read', opts()), validateQuery(paginationSchema), async (req, res) => {
  const scope = activityScope(req.principal, { membership: req.ctx.membership });
  if (!scope) throw forbidden();
  res.json(await listActivity({ project_id: req.ctx.project.id, ...scope }, req.validQuery));
});

// Milestones on a project (FR-MS-01)
projectsRouter.get('/:id/milestones', authorize('project.read', opts()), async (req, res) => {
  res.json(await milestones.listMilestones(req.principal, req.ctx));
});
projectsRouter.post('/:id/milestones', authorize('milestone.create', opts()), validateBody(milestoneCreateSchema), async (req, res) => {
  res.status(201).json(await milestones.createMilestone(req.principal, req.ctx, req.body, req));
});
projectsRouter.put('/:id/milestones/order', authorize('milestone.update', opts()), validateBody(milestoneOrderSchema), async (req, res) => {
  res.json(await milestones.reorderMilestones(req.principal, req.ctx, req.body, req));
});

export const milestonesRouter = Router();

const msOpts = { load: milestones.loadMilestoneContext, readAction: 'milestone.read' };
milestonesRouter.patch('/:milestoneId', authorize('milestone.update', msOpts), validateBody(milestoneUpdateSchema), async (req, res) => {
  res.json(await milestones.updateMilestone(req.principal, req.ctx, req.body, req));
});
milestonesRouter.post('/:milestoneId/complete', authorize('milestone.update', msOpts), async (req, res) => {
  res.json(await milestones.completeMilestone(req.principal, req.ctx, req));
});
milestonesRouter.delete('/:milestoneId', authorize('milestone.delete', msOpts), async (req, res) => {
  await milestones.deleteMilestone(req.principal, req.ctx, req);
  res.status(204).end();
});
