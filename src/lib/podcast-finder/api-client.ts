// The browser side of the app's two routes.
//
// Kept out of the page component so the request shapes and the failure wording
// can be tested without rendering anything, and so the page only has to deal
// with domain types: `Date` objects, not ISO strings.

import { MAX_FEEDS_PER_REQUEST, type PodcastFeedReport } from './feed-report';
import type { PodcastSourceCount } from './directory-mix';
import {
  podcastShowFromWire,
  type PodcastSearchOptions,
  type PodcastShow,
  type SerialisedPodcastShow,
} from './itunes-search';

/** Where the page asks its one search question. */
export const PODCAST_SEARCH_ROUTE = '/api/podcast-search';

/** Where the page asks for feed verdicts. */
export const PODCAST_STATUS_ROUTE = '/api/podcast-status';

/** Where the page asks for one publisher's catalogue. */
export const PODCAST_PUBLISHER_ROUTE = '/api/publisher-shows';

/** What a search asks for. The directories and the row budget are the server's
 * business, so the page only says what it is looking for. */
export type PodcastSearchRequest = Pick<PodcastSearchOptions, 'term' | 'country' | 'genreId'>;

/**
 * A merged search that worked, or a sentence saying why it did not.
 *
 * The directories that failed are `unavailable` rather than a failure, because
 * one directory down is worth a note beside the results.
 */
export type PodcastSearchOutcome =
  | {
      ok: true;
      shows: PodcastShow[];
      counts: PodcastSourceCount[];
      archiveItems: PodcastShow[];
      unavailable: string[];
    }
  | { ok: false; reason: string };

/** A list of shows that worked, or a sentence saying why it did not. */
export type PodcastShowsOutcome =
  { ok: true; shows: PodcastShow[] } | { ok: false; reason: string };

/** A status batch that worked, or a sentence saying why it did not. */
export type PodcastStatusOutcome =
  { ok: true; reports: PodcastFeedReport[] } | { ok: false; reason: string };

/** Build the search URL the page fetches, with a stable parameter order. */
export function buildPodcastSearchRouteUrl(options: PodcastSearchRequest): string {
  const params = new URLSearchParams();
  params.set('term', options.term.trim());
  params.set('country', options.country ?? 'us');
  if (options.genreId !== undefined && options.genreId > 0)
    params.set('genreId', String(options.genreId));
  return `${PODCAST_SEARCH_ROUTE}?${params.toString()}`;
}

/** Build the publisher lookup URL the page fetches, with a stable parameter order. */
export function buildPodcastPublisherRouteUrl(artistId: number, country: string): string {
  const params = new URLSearchParams();
  params.set('artistId', String(artistId));
  params.set('country', country);
  return `${PODCAST_PUBLISHER_ROUTE}?${params.toString()}`;
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

/**
 * Search every directory through the app's own route, returning one merged
 * list. One request answers the whole search, so the page never has to know how
 * many directories there are or which one failed.
 */
export async function searchEveryPodcastDirectory(
  options: PodcastSearchRequest,
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

    const body = (await response.json()) as {
      shows?: SerialisedPodcastShow[];
      counts?: PodcastSourceCount[];
      archiveItems?: SerialisedPodcastShow[];
      unavailable?: string[];
    };
    if (!Array.isArray(body.shows))
      return { ok: false, reason: 'Search returned an unexpected shape.' };

    return {
      ok: true,
      shows: body.shows.map(podcastShowFromWire),
      counts: Array.isArray(body.counts) ? body.counts : [],
      archiveItems: Array.isArray(body.archiveItems)
        ? body.archiveItems.map(podcastShowFromWire)
        : [],
      unavailable: Array.isArray(body.unavailable) ? body.unavailable : [],
    };
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
): Promise<PodcastShowsOutcome> {
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

/** Sentence for the live region while verdicts are still arriving. */
export function describeStatusProgress(answered: number, requested: number): string {
  if (requested === 0) return '';
  if (answered === 0) return `Checking ${requested} shows for recent episodes.`;
  if (answered >= requested) return `Checked all ${requested} shows.`;
  return `Checked ${answered} of ${requested} shows.`;
}

/**
 * The feed URLs worth asking about for a result set: unique, in result order.
 *
 * There is no cap here: the route accepts twenty feeds per request, so the page
 * walks the list in batches of twenty rather than throwing the rest away. A
 * show a directory returned without a feed URL is dropped, because there is
 * nothing to pull for it.
 */
export function listResultFeedUrls(shows: readonly PodcastShow[]): string[] {
  const urls = new Set<string>();
  for (const show of shows) {
    if (show.feedUrl === null) continue;
    urls.add(show.feedUrl);
  }
  return [...urls];
}
