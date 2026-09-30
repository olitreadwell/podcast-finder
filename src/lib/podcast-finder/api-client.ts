// The browser side of the app's two routes.
//
// Kept out of the page component so the request shapes and the failure wording
// can be tested without rendering anything, and so the page only has to deal
// with domain types: `Date` objects, not ISO strings.

import { MAX_FEEDS_PER_REQUEST, type PodcastFeedReport } from './feed-report';
import {
  DEFAULT_PODCAST_SEARCH_LIMIT,
  ITUNES_MAX_LIMIT,
  podcastShowFromWire,
  type PodcastSearchOptions,
  type PodcastShow,
  type SerialisedPodcastShow,
} from './itunes-search';

/** Where the page asks Apple-search questions. */
export const PODCAST_SEARCH_ROUTE = '/api/podcast-search';

/** Where the page asks for feed verdicts. */
export const PODCAST_STATUS_ROUTE = '/api/podcast-status';

/** Where the page asks for one publisher's catalogue. */
export const PODCAST_PUBLISHER_ROUTE = '/api/publisher-shows';

/** Where the page asks for a storefront's chart. */
export const PODCAST_CHARTS_ROUTE = '/api/podcast-charts';

/** Where the page asks fyyd. */
export const PODCAST_FYYD_ROUTE = '/api/podcast-fyyd';

/** Where the page asks the Internet Archive. */
export const PODCAST_ARCHIVE_ROUTE = '/api/podcast-archive';

/** Directories the page can ask for shows. */
export type PodcastDirectorySource = 'apple' | 'charts' | 'fyyd' | 'archive';

/** A search that worked, or a sentence saying why it did not. */
export type PodcastSearchOutcome =
  { ok: true; shows: PodcastShow[] } | { ok: false; reason: string };

/** A status batch that worked, or a sentence saying why it did not. */
export type PodcastStatusOutcome =
  { ok: true; reports: PodcastFeedReport[] } | { ok: false; reason: string };

/** Build the search URL the page fetches, with a stable parameter order. */
export function buildPodcastSearchRouteUrl(options: PodcastSearchOptions): string {
  const params = new URLSearchParams();
  params.set('term', options.term.trim());
  params.set('country', options.country ?? 'us');
  if (options.genreId !== undefined && options.genreId > 0)
    params.set('genreId', String(options.genreId));
  params.set('limit', String(options.limit ?? DEFAULT_PODCAST_SEARCH_LIMIT));
  return `${PODCAST_SEARCH_ROUTE}?${params.toString()}`;
}

/** Build the publisher lookup URL the page fetches, with a stable parameter order. */
export function buildPodcastPublisherRouteUrl(artistId: number, country: string): string {
  const params = new URLSearchParams();
  params.set('artistId', String(artistId));
  params.set('country', country);
  return `${PODCAST_PUBLISHER_ROUTE}?${params.toString()}`;
}

/** Build the chart URL the page fetches, with a stable parameter order. */
export function buildPodcastChartsRouteUrl(country: string, limit: number): string {
  const params = new URLSearchParams();
  params.set('country', country);
  params.set('limit', String(limit));
  return `${PODCAST_CHARTS_ROUTE}?${params.toString()}`;
}

/** Build a term-search URL for one of the non-Apple directories. */
export function buildPodcastDirectoryRouteUrl(route: string, term: string, limit: number): string {
  const params = new URLSearchParams();
  params.set('term', term.trim());
  params.set('limit', String(limit));
  return `${route}?${params.toString()}`;
}

/**
 * Read a show list from one of the app's own routes.
 *
 * Every directory answers the same shape, so the only thing that differs is the
 * wording when something goes wrong, which `label` supplies.
 */
async function readShowsFromRoute(
  url: string,
  label: string,
  fetchImpl: typeof fetch
): Promise<PodcastSearchOutcome> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return {
        ok: false,
        reason: await readRouteError(response, `${label} search failed (${response.status}).`),
      };
    }

    const body = (await response.json()) as { shows?: SerialisedPodcastShow[] };
    if (!Array.isArray(body.shows))
      return { ok: false, reason: `${label} returned an unexpected shape.` };

    return { ok: true, shows: body.shows.map(podcastShowFromWire) };
  } catch {
    return { ok: false, reason: `Could not reach the ${label} route.` };
  }
}

/**
 * Ask one directory for shows. Apple answers a topic search, charts answer a
 * storefront's ranked list, and fyyd and the Archive answer a topic search too;
 * the page only has to name the directory.
 */
export async function searchPodcastDirectory(
  source: PodcastDirectorySource,
  options: PodcastSearchOptions,
  fetchImpl: typeof fetch = fetch
): Promise<PodcastSearchOutcome> {
  const limit = options.limit ?? DEFAULT_PODCAST_SEARCH_LIMIT;
  switch (source) {
    case 'apple':
      return searchPodcastShows(options, fetchImpl);
    case 'charts':
      return readShowsFromRoute(
        buildPodcastChartsRouteUrl(options.country ?? 'us', limit),
        'Chart',
        fetchImpl
      );
    case 'fyyd':
      return readShowsFromRoute(
        buildPodcastDirectoryRouteUrl(PODCAST_FYYD_ROUTE, options.term, limit),
        'fyyd',
        fetchImpl
      );
    case 'archive':
      return readShowsFromRoute(
        buildPodcastDirectoryRouteUrl(PODCAST_ARCHIVE_ROUTE, options.term, limit),
        'Archive',
        fetchImpl
      );
  }
}

/** Read a JSON error body, falling back to a generic sentence. */
async function readRouteError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
  } catch {
    // A route that answered HTML or nothing at all gets the fallback sentence.
  }
  return fallback;
}

/** Search Apple through the app's own route, returning domain-typed shows. */
export async function searchPodcastShows(
  options: PodcastSearchOptions,
  fetchImpl: typeof fetch = fetch
): Promise<PodcastSearchOutcome> {
  try {
    const response = await fetchImpl(buildPodcastSearchRouteUrl(options));
    if (!response.ok) {
      return {
        ok: false,
        reason: await readRouteError(response, `Search failed (${response.status}).`),
      };
    }

    const body = (await response.json()) as { shows?: SerialisedPodcastShow[] };
    if (!Array.isArray(body.shows))
      return { ok: false, reason: 'Search returned an unexpected shape.' };

    return { ok: true, shows: body.shows.map(podcastShowFromWire) };
  } catch {
    return { ok: false, reason: 'Could not reach the search route.' };
  }
}

/**
 * List every show Apple files under one publisher, through the app's own route.
 *
 * The artist id comes from Apple and is never typed by a visitor, so the only
 * failure worth a sentence is Apple not answering.
 */
export async function fetchPublisherShows(
  artistId: number,
  country: string,
  fetchImpl: typeof fetch = fetch
): Promise<PodcastSearchOutcome> {
  try {
    const response = await fetchImpl(buildPodcastPublisherRouteUrl(artistId, country));
    if (!response.ok) {
      return {
        ok: false,
        reason: await readRouteError(response, `Publisher lookup failed (${response.status}).`),
      };
    }

    const body = (await response.json()) as { shows?: SerialisedPodcastShow[] };
    if (!Array.isArray(body.shows))
      return { ok: false, reason: 'Publisher lookup returned an unexpected shape.' };

    return { ok: true, shows: body.shows.map(podcastShowFromWire) };
  } catch {
    return { ok: false, reason: 'Could not reach the publisher route.' };
  }
}

/**
 * Ask for verdicts on a batch of feeds. The list is capped here as well as on
 * the server so the page never sends a request it knows will be refused.
 */
export async function fetchPodcastStatus(
  feedUrls: readonly string[],
  fetchImpl: typeof fetch = fetch
): Promise<PodcastStatusOutcome> {
  const feeds = [...new Set(feedUrls)].slice(0, MAX_FEEDS_PER_REQUEST);
  if (feeds.length === 0) return { ok: true, reports: [] };

  try {
    const response = await fetchImpl(PODCAST_STATUS_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feeds }),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: await readRouteError(response, `Status check failed (${response.status}).`),
      };
    }

    const body = (await response.json()) as { reports?: PodcastFeedReport[] };
    if (!Array.isArray(body.reports))
      return { ok: false, reason: 'Status check returned an unexpected shape.' };

    return { ok: true, reports: body.reports };
  } catch {
    return { ok: false, reason: 'Could not reach the status route.' };
  }
}

/** The search limits the page offers, capped to what the route accepts. */
export function clampPodcastResultLimit(limit: number): number {
  return Math.min(ITUNES_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Sentence for the live region while verdicts are still arriving. */
export function describeStatusProgress(answered: number, requested: number): string {
  if (requested === 0) return '';
  if (answered === 0) return `Checking ${requested} shows for recent episodes.`;
  if (answered >= requested) return `Checked all ${requested} shows.`;
  return `Checked ${answered} of ${requested} shows.`;
}

/**
 * The feed URLs worth asking about for a result set: unique, in result order,
 * capped at what the route accepts. Shows Apple returned without a feed URL are
 * dropped, because there is nothing to pull for them.
 */
export function listResultFeedUrls(shows: readonly PodcastShow[]): string[] {
  const urls = new Set<string>();
  for (const show of shows) {
    if (show.feedUrl === null) continue;
    urls.add(show.feedUrl);
    if (urls.size >= MAX_FEEDS_PER_REQUEST) break;
  }
  return [...urls];
}
