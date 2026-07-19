export const typeDefs = /* GraphQL */ `
  type Entry {
    _id: String
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
    _id: ID!
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

  type Profile {
    _id: ID!
    sens: Int
    dia: Int
    carbratio: Int
    carbs_hr: Int
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
  type DeviceStatus {
    created_at: String
    device: String
    uploaderBattery: Float
    pumpReservoir: Float
    pumpClock: String
    pumpStatus: String
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

  type Query {
    """
    Glucose entries. Use 'hours' for a rolling window (last N hours) or
    'from'/'to' ISO timestamps for an explicit range. 'count' caps results.
    """
    entries(count: Int, find: String, hours: Int, from: String, to: String): [Entry]
    treatments(count: Int, find: String, hours: Int, from: String, to: String): [Treatment]
    profiles: [Profile]
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
