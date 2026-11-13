// Bot status for the admin dashboard: one row in wa_status, updated on connection changes
// and by a heartbeat, so the dashboard can tell "online" from "crashed" by last_seen.
import { readFileSync } from 'node:fs';
import { query } from '../db.js';
import { logger } from '../logger.js';
import { settings } from '../settings.js';

const log = logger.child({ module: 'status' });
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version;

let state = { state: 'starting', phone: null, qr: null };

async function write() {
  await query(
    `INSERT INTO wa_status (id, state, phone, qr, version, settings_json, started_at, last_seen)
     VALUES (1, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE state = VALUES(state), phone = VALUES(phone), qr = VALUES(qr),
       version = VALUES(version), settings_json = VALUES(settings_json), last_seen = NOW()`,
    [state.state, state.phone, state.qr, version, JSON.stringify(settings())],
  );
}

/** Merge a status change and write it now. state: starting | qr | connected | disconnected | logged_out */
export async function setStatus(patch) {
  state = { ...state, ...patch };
  await write().catch((err) => log.warn({ err: err.message }, 'could not write wa_status'));
}

export async function markStarted() {
  await query('UPDATE wa_status SET started_at = NOW() WHERE id = 1').catch(() => {});
}

export function startHeartbeat(intervalMs = 60_000) {
  setInterval(() => {
    write().catch((err) => log.warn({ err: err.message }, 'heartbeat failed'));
  }, intervalMs).unref();
}
