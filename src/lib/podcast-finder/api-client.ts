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
