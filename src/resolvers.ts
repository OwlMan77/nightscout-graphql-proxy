import { GraphQLError } from 'graphql';
import {
  QueryArgs,
  StatsArgs,
  Entry,
  InsulinStatusArgs,
  RecordInsulinOrderArgs,
  DeviceStatus,
} from './types';
import { computeGlucoseStats, computeInsulinStatus, toMmol } from './analytics';

const BASE_URL = process.env.NIGHTSCOUT_URL;

if (!BASE_URL) {
  console.warn('Warning: NIGHTSCOUT_URL environment variable is not set.');
}

// Tag embedded in the Note written by recordInsulinOrder; insulinStatus looks
// for it to know an order is already in flight and stop flagging.
const ORDER_TAG = '[insulin-order]';

const nsHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.NIGHTSCOUT_API_SECRET) {
    headers['api-secret'] = process.env.NIGHTSCOUT_API_SECRET;
  }
  return headers;
};

/** Low-level GET against the Nightscout REST API with arbitrary query params. */
const nsGet = async (endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<any> => {
  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
  }
  const response = await fetch(url, { headers: nsHeaders() });
  if (!response.ok) {
    throw new Error(`Nightscout API Error: ${response.statusText}`);
  }
  return response.json();
};

/** Low-level POST for writes (treatments). Requires the API secret. */
const nsPost = async (endpoint: string, payload: unknown): Promise<any> => {
  if (!process.env.NIGHTSCOUT_API_SECRET) {
    throw new GraphQLError(
      'Writing to Nightscout requires NIGHTSCOUT_API_SECRET to be configured on the proxy.',
      { extensions: { code: 'WRITE_NOT_CONFIGURED' } }
    );
  }
  const url = new URL(`${BASE_URL}${endpoint}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...nsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Nightscout API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

/** Translate friendly QueryArgs (count/find/hours/from/to) into Nightscout params. */
const fetchNightscout = (endpoint: string, args: QueryArgs): Promise<any> => {
  const params: Record<string, string | number | undefined> = {
    count: args.count,
    find: args.find,
  };
  let from = args.from;
  if (!from && args.hours) {
    from = new Date(Date.now() - args.hours * 60 * 60 * 1000).toISOString();
  }
  if (from) params['find[dateString][$gte]'] = from;
  if (args.to) params['find[dateString][$lte]'] = args.to;
  return nsGet(endpoint, params);
};

const mapDeviceStatus = (d: any): DeviceStatus => ({
  created_at: d?.created_at,
  device: d?.device,
  uploaderBattery: d?.uploaderBattery,
  pumpReservoir: typeof d?.pump?.reservoir === 'number' ? d.pump.reservoir : null,
  pumpClock: d?.pump?.clock ?? null,
  pumpStatus: d?.pump?.status?.status ?? null,
});

export const resolvers = {
  Query: {
    entries: (_: unknown, args: QueryArgs) => fetchNightscout('/entries.json', args),
    treatments: (_: unknown, args: QueryArgs) => fetchNightscout('/treatments.json', args),
    profiles: (_: unknown, args: QueryArgs) => fetchNightscout('/profile.json', args),
    status: (_: unknown, args: QueryArgs) => fetchNightscout('/status.json', args),

    glucoseStats: async (_: unknown, args: StatsArgs) => {
      const hours = args.hours ?? 24;
      // CGM reports ~12 readings/hour; over-fetch a little so the window is complete.
      const count = Math.ceil(hours * 12 * 1.2) + 20;
      const entries: Entry[] = await fetchNightscout('/entries.json', { hours, count });
      return computeGlucoseStats(entries, args.low, args.high, hours);
    },

    deviceStatus: async (_: unknown, args: { count?: number }) => {
      const records: any[] = await nsGet('/devicestatus.json', { count: args.count ?? 10 });
      return records.map(mapDeviceStatus);
    },

    insulinStatus: async (_: unknown, args: InsulinStatusArgs) => {
      const vialUnits = args.vialUnits ?? 1000;
      const reservoirSize = args.reservoirSize ?? 200;
      const batchVials = args.batchVials ?? 3;
      const orderAtVialsRemaining = args.orderAtVialsRemaining ?? 1;
      const keyword = (args.batchNoteKeyword ?? 'batch').toLowerCase();

      // Notes are returned most-recent-first, so the first match is the latest.
      const notes: any[] = await nsGet('/treatments.json', {
        'find[eventType]': 'Note',
        count: 50,
      });
      const batchNote = notes.find((n) => (n?.notes ?? '').toLowerCase().includes(keyword));
      const batchStartedAt: string | null = batchNote?.created_at ?? null;
      const lastNote: string | null = notes[0]?.notes ?? null;

      // Draw-down + order-in-flight are only meaningful relative to a batch.
      let reservoirChangesSinceBatch = 0;
      let bolusInsulinSinceBatch = 0;
      let orderPlacedAt: string | null = null;
      if (batchStartedAt) {
        const since: any[] = await nsGet('/treatments.json', {
          'find[created_at][$gte]': batchStartedAt,
          count: 1000,
        });
        reservoirChangesSinceBatch = since.filter((t) => t?.eventType === 'Insulin Change').length;
        bolusInsulinSinceBatch = since.reduce(
          (sum, t) => sum + (typeof t?.insulin === 'number' ? t.insulin : 0),
          0
        );
        const orderNote = notes.find(
          (n) =>
            (n?.notes ?? '').includes(ORDER_TAG) &&
            n?.created_at &&
            Date.parse(n.created_at) >= Date.parse(batchStartedAt)
        );
        orderPlacedAt = orderNote?.created_at ?? null;
      }

      const devices: any[] = await nsGet('/devicestatus.json', { count: 20 });
      const withReservoir = devices.find((d) => typeof d?.pump?.reservoir === 'number');

      return computeInsulinStatus({
        batchStartedAt,
        reservoirChangesSinceBatch,
        bolusInsulinSinceBatch,
        pumpReservoirNow: withReservoir ? withReservoir.pump.reservoir : null,
        pumpReservoirUpdatedAt: withReservoir?.created_at ?? null,
        lastNote,
        orderPlacedAt,
        vialUnits,
        reservoirSize,
        batchVials,
        orderAtVialsRemaining,
        batchNoteKeyword: keyword,
        nowMs: Date.now(),
      });
    },
  },

  Mutation: {
    recordInsulinOrder: async (_: unknown, args: RecordInsulinOrderArgs) => {
      const vials = args.vials ?? 3;
      const extra = args.note ? ` ${args.note}` : '';
      const createdAt = new Date().toISOString();
      const notes = `${ORDER_TAG} Ordered insulin batch: ${vials} vial(s).${extra}`;
      const payload = [
        { eventType: 'Note', notes, enteredBy: 'graphql-proxy', created_at: createdAt },
      ];
      const result = await nsPost('/treatments.json', payload);
      const created = Array.isArray(result) ? result[0] : result;
      return {
        ok: true,
        id: created?._id ?? null,
        createdAt,
        notes,
      };
    },
  },

  Entry: {
    mmol: (parent: Entry) => (parent.sgv ? toMmol(parent.sgv) : null),
  },
};
