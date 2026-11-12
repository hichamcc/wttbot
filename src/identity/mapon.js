import { config } from '../config.js';
import { logger } from '../logger.js';
import { normalizePhone } from './phone.js';

const log = logger.child({ module: 'mapon' });

// Phone field names seen in Mapon driver payloads; first non-empty one wins.
const PHONE_FIELDS = ['phone', 'phone_number', 'mobile', 'mobile_phone'];

async function maponGet(path, params = {}) {
  const url = new URL(`${config.mapon.baseUrl}/${path}`);
  url.searchParams.set('key', config.mapon.apiKey);
  for (const [k, v] of Object.entries(params)) {
    for (const item of [].concat(v)) url.searchParams.append(k, item);
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Mapon ${path} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`Mapon ${path}: ${JSON.stringify(body.error)}`);
  return body.data;
}

/**
 * Cache a loader for MAPON_CACHE_MINUTES. If a refresh fails, keep serving the last
 * good value so a Mapon hiccup doesn't make every driver "unknown".
 */
function cached(name, loader) {
  let value = null;
  let loadedAt = 0;
  let inflight = null;

  return async function get() {
    const fresh = value && Date.now() - loadedAt < config.mapon.cacheMinutes * 60_000;
    if (fresh) return value;
    if (!inflight) {
      inflight = loader()
        .then((v) => {
          value = v;
          loadedAt = Date.now();
          return v;
        })
        .catch((err) => {
          if (!value) throw err;
          log.warn({ err: err.message }, `${name} refresh failed, using stale cache`);
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

export function driverPhone(driver) {
  for (const f of PHONE_FIELDS) {
    if (driver[f]) return normalizePhone(driver[f]);
  }
  return null;
}

export function driverName(driver) {
  return [driver.name, driver.surname].filter(Boolean).join(' ').trim() || null;
}

export const getDrivers = cached('drivers', async () => {
  const data = await maponGet('driver/list.json');
  return Array.isArray(data) ? data : data?.drivers || [];
});

export const getUnits = cached('units', async () => {
  const data = await maponGet('unit/list.json', { 'include[]': ['drivers'] });
  return data?.units || [];
});

/** Mapon driver whose phone matches the E.164 number, or null. */
export async function findDriverByPhone(phone) {
  const drivers = await getDrivers();
  return drivers.find((d) => driverPhone(d) === phone) || null;
}

/** Lowercase, strip accents ("Łukasz Żak" -> "lukasz zak"). */
function foldName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapon drivers matching a typed name. Every word typed must appear in the driver's
 * full name, so "jan kow" finds "Jan Kowalski". Exact full-name matches win, then
 * whole-word matches ("kowal" prefers "Janusz Kowal" over "Jan Kowalski").
 */
export async function findDriversByName(text) {
  const words = foldName(text).split(' ').filter(Boolean);
  if (!words.length) return [];

  const drivers = await getDrivers();
  const hits = drivers.filter((d) => {
    const full = foldName(driverName(d));
    return words.every((w) => full.includes(w));
  });

  const exact = hits.filter((d) => foldName(driverName(d)) === words.join(' '));
  if (exact.length) return exact;
  const wholeWords = hits.filter((d) => {
    const parts = foldName(driverName(d)).split(' ');
    return words.every((w) => parts.includes(w));
  });
  return wholeWords.length ? wholeWords : hits;
}

/** Unit the driver is currently assigned to (driver1 or driver2 on the unit). */
export async function findUnitForDriver(driver) {
  const units = await getUnits();
  const id = String(driver.id ?? '');
  const name = driverName(driver)?.toLowerCase();

  const assigned = (unit) => Object.values(unit.drivers || {}).filter(Boolean);

  const byId = id && units.find((u) => assigned(u).some((d) => String(d.id ?? '') === id));
  if (byId) return byId;

  // Some accounts only return the name on the unit's driver slot.
  if (!name) return null;
  const byName = units.filter((u) => assigned(u).some((d) => driverName(d)?.toLowerCase() === name));
  return byName.length === 1 ? byName[0] : null;
}
