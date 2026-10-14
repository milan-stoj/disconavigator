import { describe, expect, it } from 'vitest';
import { buildTestApp } from './app-helpers.js';

describe('health', () => {
  it('responds ok', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
