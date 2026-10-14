import { afterAll, describe, expect, it } from 'vitest';
import { organization } from '../src/db/schema.js';
import { buildTestApp, client, signIn } from './app-helpers.js';
import { createTenant } from './helpers.js';
import { TenantScope } from '../src/db/repository.js';

describe('global search', async () => {
  const { app, db } = await buildTestApp();
  afterAll(() => app.close());
  const admin = client(app, await signIn(app));
  const me = (await admin.get('/api/auth/me')).json();
  const scope = new TenantScope(db, me.tenant.id);
  scope.insert(organization, { name: 'Bounce Milwaukee', type: 'bar' });
  scope.insert(organization, { name: '100% Fun Bar', type: 'bar' });
  const other = createTenant(db, 'other');
  other.scope.insert(organization, { name: 'Bounce Madison', type: 'bar' });

  it('finds records by name within the tenant only', async () => {
    const res = await admin.get('/api/search?q=bounce');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { title: string }) => r.title)).toEqual(['Bounce Milwaukee']);
    expect(res.json()[0]).toMatchObject({
      kind: 'organization',
      url: expect.stringMatching(/^\/organizations\//),
    });
  });

  it('treats LIKE wildcards literally and ignores very short queries', async () => {
    expect(
      (await admin.get('/api/search?q=0%25')).json().map((r: { title: string }) => r.title),
    ).toEqual(['100% Fun Bar']);
    expect((await admin.get('/api/search?q=b')).json()).toEqual([]);
  });

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/search?q=bounce' })).statusCode).toBe(401);
  });
});
