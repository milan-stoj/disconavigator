import { eq } from 'drizzle-orm';
import { createUserSchema, updateUserSchema } from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { hashPassword } from '../auth/passwords.js';
import { requireAdmin } from '../auth/plugin.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { user } from '../db/schema.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import type { AppDeps } from '../app.js';

type UserRow = typeof user.$inferSelect;
const publicUser = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  active: u.active,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

export async function userRoutes(app: FastifyInstance, { db }: AppDeps) {
  app.get('/api/users', async (req) => {
    const { scope } = requireAdmin(req);
    return scope.list(user, { orderBy: [{ column: user.username }] }).map(publicUser);
  });

  app.post('/api/users', async (req, reply) => {
    const { scope } = requireAdmin(req);
    const input = parse(createUserSchema, req.body);
    const username = input.username.toLowerCase();
    if (db.select({ id: user.id }).from(user).where(eq(user.username, username)).get()) {
      throw new ConflictError('That username is already taken', {
        fieldErrors: { username: 'That username is already taken' },
      });
    }
    const created = scope.insert(user, {
      username,
      displayName: input.displayName,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    });
    return reply.code(201).send(publicUser(created));
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const auth = requireAdmin(req);
    const input = parse(updateUserSchema, req.body);
    const target = auth.scope.get(user, req.params.id, 'User');
    if (
      target.id === auth.user.id &&
      (input.active === false || (input.role && input.role !== 'admin'))
    ) {
      throw new ValidationError('You cannot deactivate yourself or remove your own admin role');
    }
    const updated = auth.scope.update(user, target.id, {
      ...(input.displayName !== undefined && { displayName: input.displayName }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.active !== undefined && { active: input.active }),
      ...(input.password !== undefined && { passwordHash: await hashPassword(input.password) }),
    });
    if (input.active === false || input.password !== undefined) {
      destroyUserSessions(db, target.id, target.id === auth.user.id ? auth.sessionId : undefined);
    }
    return publicUser(updated);
  });
}
