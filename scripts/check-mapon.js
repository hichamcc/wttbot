// Checks how many Mapon drivers the bot can identify: phone filled in -> assigned unit -> WTT truck.
// Usage: npm run check:mapon            (counts only)
//        npm run check:mapon -- --show  (also list each driver; contains personal data)
import { pool } from '../src/db.js';
import { getBilList } from '../src/identity/bils.js';
import { driverName, driverPhone, findUnitForDriver, getDrivers, getUnits } from '../src/identity/mapon.js';
import { bilForUnit } from '../src/identity/plate.js';

const show = process.argv.includes('--show');

const [drivers, units, bils] = await Promise.all([getDrivers(), getUnits(), getBilList()]);

console.log(`Mapon drivers: ${drivers.length}`);
console.log(`Mapon units:   ${units.length}`);
console.log(`WTT trucks (bil values): ${bils.length}`);
if (drivers[0]) console.log(`Driver fields: ${Object.keys(drivers[0]).join(', ')}`);
if (units[0]?.drivers) console.log(`Unit driver slot sample: ${JSON.stringify(Object.keys(units[0].drivers))}`);

const counts = { phone: 0, unit: 0, truck: 0 };
const rows = [];
for (const d of drivers) {
  const phone = driverPhone(d);
  const unit = await findUnitForDriver(d);
  const bil = unit ? bilForUnit(unit, bils) : null;
  if (phone) counts.phone++;
  if (unit) counts.unit++;
  if (phone && bil) counts.truck++;
  rows.push({ name: driverName(d), phone: phone || '-', unit: unit?.label || '-', bil: bil || '-' });
}

// Raw phone formats, digits masked, to see why numbers don't parse.
const raw = drivers.map((d) => String(d.phone ?? '').trim()).filter(Boolean);
const mask = (p) => p.slice(0, 3) + p.slice(3).replace(/\d/g, '#');
const formats = {};
for (const p of raw) formats[mask(p)] = (formats[mask(p)] || 0) + 1;
console.log(`\nPhone field filled in: ${raw.length}/${drivers.length}`);
console.log(`Blocked drivers:       ${drivers.filter((d) => d.blocked && d.blocked !== '0').length}`);
console.log('Most common phone formats (digits after the 3rd character masked):');
for (const [f, n] of Object.entries(formats).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(4)}  "${f}"`);
}

console.log(`\nWith a valid phone:              ${counts.phone}/${drivers.length}`);
console.log(`Assigned to a unit now:          ${counts.unit}/${drivers.length}`);
console.log(`Ready for the bot (phone+truck): ${counts.truck}/${drivers.length}`);

if (show) console.table(rows);

await pool.end();
