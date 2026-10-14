import { settingsSchema, squareConnectionSchema } from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/plugin.js';
import { parse } from '../lib/validation.js';
import { getSettings, updateSettings } from '../services/settings.js';
import {
  disconnectSquare,
  listSquareLocations,
  saveSquareConnection,
} from '../services/square/connection.js';
import type { AppDeps } from '../app.js';

const locationsBody = squareConnectionSchema.pick({ environment: true, accessToken: true });

export async function settingsRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config } = deps;
  const viewOpts = { publicBaseUrl: config.publicBaseUrl, squareMode: config.squareMode };

  // Staff can read settings because quote building needs the deposit %, delivery fee and terms.
  app.get('/api/settings', async (req) => getSettings(db, requireAuth(req).tenant.id, viewOpts));

  app.put('/api/settings', async (req) => {
    const { tenant } = requireAdmin(req);
    return updateSettings(db, tenant.id, parse(settingsSchema, req.body), viewOpts);
  });

  /** Test call: lists the locations the token can see, without saving anything. */
  app.post('/api/settings/square/locations', async (req) => {
    const { tenant } = requireAdmin(req);
    return {
      locations: await listSquareLocations(deps, tenant.id, parse(locationsBody, req.body)),
    };
  });

  app.put('/api/settings/square', async (req) => {
    const { tenant } = requireAdmin(req);
    await saveSquareConnection(deps, tenant.id, parse(squareConnectionSchema, req.body));
    return getSettings(db, tenant.id, viewOpts);
  });

  app.delete('/api/settings/square', async (req) => {
    const { tenant } = requireAdmin(req);
    disconnectSquare(db, tenant.id);
    return getSettings(db, tenant.id, viewOpts);
  });
}
