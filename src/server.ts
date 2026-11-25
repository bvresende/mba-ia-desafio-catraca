import { env } from './config/env.js';
import { closeDb } from './db/client.js';
import { buildApp } from './app.js';
import { cancelPendingTimers } from './modules/purchases/gateway.service.js';

const app = buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down Catraca server...');
  try {
    cancelPendingTimers();
    await app.close();
    await closeDb();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err, 'Failed to start server');
  await closeDb();
  process.exit(1);
}
