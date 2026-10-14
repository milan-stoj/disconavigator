import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const dbPath = path.join(os.tmpdir(), `disco-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `pnpm exec vite build && pnpm --filter server exec tsx src/index.ts`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: dbPath,
      WEB_DIST_PATH: path.resolve(import.meta.dirname, 'dist'),
      INITIAL_ADMIN_PASSWORD: 'e2e-password-123',
      PUBLIC_BASE_URL: `http://localhost:${port}`,
      E2E_RESET_DB: 'true',
      SQUARE_MODE: 'mock',
      SCHEDULER_ENABLED: 'false',
      QUOTE_REQUEST_RATE_LIMIT: '1000',
    },
  },
});
