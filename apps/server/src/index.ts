import fs from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
if (process.env.E2E_RESET_DB === 'true' && config.databasePath !== ':memory:') {
  for (const suffix of ['', '-wal', '-shm'])
    fs.rmSync(config.databasePath + suffix, { force: true });
}
const app = await buildApp({ config, logger: process.env.NODE_ENV !== 'test' });
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
