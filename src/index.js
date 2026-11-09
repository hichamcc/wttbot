import { pool } from './db.js';
import { logger } from './logger.js';
import { startWhatsApp } from './whatsapp.js';

async function main() {
  await pool.query('SELECT 1');
  logger.info('database connected');
  await startWhatsApp();
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
