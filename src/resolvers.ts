import { QueryArgs, Entry } from './types';

const BASE_URL = process.env.NIGHTSCOUT_URL;

if (!BASE_URL) {
  console.warn('Warning: NIGHTSCOUT_URL environment variable is not set.');
}

const fetchNightscout = async (endpoint: string, args: QueryArgs): Promise<any> => {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (args.count) url.searchParams.append('count', args.count.toString());
  if (args.find) url.searchParams.append('find', args.find);
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (process.env.NIGHTSCOUT_API_SECRET) {
    // Nightscout API uses api-secret header (typically SHA1 hashed, but we can pass whatever the user provides)
    headers['api-secret'] = process.env.NIGHTSCOUT_API_SECRET;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Nightscout API Error: ${response.statusText}`);
  }
  return response.json();
};

export const resolvers = {
  Query: {
    entries: (_: unknown, args: QueryArgs) => fetchNightscout('/entries.json', args),
    treatments: (_: unknown, args: QueryArgs) => fetchNightscout('/treatments.json', args),
    profiles: (_: unknown, args: QueryArgs) => fetchNightscout('/profile.json', args),
    status: (_: unknown, args: QueryArgs) => fetchNightscout('/status.json', args),
  },
  Entry: {
    mmol: (parent: Entry) => parent.sgv ? parseFloat((parent.sgv / 18.0182).toFixed(1)) : null
  }
};
