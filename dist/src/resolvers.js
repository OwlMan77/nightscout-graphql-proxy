"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvers = void 0;
const BASE_URL = process.env.NIGHTSCOUT_URL;
if (!BASE_URL) {
    console.warn('Warning: NIGHTSCOUT_URL environment variable is not set.');
}
const fetchNightscout = async (endpoint, args) => {
    const url = new URL(`${BASE_URL}${endpoint}`);
    if (args.count)
        url.searchParams.append('count', args.count.toString());
    if (args.find)
        url.searchParams.append('find', args.find);
    const headers = { 'Accept': 'application/json' };
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
exports.resolvers = {
    Query: {
        entries: (_, args) => fetchNightscout('/entries.json', args),
        treatments: (_, args) => fetchNightscout('/treatments.json', args),
        profiles: (_, args) => fetchNightscout('/profile.json', args),
        status: (_, args) => fetchNightscout('/status.json', args),
    },
    Entry: {
        mmol: (parent) => parent.sgv ? parseFloat((parent.sgv / 18.0182).toFixed(1)) : null
    }
};
