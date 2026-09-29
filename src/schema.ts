export const typeDefs = /* GraphQL */ `
  type Entry {
    identifier: String
    type: String
    dateString: String
    date: Float
    sgv: Float
    mmol: Float
    direction: String
    noise: Float
    filtered: Float
    unfiltered: Float
    rssi: Float
  }

  type Treatment {
    identifier: String
    eventType: String
    created_at: String
    glucose: String
    glucoseType: String
    carbs: Float
    protein: Float
    fat: Float
    insulin: Float
    units: String
    transmitterId: String
    sensorCode: String
    notes: String
    enteredBy: String
  }

  """
  One band of a profile schedule. 'time' is local clock time in the profile's
  own timezone and 'timeAsSeconds' is seconds from local midnight; the band runs
  until the next one starts.
  """
  type ProfileValue {
    time: String
    timeAsSeconds: Int
    value: Float
  }

  """
  One named settings store inside a profile document, e.g. "Normal!" or
  "autosens". Every rate is a schedule of time-banded values, never a single
  number.

  'units' is the glucose unit these settings are expressed in, and it governs
  'sens', 'target_low' and 'target_high' - when it is "mmol" those are mmol/L,
  not the mg/dL used everywhere else in this schema. 'carbratio' is grams of
  carbohydrate per unit of insulin and 'dia' is hours, in either unit system.
  """
  type ProfileStore {
    "The store's key within the profile document."
    name: String!
    "Duration of insulin action, in hours."
    dia: Float
    "Grams of carbohydrate per unit of insulin."
    carbratio: [ProfileValue]
    "Insulin sensitivity: glucose drop per unit, in this store's 'units'."
    sens: [ProfileValue]
    "Basal rate, in units per hour."
    basal: [ProfileValue]
    "Lower bound of the target range, in this store's 'units'."
    target_low: [ProfileValue]
    "Upper bound of the target range, in this store's 'units'."
    target_high: [ProfileValue]
    "Carbohydrate absorption per hour. Absent from pump-uploaded profiles."
    carbs_hr: Float
    "Carb absorption delay in minutes. Absent from pump-uploaded profiles."
    delay: Float
    """Either "mmol" or "mg/dl"."""
    units: String
    timezone: String
  }

  """
  A Nightscout profile document: one record in the profile-switch history,
  holding every named store that was uploaded at that moment. 'defaultProfile'
  names the store that was active, and 'defaultStore' resolves it.

  Doc-level 'units' is only set by profiles created in Nightscout itself; for
  pump-uploaded profiles the unit lives on each store.
  """
  type Profile {
    identifier: String
    "When this profile took effect."
    startDate: String
    created_at: String
    "Server modification time, epoch milliseconds."
    srvModified: Float
    "Name of the store that was active."
    defaultProfile: String
    units: String
    stores: [ProfileStore]
    "The store named by 'defaultProfile', or null if it is missing."
    defaultStore: ProfileStore
  }

  type Status {
    name: String
    version: String
    apiEnabled: Boolean
    careportalEnabled: Boolean
    head: String
  }

  """
  Aggregate glucose statistics computed over a time window. Percentages are
  0-100 and null when no readings are available in the window.
  """
  type GlucoseStats {
    count: Int!
    averageSgv: Float
    averageMmol: Float
    timeInRangePercent: Float
    belowRangePercent: Float
    aboveRangePercent: Float
    lowThreshold: Float!
    highThreshold: Float!
    windowHours: Float!
  }

  """
  Latest pump / uploader device status. 'pumpReservoir' is the units of insulin
  remaining in the pump reservoir.
  """
  """
  One pump-and-loop status upload. AAPS writes two shapes of these a minute or
  two apart - a pump-only one and a loop one - so roughly half of all documents
  have every loop field below null. Read several records back to find the most
  recent completed loop pass rather than assuming the newest document has one.
  """
  type DeviceStatus {
    created_at: String
    device: String
    uploaderBattery: Float
    pumpReservoir: Float
    pumpClock: String
    pumpStatus: String

    """
    Insulin on board in units, as the loop itself computed it. A bolus goes on
    acting for the profile's dia (5 hours here), so this is routinely several
    units when nothing has been delivered for an hour or more, and no other
    field here substitutes for it.
    """
    iob: Float
    """
    The part of iob attributed to basal rather than boluses. Goes negative
    after the loop has been suppressing basal.
    """
    basalIob: Float
    """How fast that insulin is acting right now, units per minute."""
    insulinActivity: Float
    """
    Carbs on board in grams. Zero whenever no carbs were entered, which is most
    of the time on this account - it reflects what was logged, not what was
    eaten, and a protein or fat meal legitimately produces zero.
    """
    cob: Float
    """
    Autosens multiplier applied to the profile sensitivity: 1.0 is the profile
    as configured, above 1.0 means the loop judged the wearer more sensitive.
    """
    sensitivityRatio: Float
    """Where the loop expected glucose to settle, mg/dL."""
    eventualGlucose: Float
    """
    Units the loop calculated it wanted on that pass, and then acted on itself
    through an SMB or a temp basal. It is a record of what the algorithm did for
    that one minute's glucose, IOB and trend - all long since moved - and not a
    dose for anyone to act on or relay.
    """
    insulinRequired: Float
    """
    The loop's own one-line account of the pass: COB, deviation, BGI, ISF, carb
    ratio, target and its predicted curves.
    """
    loopReason: String
    """When the loop pass ran, slightly before created_at."""
    loopAt: String
  }

  """
  Home insulin-stock estimate and reorder flag for agents. Stock is tracked from
  a "batch received" Note (adds vials) and drawn down by each reservoir refill
  ("Insulin Change" event). 'orderInsulin' is the flag to act on; 'reason'
  explains it. This is a supply-tracking heuristic, not medical advice.
  """
  type InsulinStatus {
    orderInsulin: Boolean!
    reason: String!
    batchStartedAt: String
    daysSinceBatch: Float
    batchUnits: Float!
    reservoirChangesSinceBatch: Int!
    estimatedUnitsUsed: Float!
    estimatedUnitsRemaining: Float
    estimatedVialsRemaining: Float
    bolusInsulinSinceBatch: Float!
    pumpReservoirNow: Float
    pumpReservoirUpdatedAt: String
    lastNote: String
    orderPlacedAt: String
  }

  "Result of logging an insulin order to Nightscout."
  type InsulinOrderResult {
    ok: Boolean!
    id: String
    createdAt: String!
    notes: String!
  }

  "Carb-entry rate for one local hour of day."
  type MealLoggingHour {
    "Local hour, 0-23."
    hour: Int!
    "Insulin-bearing 'Meal Bolus' records in this hour."
    boluses: Int!
    "How many of them had a carb entry nearby."
    logged: Int!
    loggedPercent: Float
    "How many went through the Bolus Wizard - the strongest predictor of a carb entry."
    wizardPercent: Float
  }

  "How reliably meals get a carb entry, over a window."
  type MealLogging {
    days: Int!
    from: String!
    to: String!
    "IANA zone the hours are expressed in."
    timezone: String!
    "Minutes either side of a bolus in which a carb entry counts as its own."
    pairWindowMinutes: Int!
    "Insulin-bearing 'Meal Bolus' records: one per meal the wearer bolused for."
    bolusCount: Int!
    "Carb-bearing 'Meal Bolus' records in the same window."
    carbEntryCount: Int!
    loggedCount: Int!
    loggedPercent: Float
    "Carb entries with no bolus nearby, e.g. a hypo treatment."
    carbEntriesWithoutBolus: Int!
    wizardUsedPercent: Float
    loggedPercentWithWizard: Float
    loggedPercentWithoutWizard: Float
    medianCarbsGrams: Float
    "Days with at least one meal bolus."
    dayCount: Int!
    "Of those, days with no carb entry at all."
    daysWithNoCarbEntry: Int!
    byHour: [MealLoggingHour!]!
  }

  type Query {
    """
    Glucose entries. Use 'hours' for a rolling window (last N hours) or
    'from'/'to' ISO timestamps for an explicit range. 'count' caps results.
    """
    entries(count: Int, find: String, hours: Int, from: String, to: String): [Entry]

    """
    Logged treatments, newest first. 'eventType' matches one type exactly and is
    usually essential: a looping pump writes thousands of 'Temp Basal' and
    automatic 'Correction Bolus' (SMB) records, which otherwise crowd out the
    user-entered ones within 'count'. Food records are 'Meal Bolus'; a wizard
    bolus writes the carbs and the insulin as two separate 'Meal Bolus'
    documents seconds apart, plus a 'Bolus Wizard' record.
    """
    treatments(
      count: Int
      find: String
      hours: Int
      from: String
      to: String
      eventType: String
    ): [Treatment]

    """
    How often a meal bolus is accompanied by a carb entry, broken down by local
    hour of day. Answers "when do carb entries get missed" without shipping
    thousands of treatment records to the caller.

    A wizard bolus writes the carbs and the insulin as two separate 'Meal Bolus'
    documents seconds apart, so a bolus counts as logged when a carb entry falls
    within 'pairWindowMinutes' of it - reading 'carbs' off the bolus record
    itself would score almost every meal as missed.

    Hours are local to 'timezone', which defaults to the active profile's own
    timezone. Percentages are null where the denominator is zero.
    """
    mealLogging(days: Int = 30, pairWindowMinutes: Int = 15, timezone: String): MealLogging

    """
    Profile-switch history, newest first. The settings in force now are the
    first record's 'defaultStore'.
    """
    profiles(count: Int = 10): [Profile]
    status: Status

    """
    Aggregate stats (average, time-in-range) over the last 'hours' hours.
    'low'/'high' set the target range in mg/dL (defaults 70/180).
    """
    glucoseStats(hours: Int = 24, low: Float = 70, high: Float = 180): GlucoseStats

    "Latest device status records (most recent first)."
    deviceStatus(count: Int = 10): [DeviceStatus]

    """
    Estimate home insulin stock and whether to reorder. Constants default to
    1000u vials, 200u reservoirs, batches of 3 vials, ordering when about to
    open the final vial. 'batchNoteKeyword' matches the batch-received Note.
    """
    insulinStatus(
      vialUnits: Float = 1000
      reservoirSize: Float = 200
      batchVials: Int = 3
      orderAtVialsRemaining: Float = 1
      batchNoteKeyword: String = "batch"
    ): InsulinStatus
  }

  type Mutation {
    """
    Record that an insulin batch has been ordered. Writes a Note to Nightscout
    (tagged so insulinStatus stops flagging until the next batch arrives).
    Requires the proxy to have NIGHTSCOUT_API_SECRET configured (write access).
    """
    recordInsulinOrder(vials: Int = 3, note: String): InsulinOrderResult
  }
`;
