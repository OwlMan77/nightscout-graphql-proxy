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

  type Query {
    entries(count: Int, find: String): [Entry]
    treatments(count: Int, find: String): [Treatment]
    profiles: [Profile]
    status: Status
  }
`;
