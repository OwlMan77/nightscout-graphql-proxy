import {
  Entry,
  GlucoseStats,
  InsulinStatus,
  InsulinStatusInput,
  MealLoggingRow,
  MealLoggingStats,
} from './types';

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

/**
 * How often a meal bolus is accompanied by a carb entry.
 *
 * The pairing is by proximity, not by field: a wizard bolus writes the carbs
 * and the insulin as two separate `Meal Bolus` documents seconds apart, so
 * reading `carbs` off a bolus record alone always looks like a missed entry.
 *
 * `localParts` maps a timestamp to the wearer's local hour and calendar date -
 * injected because the hour of day is the whole point of the breakdown and the
 * server runs in UTC.
 */
export function computeMealLogging(
  rows: MealLoggingRow[],
  options: {
    pairWindowMinutes: number;
    localParts: (iso: string) => { hour: number; date: string };
  }
): MealLoggingStats {
  const at = (row: MealLoggingRow): number => Date.parse(row.created_at ?? '');
  const usable = rows.filter((row) => Number.isFinite(at(row)));
  const meals = usable.filter((row) => row.eventType === 'Meal Bolus');
  const boluses = meals.filter((row) => (row.insulin ?? 0) > 0);
  const carbRows = meals.filter((row) => (row.carbs ?? 0) > 0);
  const wizards = usable.filter((row) => row.eventType === 'Bolus Wizard');

  const pairMs = options.pairWindowMinutes * 60_000;
  // A wizard record is written in the same breath as the bolus it produced, so
  // this window is deliberately tighter than the carb pairing window.
  const wizardMs = 5 * 60_000;
  const within = (row: MealLoggingRow, pool: MealLoggingRow[], ms: number): boolean =>
    pool.some((other) => Math.abs(at(other) - at(row)) <= ms);

  const hours = new Map<number, { boluses: number; logged: number; wizard: number }>();
  const days = new Map<string, { boluses: number; logged: number }>();
  let loggedCount = 0;
  let wizardCount = 0;
  let loggedWithWizard = 0;
  let bolusesWithWizard = 0;

  for (const bolus of boluses) {
    const logged = within(bolus, carbRows, pairMs);
    const wizard = within(bolus, wizards, wizardMs);
    if (logged) loggedCount += 1;
    if (wizard) {
      wizardCount += 1;
      bolusesWithWizard += 1;
      if (logged) loggedWithWizard += 1;
    }
    const { hour, date } = options.localParts(bolus.created_at as string);
    const h = hours.get(hour) ?? { boluses: 0, logged: 0, wizard: 0 };
    h.boluses += 1;
    h.logged += logged ? 1 : 0;
    h.wizard += wizard ? 1 : 0;
    hours.set(hour, h);
    const d = days.get(date) ?? { boluses: 0, logged: 0 };
    d.boluses += 1;
    d.logged += logged ? 1 : 0;
    days.set(date, d);
  }

  const pct = (part: number, whole: number): number | null =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

  const withoutWizard = boluses.length - bolusesWithWizard;
  const carbAmounts = carbRows.map((row) => row.carbs as number).sort((a, b) => a - b);
  const median = carbAmounts.length
    ? carbAmounts[Math.floor((carbAmounts.length - 1) / 2)]
    : null;

  return {
    bolusCount: boluses.length,
    carbEntryCount: carbRows.length,
    loggedCount,
    loggedPercent: pct(loggedCount, boluses.length),
    carbEntriesWithoutBolus: carbRows.filter((row) => !within(row, boluses, pairMs)).length,
    wizardUsedPercent: pct(wizardCount, boluses.length),
    loggedPercentWithWizard: pct(loggedWithWizard, bolusesWithWizard),
    loggedPercentWithoutWizard: pct(loggedCount - loggedWithWizard, withoutWizard),
    medianCarbsGrams: median,
    dayCount: days.size,
    daysWithNoCarbEntry: [...days.values()].filter((day) => day.logged === 0).length,
    byHour: [...hours.entries()]
      .sort(([a], [b]) => a - b)
      .map(([hour, h]) => ({
        hour,
        boluses: h.boluses,
        logged: h.logged,
        loggedPercent: pct(h.logged, h.boluses),
        wizardPercent: pct(h.wizard, h.boluses),
      })),
  };
}
