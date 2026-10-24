// Builds the Express app. Kept separate from server.js so tests can use it with Supertest.
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { bigIntReplacer } from './lib/json.js';
import { logger } from './lib/logger.js';
import { requestId } from './lib/requestId.js';
import { healthRouter } from './modules/health/routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('json replacer', bigIntReplacer);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customProps: (req) => ({ requestId: req.id }),
      // Never log bodies; headers are redacted by the logger config.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // NFR-SEC-05. The API serves JSON only, so the CSP forbids everything.
  // HSTS is sent by helmet; HTTPS redirect happens at the reverse proxy (NFR-SEC-01).
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      frameguard: { action: 'deny' },
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
