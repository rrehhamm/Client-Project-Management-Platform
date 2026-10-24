// Public endpoints (no session needed). Expose only up/down status, never versions or config.
import { Router } from 'express';
import { live, ready } from './controller.js';

export const healthRouter = Router();

healthRouter.get('/health', live);
healthRouter.get('/health/ready', ready);
