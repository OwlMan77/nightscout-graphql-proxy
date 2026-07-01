export interface QueryArgs {
  count?: number;
  find?: string;
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
