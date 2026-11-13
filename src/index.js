import { pool } from './db.js';
import { logger } from './logger.js';
import { startSettingsRefresh } from './settings.js';
import { markStarted, setStatus, startHeartbeat } from './store/status.js';
import { startWhatsApp } from './whatsapp.js';

async function main() {
  await pool.query('SELECT 1');
  logger.info('database connected');
  await startSettingsRefresh();
  await setStatus({ state: 'starting' });
  await markStarted();
  startHeartbeat();
  await startWhatsApp();
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
