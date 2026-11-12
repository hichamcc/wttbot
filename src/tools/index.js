import { Type } from '@google/genai';
import { getBilList } from '../identity/bils.js';
import { driverName, findDriversByName, findUnitForDriver } from '../identity/mapon.js';
import { bilForUnit, findBil } from '../identity/plate.js';
import { getTripDetails, getTripDocuments, listTrips } from './trips.js';

const truckParam = {
  type: Type.STRING,
  description:
    'Truck plate. Only for office staff asking about a specific truck; leave empty for drivers (their own truck is used).',
};

const driverParam = {
  type: Type.STRING,
  description:
    "Driver name (first and/or last name). Only for office staff asking about a driver; the driver's current truck is used.",
};

const tripIdParam = {
  type: Type.STRING,
  description: 'Trip number as shown in WTTsystem. Leave empty for the current / next trip.',
};

export const declarations = [
  {
    name: 'list_trips',
    description: "List the truck's trips with loading/delivery dates, first pickup and first delivery.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        range: {
          type: Type.STRING,
          enum: ['today', 'upcoming', 'recent'],
          description: "'today' = loading today, 'upcoming' = today and later, 'recent' = before today.",
        },
        truck: truckParam,
        driver: driverParam,
      },
    },
  },
  {
    name: 'get_trip_details',
    description:
      'Full details of one trip: all pickup and delivery stops in order with addresses, dates, trailer, cargo/unload references, temperature, load type and notes.',
    parameters: {
      type: Type.OBJECT,
      properties: { trip_id: tripIdParam, truck: truckParam, driver: driverParam },
    },
  },
  {
    name: 'get_trip_documents',
    description: 'Names of documents attached to a trip (CMR, loading lists, etc.).',
    parameters: {
      type: Type.OBJECT,
      properties: { trip_id: tripIdParam, truck: truckParam, driver: driverParam },
    },
  },
];

/** Truck a named driver is on right now, or an error / list of candidates for the model. */
async function truckForDriver(name) {
  const drivers = await findDriversByName(name);
  if (!drivers.length) return { error: `No driver named "${name}" found in Mapon.` };

  const bils = await getBilList();
  const candidates = [];
  for (const d of drivers.slice(0, 5)) {
    const unit = await findUnitForDriver(d);
    candidates.push({ name: driverName(d), truck: unit ? bilForUnit(unit, bils) : null });
  }

  if (drivers.length > 1) {
    return { error: 'Several drivers match. Ask which one they mean.', candidates, more: drivers.length > 5 };
  }
  const [only] = candidates;
  if (!only.truck) return { error: `${only.name} is not assigned to a truck in Mapon right now.` };
  return { bil: only.truck, driver: only.name };
}

/**
 * The truck a tool call runs against. Drivers are always pinned to their own truck;
 * only staff can switch with the `truck` or `driver` argument.
 */
async function truckFor(ctx, args) {
  if (ctx.isStaff && args.driver && !args.truck) return truckForDriver(args.driver);
  if (ctx.isStaff && args.truck) {
    const bil = findBil(args.truck, await getBilList());
    if (!bil) return { error: `Truck "${args.truck}" not found in WTTsystem.` };
    return { bil };
  }
  if (!ctx.bil) {
    return { error: ctx.isStaff ? 'Ask which truck or driver they mean, then pass it as "truck" or "driver".' : 'No truck linked to this driver.' };
  }
  return { bil: ctx.bil };
}

const handlers = {
  list_trips: (bil, args) => listTrips(bil, args.range),
  get_trip_details: (bil, args) => getTripDetails(bil, args.trip_id),
  get_trip_documents: (bil, args) => getTripDocuments(bil, args.trip_id),
};

export async function runTool(name, args = {}, ctx) {
  const handler = handlers[name];
  if (!handler) return { error: `Unknown tool ${name}` };

  const truck = await truckFor(ctx, args);
  if (truck.error) return truck;
  const result = await handler(truck.bil, args);
  return truck.driver ? { driver: truck.driver, ...result } : result;
}
