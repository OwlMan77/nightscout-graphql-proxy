import { GraphQLError } from 'graphql';
import {
  QueryArgs,
  StatsArgs,
  Entry,
  InsulinStatusArgs,
  RecordInsulinOrderArgs,
  DeviceStatus,
  Profile,
  ProfileStore,
  ProfileValue,
  MealLoggingRow,
} from './types';
import {
  computeGlucoseStats,
  computeInsulinStatus,
  computeMealLogging,
  toMmol,
} from './analytics';
import { MAX_DOCUMENTS, v3Search, windowFilter } from './nightscoutV3';

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

/**
 * Low-level v1 GET. Reads run on v3 now; this remains for /status.json, whose
 * v3 counterpart reports server and storage versions rather than the
 * name/apiEnabled/careportalEnabled shape the Status type exposes.
 */
const nsGet = async (
  endpoint: string,
  params: Record<string, string | number | undefined> = {}
): Promise<any> => {
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

/**
 * Read a windowed collection through v3.
 *
 * v3 returns oldest-first by default whereas v1 returned newest-first, so every
 * read sorts descending on the collection's own date field to keep the
 * published ordering - callers rely on `count: 1` meaning "the latest one".
 */
const readCollection = async <T>(
  collection: string,
  dateField: 'date' | 'created_at',
  args: QueryArgs
): Promise<T[]> => {
  if (args.find) {
    throw new GraphQLError(
      "The 'find' argument is no longer supported: it passed raw MongoDB query " +
        'syntax through to API v1. Use hours, from and to instead.',
      { extensions: { code: 'UNSUPPORTED_ARGUMENT' } }
    );
  }
  const { rows } = await v3Search<T>(collection, {
    filters: {
      ...windowFilter(dateField, args),
      // Treatments are dominated by Temp Basal and loop SMBs, so a caller after
      // meal records would spend its whole `count` budget on noise without this.
      ...(args.eventType ? { 'eventType$eq': args.eventType } : {}),
    },
    sortDesc: dateField,
    limit: args.count,
  });
  return rows;
};

/**
 * Split a timestamp into the local hour and calendar date of an IANA zone.
 * Intl is the only dependency-free way to do this, and the hour of day is
 * meaningless in UTC for a wearer who is not in UTC.
 */
const localPartsIn = (timezone: string) => {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  return (iso: string): { hour: number; date: string } => {
    const parts = format.formatToParts(new Date(iso));
    const get = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? '';
    // hour12:false reports midnight as '24' in some runtimes.
    const hour = Number(get('hour')) % 24;
    return { hour, date: `${get('year')}-${get('month')}-${get('day')}` };
  };
};

/** The active profile's own timezone, or UTC when the profile does not say. */
const wearerTimezone = async (): Promise<string> => {
  try {
    const { rows } = await v3Search<any>('profile', { sortDesc: 'startDate', limit: 1 });
    const doc = rows[0];
    const zone = doc?.store?.[doc?.defaultProfile]?.timezone;
    if (typeof zone === 'string' && zone) {
      // Reject anything Intl cannot use rather than failing the whole query.
      new Intl.DateTimeFormat('en-CA', { timeZone: zone });
      return zone;
    }
  } catch {
    // fall through to UTC
  }
  return 'UTC';
};

/**
 * Profile numbers arrive as numbers from pumps but as strings from Nightscout's
 * own profile editor, so coerce rather than trust the type.
 */
const num = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

const mapSchedule = (raw: unknown): ProfileValue[] | null =>
  Array.isArray(raw)
    ? raw.map((band: any) => ({
        time: band?.time ?? null,
        timeAsSeconds: num(band?.timeAsSeconds),
        value: num(band?.value),
      }))
    : null;

const mapProfileStore = (name: string, store: any): ProfileStore => ({
  name,
  dia: num(store?.dia),
  carbratio: mapSchedule(store?.carbratio),
  sens: mapSchedule(store?.sens),
  basal: mapSchedule(store?.basal),
  target_low: mapSchedule(store?.target_low),
  target_high: mapSchedule(store?.target_high),
  carbs_hr: num(store?.carbs_hr),
  delay: num(store?.delay),
  units: store?.units ?? null,
  timezone: store?.timezone ?? null,
});

/**
 * Flatten a profile document into the published shape.
 *
 * The settings live in a `store` map keyed by profile name ("Normal!",
 * "autosens", ...) and each store holds schedules, not scalars - reading `dia`
 * or `carbratio` off the document itself always came back null.
 */
const mapProfile = (doc: any): Profile => {
  const raw = doc?.store;
  const stores =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.entries(raw).map(([name, store]) => mapProfileStore(name, store))
      : [];
  const defaultProfile = doc?.defaultProfile ?? null;
  return {
    identifier: doc?.identifier ?? null,
    startDate: doc?.startDate ?? null,
    created_at: doc?.created_at ?? null,
    srvModified: num(doc?.srvModified),
    defaultProfile,
    units: doc?.units ?? null,
    stores,
    defaultStore: stores.find((store) => store.name === defaultProfile) ?? null,
  };
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
    entries: (_: unknown, args: QueryArgs) => readCollection<Entry>('entries', 'date', args),
    treatments: (_: unknown, args: QueryArgs) =>
      readCollection('treatments', 'created_at', args),
    mealLogging: async (
      _: unknown,
      args: { days?: number; pairWindowMinutes?: number; timezone?: string }
    ) => {
      const days = Math.max(1, args.days ?? 30);
      const pairWindowMinutes = Math.max(0, args.pairWindowMinutes ?? 15);
      const to = new Date();
      const window = {
        from: new Date(to.getTime() - days * 86_400_000).toISOString(),
        to: to.toISOString(),
      };
      const timezone = args.timezone ?? (await wearerTimezone());
      let localParts: (iso: string) => { hour: number; date: string };
      try {
        localParts = localPartsIn(timezone);
      } catch {
        throw new GraphQLError(`Unknown timezone '${timezone}'.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      // Two fetches because v3's eventType filter matches a single value.
      // Together they are a few hundred documents where the unfiltered window
      // would be tens of thousands.
      const [meals, wizards] = await Promise.all(
        ['Meal Bolus', 'Bolus Wizard'].map((eventType) =>
          v3Search<MealLoggingRow>('treatments', {
            filters: {
              ...windowFilter('created_at', window),
              'eventType$eq': eventType,
            },
            sortDesc: 'created_at',
          })
        )
      );
      return {
        days,
        ...window,
        timezone,
        pairWindowMinutes,
        ...computeMealLogging([...meals.rows, ...wizards.rows], {
          pairWindowMinutes,
          localParts,
        }),
      };
    },

    profiles: async (_: unknown, args: QueryArgs) => {
      // v3 returns oldest-first, so without this sort the first record was the
      // oldest profile switch rather than the settings in force now.
      const { rows } = await v3Search<any>('profile', {
        sortDesc: 'startDate',
        limit: args.count ?? 10,
      });
      return rows.map(mapProfile);
    },
    status: (_: unknown, args: QueryArgs) => nsGet('/status.json', { count: args.count }),

    glucoseStats: async (_: unknown, { hours = 24, low, high }: StatsArgs) => {
      // This previously fetched `hours * 12 * 1.2 + 20` readings, assuming a
      // 5-minute CGM. This sensor reports every 60s, so roughly 80% of every
      // window longer than ~7h was silently dropped - and always the older part,
      // because results come back newest-first. Read the whole window instead,
      // and fail loudly rather than return a truncated one.
      const { rows, truncated } = await v3Search<Entry>('entries', {
        filters: windowFilter('date', { hours }),
        sortDesc: 'date',
        fields: 'date,sgv',
      });
      if (truncated) {
        throw new GraphQLError(
          `The last ${hours}h contains more than ${MAX_DOCUMENTS} readings, which ` +
            'exceeds what the proxy loads in one request. Ask for a shorter window.',
          { extensions: { code: 'WINDOW_TOO_LARGE' } }
        );
      }
      return computeGlucoseStats(rows, low, high, hours);
    },

    deviceStatus: async (_: unknown, args: { count?: number }) => {
      const { rows } = await v3Search<any>('devicestatus', {
        sortDesc: 'created_at',
        limit: args.count ?? 10,
      });
      return rows.map(mapDeviceStatus);
    },

    insulinStatus: async (
      _: unknown,
      {
        vialUnits = 1000,
        reservoirSize = 200,
        batchVials = 3,
        orderAtVialsRemaining = 1,
        batchNoteKeyword = 'batch',
      }: InsulinStatusArgs
    ) => {
      const keyword = batchNoteKeyword.toLowerCase();

      // Notes are returned most-recent-first, so the first match is the latest.
      const { rows: notes } = await v3Search<any>('treatments', {
        filters: { eventType$eq: 'Note' },
        sortDesc: 'created_at',
        limit: 50,
      });
      const batchNote = notes.find((n) => (n?.notes ?? '').toLowerCase().includes(keyword));
      const batchStartedAt: string | null = batchNote?.created_at ?? null;
      const lastNote: string | null = notes[0]?.notes ?? null;

      // Draw-down + order-in-flight are only meaningful relative to a batch.
      let reservoirChangesSinceBatch = 0;
      let bolusInsulinSinceBatch = 0;
      let orderPlacedAt: string | null = null;
      if (batchStartedAt) {
        const { rows: since } = await v3Search<any>('treatments', {
          filters: { created_at$gte: batchStartedAt },
          sortDesc: 'created_at',
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

      const { rows: devices } = await v3Search<any>('devicestatus', {
        sortDesc: 'created_at',
        limit: 20,
      });
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
    recordInsulinOrder: async (_: unknown, { vials = 3, note = '' }: RecordInsulinOrderArgs) => {
      const extra = `${note}`;
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
