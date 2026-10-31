// /api/v1/projects/:id/files|folders and /api/v1/files — every route goes through authorize().
// Uploads are raw request bodies (Content-Type + Content-Length + X-File-Name), streamed.
import { downloadQuerySchema, fileListQuerySchema, fileUpdateSchema, fileUploadQuerySchema, folderCreateSchema, folderUpdateSchema } from '@cpm/shared';
import { Router } from 'express';
import { config } from '../../config.js';
import { authorize, authorizeFields } from '../../auth/authorize.js';
import { validateBody, validateQuery } from '../../lib/validate.js';
import { loadProjectContext } from '../projects/common.js';
import { loadFileContext } from './common.js';
import * as service from './service.js';

/** Rule 3: what each PATCH field needs. Visibility and filing are PM/Admin/Owner (FR-FILE-07). */
export const FILE_FIELD_ACTIONS = Object.freeze({ name: 'file.update', visibility: 'file.update', folder_id: 'file.update', task_id: 'file.update', version: null });

const project = { load: (req) => loadProjectContext(req, req.params.id), readAction: 'project.read' };
const file = { load: (req) => loadFileContext(req), readAction: 'file.read' };

/**
 * When an upload is refused early (413, 415, 422), read and discard the rest of the
 * body first, so the browser receives the error instead of a reset connection.
 * Bodies far over the size limit are not read: the connection is closed instead.
 */
const upload = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    if (!req.readableEnded) {
      const declared = Number(req.get('content-length')) || 0;
      if (declared <= config.storage.fileMaxBytes * 1.1) {
        req.resume();
        await new Promise((resolve) => {
          req.once('end', resolve);
          req.once('close', resolve);
        });
      } else {
        res.set('Connection', 'close');
      }
    }
    throw err;
  }
};

export const projectFilesRouter = Router();

projectFilesRouter.get('/:id/files', authorize('file.read', project), validateQuery(fileListQuerySchema), async (req, res) => {
  res.json(await service.listFiles(req.principal, req.ctx, req.validQuery));
});
projectFilesRouter.post('/:id/files', authorize('file.create', project), validateQuery(fileUploadQuerySchema), upload(async (req, res) => {
  res.status(201).json(await service.uploadFile(req.principal, req.ctx, req.validQuery, req));
}));

projectFilesRouter.get('/:id/folders', authorize('file.read', project), async (req, res) => {
  res.json(await service.listFolders(req.ctx));
});
projectFilesRouter.post('/:id/folders', authorize('file.update', project), validateBody(folderCreateSchema), async (req, res) => {
  res.status(201).json(await service.createFolder(req.principal, req.ctx, req.body, req));
});
projectFilesRouter.patch('/:id/folders/:folderId', authorize('file.update', project), validateBody(folderUpdateSchema), async (req, res) => {
  res.json(await service.renameFolder(req.principal, req.ctx, req.params.folderId, req.body, req));
});
projectFilesRouter.delete('/:id/folders/:folderId', authorize('file.update', project), async (req, res) => {
  await service.deleteFolder(req.principal, req.ctx, req.params.folderId, req);
  res.status(204).end();
});

export const filesRouter = Router();

filesRouter.get('/:fileId', authorize('file.read', file), async (req, res) => {
  res.json(service.getFile(req.principal, req.ctx));
});
filesRouter.patch('/:fileId', authorize('file.read', file), authorizeFields(FILE_FIELD_ACTIONS), validateBody(fileUpdateSchema), async (req, res) => {
  res.json(await service.updateFile(req.principal, req.ctx, req.body, req));
});
filesRouter.delete('/:fileId', authorize('file.delete', file), async (req, res) => {
  await service.deleteFile(req.principal, req.ctx, req);
  res.status(204).end();
});
filesRouter.post('/:fileId/versions', authorize('file.create', file), upload(async (req, res) => {
  res.status(201).json(await service.uploadVersion(req.principal, req.ctx, req));
}));
// FR-FILE-04: the signed link is made only after this permission check
filesRouter.get('/:fileId/versions/:versionNo/url', authorize('file.read', file), validateQuery(downloadQuerySchema), async (req, res) => {
  res.json(await service.downloadUrl(req.principal, req.ctx, req.params.versionNo, req.validQuery, req));
});
