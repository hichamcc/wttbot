// Plate matching between Mapon units and WTT "bil" values.
// Same two-phase rules as admin/mapon_truck_check.php and admin/refund/get_driver_info.php:
// Mapon sometimes stores a plate with extra parts ("ZK2367M/WT44/2716"), so after an exact
// whole-string match we also accept an exact delimited segment, but only when unambiguous.

const UNIT_FIELDS = ['label', 'number', 'reg_number'];

/** Uppercase + strip everything non-alphanumeric. */
export function normPlate(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function segments(s) {
  return String(s || '')
    .split(/[/\s\-_]+/)
    .map(normPlate)
    .filter(Boolean);
}

function compact(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '');
}

/** A segment must look like a plate (letters AND digits, length >= 5). */
function looksLikePlate(s) {
  return s.length >= 5 && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

function exactMatch(unit, bil) {
  const target = compact(bil);
  return UNIT_FIELDS.some((f) => unit[f] && compact(unit[f]) === target);
}

function segmentMatch(unit, bil) {
  const needle = normPlate(bil);
  if (!looksLikePlate(needle)) return false;
  return UNIT_FIELDS.some((f) => unit[f] && segments(unit[f]).includes(needle));
}

/**
 * Find which WTT bil value a Mapon unit belongs to.
 * Returns the bil string, or null when there is no match or more than one segment match.
 */
export function bilForUnit(unit, bilList) {
  const exact = bilList.find((bil) => exactMatch(unit, bil));
  if (exact) return exact;

  const hits = [...new Set(bilList.filter((bil) => segmentMatch(unit, bil)))];
  return hits.length === 1 ? hits[0] : null;
}

/** Find a bil from free text typed by office staff ("zk 2367m" -> "ZK2367M"). */
export function findBil(text, bilList) {
  const needle = normPlate(text);
  if (!needle) return null;
  return bilList.find((bil) => normPlate(bil) === needle) || null;
}
