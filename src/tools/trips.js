import { config } from '../config.js';
import { query } from '../db.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'trips' });

// delivery.last / delivery.levdato are stored as DD/MM/YYYY or DD-MM-YYYY, optionally with
// a time — same normalisation as admin/worker/jobs.php.
const LOAD_DATE = "STR_TO_DATE(LEFT(REPLACE(d.last, '-', '/'), 10), '%d/%m/%Y')";
const DEL_DATE = "STR_TO_DATE(LEFT(REPLACE(d.levdato, '-', '/'), 10), '%d/%m/%Y')";

const ACTIVE = "(d.status IS NULL OR d.status = 'active')";

// Free-text trip fields shown to the driver. Confirm with the client that none of these
// hold office-only information before going live.
const TEXT_FIELDS = ['cargoref', 'unload_ref', 'temp', 'load_type', 'notes', 'info'];

const PICKUP_COLS = ['afhent1', 'afhent2', 'afhent3', 'afhent4'];
const DELIVERY_COLS = ['lev1', 'lev2', 'lev3'];

/** Today as YYYY-MM-DD in the company's timezone (not the DB server's). */
export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== ''),
  );
}

function summary(row) {
  return clean({
    trip_id: row.excelID,
    loading_date: row.last,
    delivery_date: row.levdato,
    first_pickup: [row.pickup_company, row.pickup_city, row.pickup_country].filter(Boolean).join(', '),
    first_delivery: [row.del_company, row.del_city, row.del_country].filter(Boolean).join(', '),
    trailer: row.trailer,
  });
}

const SUMMARY_SQL = `
  SELECT d.id, d.excelID, d.last, d.levdato, d.trailer,
         a1.company AS pickup_company, a1.city AS pickup_city, a1.country AS pickup_country,
         l1.company AS del_company, l1.city AS del_city, l1.country AS del_country
  FROM delivery d
  LEFT JOIN delivery_places a1 ON d.afhent1 = a1.id
  LEFT JOIN delivery_places l1 ON d.lev1 = l1.id
  WHERE d.bil = ? AND d.company = ? AND ${ACTIVE}`;

/** Trips for a truck. range: 'today' | 'upcoming' | 'recent'. */
export async function listTrips(bil, range = 'upcoming') {
  const t = today();
  const variants = {
    today: [`AND ${LOAD_DATE} = ? ORDER BY d.excelID`, [t]],
    upcoming: [`AND ${LOAD_DATE} >= ? ORDER BY ${LOAD_DATE} ASC, d.excelID ASC LIMIT 10`, [t]],
    recent: [`AND ${LOAD_DATE} < ? ORDER BY ${LOAD_DATE} DESC, d.excelID DESC LIMIT 10`, [t]],
  };
  const [tail, extra] = variants[range] || variants.upcoming;
  const rows = await query(`${SUMMARY_SQL} ${tail}`, [bil, config.companyId, ...extra]);
  return { truck: bil, today: t, range, trips: rows.map(summary) };
}

/**
 * The trip the driver most likely means by "my trip": one that is in progress today,
 * else the next upcoming one, else the most recent past one.
 */
async function currentTripRow(bil) {
  const t = today();
  const rows = await query(
    `SELECT d.* FROM delivery d
     WHERE d.bil = ? AND d.company = ? AND ${ACTIVE} AND d.last IS NOT NULL AND d.last <> ''
     ORDER BY
       CASE WHEN ${LOAD_DATE} <= ? AND COALESCE(${DEL_DATE}, ${LOAD_DATE}) >= ? THEN 0
            WHEN ${LOAD_DATE} > ? THEN 1 ELSE 2 END,
       CASE WHEN ${LOAD_DATE} > ? THEN ${LOAD_DATE} END ASC,
       ${LOAD_DATE} DESC
     LIMIT 1`,
    [bil, config.companyId, t, t, t, t],
  );
  return rows[0] || null;
}

async function tripRowById(bil, tripId) {
  const rows = await query(
    `SELECT d.* FROM delivery d WHERE d.excelID = ? AND d.bil = ? AND d.company = ? AND ${ACTIVE} LIMIT 1`,
    [String(tripId), bil, config.companyId],
  );
  return rows[0] || null;
}

async function placesById(ids) {
  if (!ids.length) return new Map();
  const rows = await query(
    `SELECT id, company, adress, city, country FROM delivery_places WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return new Map(rows.map((r) => [String(r.id), r]));
}

function place(p) {
  return clean({ company: p.company, address: p.adress, city: p.city, country: p.country });
}

async function extraStops(deliveryId) {
  try {
    return await query(
      `SELECT e.type, p.company, p.adress, p.city, p.country
       FROM delivery_extra_places e
       LEFT JOIN delivery_places p ON p.id = e.place_id
       WHERE e.delivery_id = ?
       ORDER BY e.type, e.sort_order, e.id`,
      [deliveryId],
    );
  } catch (err) {
    // Older databases don't have delivery_extra_places; same fail-soft as job_details.php.
    log.debug({ err: err.message }, 'extra stops unavailable');
    return [];
  }
}

/** Stops in driving order: pickups then deliveries, each followed by its extra stops. */
async function stopsForTrip(row) {
  const cols = [...PICKUP_COLS, ...DELIVERY_COLS];
  const numericIds = cols.map((c) => row[c]).filter((v) => /^\d+$/.test(String(v ?? '')));
  const places = await placesById(numericIds);

  const fromCol = (col, type) => {
    const v = row[col];
    if (v === null || v === undefined || String(v).trim() === '') return null;
    // A non-numeric value is a free-text place typed into the trip.
    const p = places.get(String(v));
    return { type, ...(p ? place(p) : { company: String(v).trim() }) };
  };

  const extras = await extraStops(row.id);
  const extraOf = (type, label) => extras.filter((e) => e.type === type).map((e) => ({ type: label, ...place(e) }));

  return [
    ...PICKUP_COLS.map((c) => fromCol(c, 'pickup')),
    ...extraOf('load', 'pickup'),
    ...DELIVERY_COLS.map((c) => fromCol(c, 'delivery')),
    ...extraOf('del', 'delivery'),
  ].filter(Boolean);
}

/** Full details for one trip (by trip number), or the current trip when tripId is empty. */
export async function getTripDetails(bil, tripId) {
  const row = tripId ? await tripRowById(bil, tripId) : await currentTripRow(bil);
  if (!row) {
    return { truck: bil, found: false, message: tripId ? `No trip ${tripId} for this truck.` : 'No trips found for this truck.' };
  }

  return {
    truck: bil,
    found: true,
    today: today(),
    trip: clean({
      trip_id: row.excelID,
      loading_date: row.last,
      delivery_date: row.levdato,
      trailer: row.trailer,
      ...Object.fromEntries(TEXT_FIELDS.map((f) => [f, row[f]])),
    }),
    stops: await stopsForTrip(row),
  };
}

/** Documents attached to a trip (names only; files stay in WTTsystem). */
export async function getTripDocuments(bil, tripId) {
  const row = tripId ? await tripRowById(bil, tripId) : await currentTripRow(bil);
  if (!row) return { truck: bil, found: false };

  const docs = await query(
    'SELECT original_filename, file_type, upload_date FROM attachments WHERE delivery_id = ? ORDER BY upload_date ASC',
    [row.id],
  );
  return {
    truck: bil,
    found: true,
    trip_id: row.excelID,
    documents: docs.map((d) => clean({ name: d.original_filename, type: d.file_type, uploaded: d.upload_date })),
  };
}
