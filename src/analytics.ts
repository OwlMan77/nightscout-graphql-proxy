import { Entry, GlucoseStats, InsulinStatus, InsulinStatusInput } from './types';

/** mg/dL → mmol/L conversion factor used across the Nightscout ecosystem. */
export const MGDL_PER_MMOL = 18.0182;

export function toMmol(sgv: number): number {
  return parseFloat((sgv / MGDL_PER_MMOL).toFixed(1));
}

/**
 * Compute glucose statistics over a set of entries. Pure and side-effect free
 * so it can be unit tested with known SGV arrays.
 *
 * @param entries   SGV entries fetched from Nightscout
 * @param low       lower bound of the target range, in mg/dL (default 70)
 * @param high      upper bound of the target range, in mg/dL (default 180)
 * @param windowHours the time window the entries were drawn from (for reporting)
 */
export function computeGlucoseStats(
  entries: Entry[],
  low = 70,
  high = 180,
  windowHours = 24
): GlucoseStats {
  const sgvs = entries
    .map((e) => e.sgv)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  const count = sgvs.length;

  if (count === 0) {
    return {
      count: 0,
      averageSgv: null,
      averageMmol: null,
      timeInRangePercent: null,
      belowRangePercent: null,
      aboveRangePercent: null,
      lowThreshold: low,
      highThreshold: high,
      windowHours,
    };
  }

  const sum = sgvs.reduce((acc, v) => acc + v, 0);
  const averageSgv = parseFloat((sum / count).toFixed(1));

  const below = sgvs.filter((v) => v < low).length;
  const above = sgvs.filter((v) => v > high).length;
  const inRange = count - below - above;

  const pct = (n: number) => parseFloat(((n / count) * 100).toFixed(1));

  return {
    count,
    averageSgv,
    averageMmol: toMmol(averageSgv),
    timeInRangePercent: pct(inRange),
    belowRangePercent: pct(below),
    aboveRangePercent: pct(above),
    lowThreshold: low,
    highThreshold: high,
    windowHours,
  };
}

const round = (n: number, dp = 1) => parseFloat(n.toFixed(dp));

/**
 * Estimate home insulin stock and decide whether to reorder. Pure/testable.
 *
 * Model (all values configurable): a batch of `batchVials` vials of `vialUnits`
 * each is added to home stock when a "batch" Note is logged. Every reservoir
 * refill (a Nightscout "Insulin Change" event) draws ~`reservoirSize` units from
 * that stock. When the estimated remaining stock falls to `orderAtVialsRemaining`
 * vials (i.e. about to open the final vial), `orderInsulin` flips true.
 *
 * `bolusInsulinSinceBatch` and `pumpReservoirNow` are surfaced as context only —
 * they do not drive the decision (bolus totals exclude basal; reservoir is what's
 * in the pump now, not home stock).
 */
export function computeInsulinStatus(i: InsulinStatusInput): InsulinStatus {
  const batchUnits = i.batchVials * i.vialUnits;
  const estimatedUnitsUsed = i.reservoirChangesSinceBatch * i.reservoirSize;
  const bolus = round(i.bolusInsulinSinceBatch);

  // No batch marker yet — we can't estimate stock. Guide the user to log one.
  if (!i.batchStartedAt) {
    return {
      orderInsulin: false,
      reason:
        `No batch Note found. Log a Note containing "${i.batchNoteKeyword}" when a ` +
        `new batch arrives (${i.batchVials} vials) so stock can be tracked.`,
      batchStartedAt: null,
      daysSinceBatch: null,
      batchUnits,
      reservoirChangesSinceBatch: i.reservoirChangesSinceBatch,
      estimatedUnitsUsed,
      estimatedUnitsRemaining: null,
      estimatedVialsRemaining: null,
      bolusInsulinSinceBatch: bolus,
      pumpReservoirNow: i.pumpReservoirNow,
      pumpReservoirUpdatedAt: i.pumpReservoirUpdatedAt,
      lastNote: i.lastNote,
      orderPlacedAt: i.orderPlacedAt,
    };
  }

  const estimatedUnitsRemaining = Math.max(0, batchUnits - estimatedUnitsUsed);
  const estimatedVialsRemaining = round(estimatedUnitsRemaining / i.vialUnits);
  const daysSinceBatch = round((i.nowMs - Date.parse(i.batchStartedAt)) / 86_400_000);
  const belowThreshold = estimatedVialsRemaining <= i.orderAtVialsRemaining;
  // Suppress the flag once an order has been logged (until the next batch resets it).
  const orderInsulin = belowThreshold && !i.orderPlacedAt;

  const stockLine =
    `~${estimatedUnitsRemaining}u (~${estimatedVialsRemaining} vial(s)) left of a ${batchUnits}u ` +
    `batch after ${i.reservoirChangesSinceBatch} reservoir change(s) over ${daysSinceBatch} day(s)`;

  let reason: string;
  if (belowThreshold && i.orderPlacedAt) {
    reason = `Order already placed on ${i.orderPlacedAt}; awaiting new batch. ${stockLine}.`;
  } else if (orderInsulin) {
    reason = `Order now: ${stockLine} — about to reach the final vial.`;
  } else {
    reason = `OK: ${stockLine}. No need to order yet.`;
  }

  return {
    orderInsulin,
    reason,
    batchStartedAt: i.batchStartedAt,
    daysSinceBatch,
    batchUnits,
    reservoirChangesSinceBatch: i.reservoirChangesSinceBatch,
    estimatedUnitsUsed,
    estimatedUnitsRemaining,
    estimatedVialsRemaining,
    bolusInsulinSinceBatch: bolus,
    pumpReservoirNow: i.pumpReservoirNow,
    pumpReservoirUpdatedAt: i.pumpReservoirUpdatedAt,
    lastNote: i.lastNote,
    orderPlacedAt: i.orderPlacedAt,
  };
}
