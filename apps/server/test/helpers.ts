import { openDatabase } from '../src/db/index.js';
import { TenantScope } from '../src/db/repository.js';
import { tenant, user } from '../src/db/schema.js';
import { uuidv7 } from '../src/lib/id.js';

export function createTestDb() {
  return openDatabase(':memory:');
}

export function createTenant(db: ReturnType<typeof createTestDb>['db'], name = 'Tenant') {
  const id = uuidv7();
  db.insert(tenant)
    .values({ id, name, slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${id.slice(-6)}` })
    .run();
  const scope = new TenantScope(db, id);
  const u = scope.insert(user, {
    username: `u-${id.slice(-8)}`,
    displayName: `${name} user`,
    role: 'admin',
  });
  return { tenantId: id, scope, userId: u.id };
}
