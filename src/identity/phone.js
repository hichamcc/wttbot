import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { config } from '../config.js';

/**
 * Normalize a phone number typed by a human (Mapon, overrides table) to E.164.
 * Handles "+45 12 34 56 78", "0045 12345678" and local numbers without a prefix
 * (read as DEFAULT_PHONE_COUNTRY). Returns null when it can't be parsed.
 */
export function normalizePhone(raw, defaultCountry = config.defaultPhoneCountry) {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/^00/, '+');
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/** "4512345678@s.whatsapp.net" or "4512345678:12@s.whatsapp.net" -> "+4512345678". */
export function phoneFromJid(jid) {
  const user = String(jid || '').split('@')[0].split(':')[0];
  return /^\d{6,15}$/.test(user) ? `+${user}` : null;
}
