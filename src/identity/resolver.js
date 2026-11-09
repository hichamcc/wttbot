import { query } from '../db.js';
import { logger } from '../logger.js';
import { getBilList } from './bils.js';
import { bilForUnit } from './plate.js';
import { driverName, findDriverByPhone, findUnitForDriver } from './mapon.js';

const log = logger.child({ module: 'resolver' });

async function findOverride(phone) {
  const rows = await query(
    'SELECT display_name, bil, is_staff FROM wa_phone_overrides WHERE phone = ? AND active = 1 LIMIT 1',
    [phone],
  );
  return rows[0] || null;
}

/**
 * Work out who is asking and which truck the question is about.
 *
 * Returns one of:
 *   { ok: true, phone, name, bil, isStaff, source }
 *   { ok: false, phone, reason: 'unknown_number' | 'no_truck' }
 *
 * Tools only ever receive `bil` from here, never from the model, so a driver can't
 * read another truck's trips. Office staff (isStaff) may name a truck explicitly.
 *
 * Phase 2 (truck groups) plugs in here: a group JID mapped to a truck sets `bil`
 * regardless of who in the group is asking.
 */
export async function resolveContext({ senderPhone }) {
  const phone = senderPhone;

  const override = await findOverride(phone);
  if (override) {
    return {
      ok: true,
      phone,
      name: override.display_name || null,
      bil: override.bil || null,
      isStaff: Boolean(override.is_staff),
      source: 'override',
    };
  }

  const driver = await findDriverByPhone(phone);
  if (!driver) return { ok: false, phone, reason: 'unknown_number' };

  const name = driverName(driver);
  const unit = await findUnitForDriver(driver);
  const bil = unit ? bilForUnit(unit, await getBilList()) : null;

  if (!bil) {
    log.info({ phone, driverId: driver.id, unit: unit?.label ?? null }, 'driver found but no truck matched');
    return { ok: false, phone, name, reason: 'no_truck' };
  }

  return { ok: true, phone, name, bil, isStaff: false, source: 'mapon' };
}
