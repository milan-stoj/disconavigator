import type { FastifyInstance } from 'fastify';
import { ctxOf } from '../auth/plugin.js';
import { getDashboard } from '../services/dashboard.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => getDashboard(ctxOf(req).scope));
}
