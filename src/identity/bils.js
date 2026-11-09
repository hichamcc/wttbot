import { config } from '../config.js';
import { query } from '../db.js';

const TTL_MS = 10 * 60_000;
let cache = { at: 0, list: [] };

/** All truck ("bil") values known to WTTsystem for this company, from users and trips. */
export async function getBilList() {
  if (Date.now() - cache.at < TTL_MS) return cache.list;

  const rows = await query(
    `SELECT DISTINCT TRIM(bil) AS bil FROM user WHERE company = ? AND bil IS NOT NULL AND TRIM(bil) <> ''
     UNION
     SELECT DISTINCT TRIM(bil) AS bil FROM delivery WHERE company = ? AND bil IS NOT NULL AND TRIM(bil) <> ''`,
    [config.companyId, config.companyId],
  );
  cache = { at: Date.now(), list: rows.map((r) => r.bil) };
  return cache.list;
}
