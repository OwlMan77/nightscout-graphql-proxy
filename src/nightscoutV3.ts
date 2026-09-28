/**
 * Nightscout API v3 client.
 *
 * Why v3: it supports field projection (`fields`), real pagination
 * (`limit`+`skip`) and a documented generic filter syntax (`<field>$<op>`).
 * Fetching 1000 readings as two fields is ~33 KB against ~234 KB for v1's full
 * documents.
 *
 * Two constraints shape this module:
 *  - v3 caps `limit` at 1000 per request (1001 returns 400 "Parameter limit out
 *    of tolerance"). That cap is NOT in the OpenAPI spec, which declares only
 *    `minimum: 1`. So long windows need paging.
 *  - The proxy runs in Lambda behind an API Gateway HTTP API, whose integration
 *    timeout is 30s. Pages are therefore fetched in small concurrent waves, and
 *    a hard ceiling makes over-large requests fail loudly rather than return a
 *    silently truncated window.
 */

import { GraphQLError } from 'graphql';

/** v3 rejects limit > 1000. */
const V3_MAX_LIMIT = 1000;

/** Pages fetched concurrently per wave. Keeps long windows inside the 30s budget. */
const CONCURRENCY = 5;

/** Ceiling on documents per search. Exceeding it throws instead of truncating. */
export const MAX_DOCUMENTS = 30000;

/** Refresh the JWT this long before it expires. */
const JWT_SKEW_MS = 60_000;

/** NIGHTSCOUT_URL points at /api/v1; v3 and the auth endpoint hang off the root. */
const rootUrl = (): string => {
  const raw = process.env.NIGHTSCOUT_URL;
  if (!raw) {
    throw new GraphQLError('NIGHTSCOUT_URL is not configured on the proxy.', {
      extensions: { code: 'NOT_CONFIGURED' },
    });
  }
  return raw.replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
};

let cachedJwt: { token: string; expiresAtMs: number } | null = null;

/** Exposed for tests: forget any cached JWT. */
export const resetAuthCache = (): void => {
  cachedJwt = null;
};

/**
 * Exchange the subject token for a JWT, cached until shortly before expiry.
 * v3 refuses the subject token directly - it must be swapped at
 * /api/v2/authorization/request/<token>, which returns a ~8h JWT.
 */
const getJwt = async (): Promise<string> => {
  const subject = process.env.NIGHTSCOUT_TOKEN;
  if (!subject) {
    throw new GraphQLError(
      'NIGHTSCOUT_TOKEN is not configured on the proxy. Create a subject token ' +
        'in Nightscout Admin Tools and set it as NIGHTSCOUT_TOKEN.',
      { extensions: { code: 'NOT_CONFIGURED' } }
    );
  }

  if (cachedJwt && cachedJwt.expiresAtMs - JWT_SKEW_MS > Date.now()) {
    return cachedJwt.token;
  }

  const url = `${rootUrl()}/api/v2/authorization/request/${encodeURIComponent(subject)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new GraphQLError(
      `Nightscout rejected the access token (HTTP ${response.status}).`,
      { extensions: { code: 'UPSTREAM_AUTH_FAILED' } }
    );
  }

  const body: any = await response.json();
  if (!body?.token) {
    throw new GraphQLError('Nightscout returned no JWT for the access token.', {
      extensions: { code: 'UPSTREAM_AUTH_FAILED' },
    });
  }

  // `exp` is in seconds; fall back to a conservative hour if it is absent.
  const expiresAtMs =
    typeof body.exp === 'number' ? body.exp * 1000 : Date.now() + 3_600_000;
  cachedJwt = { token: body.token, expiresAtMs };
  return cachedJwt.token;
};

export interface V3SearchOptions {
  /** Filter clauses already in v3 form, e.g. { 'date$gte': '1790000000000' }. */
  filters?: Record<string, string | number | undefined>;
  /** Field to sort by, descending. Mutually exclusive with `sort`. */
  sortDesc?: string;
  /** Field to sort by, ascending. */
  sort?: string;
  /** Comma-separated projection, e.g. 'date,sgv'. Omit for whole documents. */
  fields?: string;
  /** Stop after this many documents. Defaults to MAX_DOCUMENTS. */
  limit?: number;
}

export interface V3SearchResult<T> {
  rows: T[];
  /** True when the ceiling was reached and more documents almost certainly exist. */
  truncated: boolean;
}

const fetchPage = async <T>(
  collection: string,
  options: V3SearchOptions,
  limit: number,
  skip: number,
  jwt: string
): Promise<T[]> => {
  const url = new URL(`${rootUrl()}/api/v3/${collection}`);
  for (const [key, value] of Object.entries(options.filters ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }
  if (options.fields) url.searchParams.append('fields', options.fields);
  if (options.sortDesc) url.searchParams.append('sort$desc', options.sortDesc);
  else if (options.sort) url.searchParams.append('sort', options.sort);
  url.searchParams.append('limit', String(limit));
  if (skip > 0) url.searchParams.append('skip', String(skip));

  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GraphQLError(
      `Nightscout v3 error on ${collection} (HTTP ${response.status}): ${detail.slice(0, 200)}`,
      { extensions: { code: 'UPSTREAM_ERROR' } }
    );
  }
  const body: any = await response.json();
  return (body?.result ?? []) as T[];
};

/**
 * Search a v3 collection, paging past the 1000-document cap.
 *
 * Pages go out in concurrent waves. A wave containing a short page has reached
 * the end of the collection, so paging stops after it.
 */
export const v3Search = async <T>(
  collection: string,
  options: V3SearchOptions = {}
): Promise<V3SearchResult<T>> => {
  const ceiling = Math.min(options.limit ?? MAX_DOCUMENTS, MAX_DOCUMENTS);
  const jwt = await getJwt();
  const rows: T[] = [];
  let skip = 0;
  let exhausted = false;

  while (!exhausted && rows.length < ceiling) {
    const wave: Promise<T[]>[] = [];
    for (let slot = 0; slot < CONCURRENCY; slot += 1) {
      const alreadyRequested = slot * V3_MAX_LIMIT;
      const remaining = ceiling - rows.length - alreadyRequested;
      if (remaining <= 0) break;
      const pageSize = Math.min(V3_MAX_LIMIT, remaining);
      wave.push(fetchPage<T>(collection, options, pageSize, skip + alreadyRequested, jwt));
    }
    if (wave.length === 0) break;

    const pages = await Promise.all(wave);
    for (const page of pages) {
      rows.push(...page);
      // A short page means the collection ran out. Later pages in this wave were
      // requested from beyond that point and simply come back empty.
      if (page.length < V3_MAX_LIMIT) exhausted = true;
    }
    skip += wave.length * V3_MAX_LIMIT;
  }

  const trimmed = rows.slice(0, ceiling);
  return { rows: trimmed, truncated: !exhausted && trimmed.length >= ceiling };
};

/** GET /api/v3/status - includes the token's effective apiPermissions. */
export const v3Status = async (): Promise<any> => {
  const jwt = await getJwt();
  const response = await fetch(`${rootUrl()}/api/v3/status`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) {
    throw new GraphQLError(`Nightscout v3 status failed (HTTP ${response.status}).`, {
      extensions: { code: 'UPSTREAM_ERROR' },
    });
  }
  const body: any = await response.json();
  return body?.result ?? {};
};

/**
 * Translate the GraphQL window args into a v3 filter for one collection.
 * Entries store an epoch-millisecond `date`; treatments and devicestatus store
 * an ISO `created_at`. Filtering the wrong field silently matches nothing -
 * which is exactly the bug this replaces.
 */
export const windowFilter = (
  dateField: 'date' | 'created_at',
  args: { hours?: number; from?: string; to?: string }
): Record<string, string> => {
  const filters: Record<string, string> = {};
  let fromIso = args.from;
  if (!fromIso && args.hours) {
    fromIso = new Date(Date.now() - args.hours * 3_600_000).toISOString();
  }
  const encode = (iso: string): string =>
    dateField === 'date' ? String(Date.parse(iso)) : iso;

  if (fromIso) filters[`${dateField}$gte`] = encode(fromIso);
  if (args.to) filters[`${dateField}$lte`] = encode(args.to);
  return filters;
};
