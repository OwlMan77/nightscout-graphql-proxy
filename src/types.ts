export interface QueryArgs {
  count?: number;
  find?: string;
  /** Convenience window: only return data from the last N hours. */
  hours?: number;
  /** ISO timestamp (inclusive lower bound) for date-range filtering. */
  from?: string;
  /** ISO timestamp (inclusive upper bound) for date-range filtering. */
  to?: string;
}

export interface StatsArgs {
  hours?: number;
  low?: number;
  high?: number;
}

export interface Entry {
  _id?: string;
  type?: string;
  dateString?: string;
  date?: number;
  sgv?: number;
  mmol?: number;
  direction?: string;
  noise?: number;
  filtered?: number;
  unfiltered?: number;
  rssi?: number;
}

export interface Treatment {
  _id: string;
  eventType?: string;
  created_at?: string;
  glucose?: string;
  glucoseType?: string;
  carbs?: number;
  protein?: number;
  fat?: number;
  insulin?: number;
  units?: string;
  transmitterId?: string;
  sensorCode?: string;
  notes?: string;
  enteredBy?: string;
}

export interface Profile {
  _id: string;
  sens?: number;
  dia?: number;
  carbratio?: number;
  carbs_hr?: number;
}

export interface Status {
  name?: string;
  version?: string;
  apiEnabled?: boolean;
  careportalEnabled?: boolean;
  head?: string;
}

export interface GlucoseStats {
  count: number;
  averageSgv: number | null;
  averageMmol: number | null;
  timeInRangePercent: number | null;
  belowRangePercent: number | null;
  aboveRangePercent: number | null;
  lowThreshold: number;
  highThreshold: number;
  windowHours: number;
}

export interface DeviceStatus {
  created_at?: string;
  device?: string;
  uploaderBattery?: number;
  pumpReservoir?: number | null;
  pumpClock?: string | null;
  pumpStatus?: string | null;
}

export interface InsulinStatusArgs {
  /** Units per vial (default 1000). */
  vialUnits?: number;
  /** Units per pump reservoir fill (default 200). */
  reservoirSize?: number;
  /** Vials per ordered batch (default 3). */
  batchVials?: number;
  /** Flag ordering when estimated remaining drops to this many vials (default 1). */
  orderAtVialsRemaining?: number;
  /** Case-insensitive keyword identifying a "batch received" Note (default "batch"). */
  batchNoteKeyword?: string;
}

/** Pure input to the stock calculation (see analytics.computeInsulinStatus). */
export interface InsulinStatusInput {
  batchStartedAt: string | null;
  reservoirChangesSinceBatch: number;
  bolusInsulinSinceBatch: number;
  pumpReservoirNow: number | null;
  pumpReservoirUpdatedAt: string | null;
  lastNote: string | null;
  /** created_at of an order-placed Note logged since the batch, if any. */
  orderPlacedAt: string | null;
  vialUnits: number;
  reservoirSize: number;
  batchVials: number;
  orderAtVialsRemaining: number;
  batchNoteKeyword: string;
  nowMs: number;
}

export interface InsulinStatus {
  orderInsulin: boolean;
  reason: string;
  batchStartedAt: string | null;
  daysSinceBatch: number | null;
  batchUnits: number;
  reservoirChangesSinceBatch: number;
  estimatedUnitsUsed: number;
  estimatedUnitsRemaining: number | null;
  estimatedVialsRemaining: number | null;
  bolusInsulinSinceBatch: number;
  pumpReservoirNow: number | null;
  pumpReservoirUpdatedAt: string | null;
  lastNote: string | null;
  /** Set when an order has already been logged since the batch (suppresses the flag). */
  orderPlacedAt: string | null;
}

export interface RecordInsulinOrderArgs {
  /** Number of vials ordered (default 3). */
  vials?: number;
  /** Optional free-text appended to the logged note. */
  note?: string;
}

export interface InsulinOrderResult {
  ok: boolean;
  id: string | null;
  createdAt: string;
  notes: string;
}
