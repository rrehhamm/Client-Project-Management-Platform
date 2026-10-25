// /api/v1/templates — FR-PRJ-02/03, D-26.
import { templateCreateSchema, templateUpdateSchema } from '@cpm/shared';
import { Router } from 'express';
import { authorize } from '../../auth/authorize.js';
import { validateBody } from '../../lib/validate.js';
import { loadProjectContext } from '../projects/common.js';
import * as service from './service.js';

const loadTemplate = async (req) => ({ template: await service.findTemplate(req.principal.workspace_id, req.params.id) });

export const templatesRouter = Router();

templatesRouter.get('/', authorize('template.list'), async (req, res) => {
  res.json(await service.listTemplates(req.principal));
});
templatesRouter.post(
  '/',
  validateBody(templateCreateSchema),
  // PMs save templates only from projects they belong to (D-26)
  authorize('template.save', { load: (req) => loadProjectContext(req, req.body.project_id), readAction: 'project.read' }),
  async (req, res) => {
    res.status(201).json(await service.saveTemplate(req.principal, req.ctx, req.body, req));
  },
);
templatesRouter.get('/:id', authorize('template.list', { load: loadTemplate }), async (req, res) => {
  res.json(await service.getTemplate(req.principal, req.ctx.template));
});
templatesRouter.patch('/:id', authorize('template.manage', { load: loadTemplate }), validateBody(templateUpdateSchema), async (req, res) => {
  res.json(await service.updateTemplate(req.principal, req.ctx.template, req.body, req));
});
templatesRouter.delete('/:id', authorize('template.manage', { load: loadTemplate }), async (req, res) => {
  await service.deleteTemplate(req.principal, req.ctx.template, req);
  res.status(204).end();
});
