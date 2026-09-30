// Apple's podcast charts, the one ranked list Apple publishes without a key.
//
// The chart feed is a plain JSON document on Apple's marketing domain. It
// carries the show's id, name, publisher, artwork and genres, and deliberately
// no feed URL, so every chart is followed by one batched lookup that fills the
// feeds in. Without a feed URL a chart row can be listed but never judged, and
// this app is only worth using for the judging.

import { z } from 'zod';

import {
  ITUNES_TIMEOUT_MS,
  ITUNES_USER_AGENT,
  lookupItunesShowsByIds,
  type PodcastShow,
} from './itunes-search';

/** Apple's marketing feed host, which serves the chart JSON per storefront. */
export const APPLE_CHARTS_ENDPOINT = 'https://rss.applemarketingtools.com/api/v2';

/** Rows per chart when the page does not say otherwise. */
export const DEFAULT_APPLE_CHART_LIMIT = 25;

/** Most rows a chart will serve. */
export const APPLE_CHARTS_MAX_LIMIT = 100;

/** One row of a chart, before the lookup fills the feed in. */
export interface AppleChartEntry {
  /** Apple's collection id. */
  appleId: number;
  /** Show title. */
  title: string;
  /** Publisher or network name. */
  publisher: string;
  /** Genre names, in Apple's order. */
  genres: string[];
  /** Artwork at the size the chart serves. */
  artworkUrl: string | null;
}

const chartRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  artistName: z.string().optional(),
  artworkUrl100: z.string().optional(),
  genres: z.array(z.object({ name: z.string() })).optional(),
});

const chartFeedSchema = z.object({ feed: z.object({ results: z.array(z.unknown()) }) });

/** Keep a requested chart length inside what Apple serves. */
export function clampAppleChartLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_APPLE_CHART_LIMIT;
  return Math.min(APPLE_CHARTS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Build the chart URL for one storefront. Parameter order is fixed so the
 * response can be cached by URL. */
export function buildAppleChartsUrl(country: string, limit?: number): string {
  return `${APPLE_CHARTS_ENDPOINT}/${country}/podcasts/top/${clampAppleChartLimit(limit)}/podcasts.json`;
}

/**
 * Parse a chart feed. Rows whose id is not numeric are dropped rather than
 * failing the whole chart, which is the same rule the search parser follows.
 */
export function parseAppleChartsFeed(
  value: unknown
): { ok: true; entries: AppleChartEntry[] } | { ok: false; reason: string } {
  const parsed = chartFeedSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'Apple sent something unexpected.' };

  const entries: AppleChartEntry[] = [];
  for (const row of parsed.data.feed.results) {
    const candidate = chartRowSchema.safeParse(row);
    if (!candidate.success) continue;
    const appleId = Number(candidate.data.id);
    if (!Number.isInteger(appleId) || appleId <= 0) continue;
    entries.push({
      appleId,
      title: candidate.data.name,
      publisher: candidate.data.artistName ?? 'Unknown publisher',
      genres: candidate.data.genres?.map((genre) => genre.name) ?? [],
      artworkUrl: candidate.data.artworkUrl100 ?? null,
    });
  }

  return { ok: true, entries };
}

/**
 * Fetch a storefront's chart as shows ready for the card list.
 *
 * The lookup is what turns a chart into something this app can judge, so a
 * lookup that fails fails the whole call: a chart of rows with no feed would be
 * a list of shows that can never get a verdict, which is worse than a sentence.
 */
export async function fetchAppleChartShows(
  country: string,
  limit?: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; shows: PodcastShow[] } | { ok: false; reason: string }> {
  let entries: AppleChartEntry[];
  try {
    const response = await fetchImpl(buildAppleChartsUrl(country, limit), {
      cache: 'no-store',
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
      headers: { 'user-agent': ITUNES_USER_AGENT },
    });
    if (!response.ok) return { ok: false, reason: `Apple answered ${response.status}.` };
    const parsed = parseAppleChartsFeed(await response.json());
    if (!parsed.ok) return parsed;
    entries = parsed.entries;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: timedOut ? 'Apple took too long to answer.' : 'Could not reach Apple.',
    };
  }

  if (entries.length === 0) return { ok: true, shows: [] };

  const looked = await lookupItunesShowsByIds(
    entries.map((entry) => entry.appleId),
    { country },
    fetchImpl
  );
  if (!looked.ok) return looked;

  const byAppleId = new Map(looked.shows.map((show) => [show.appleId, show]));
  const shows: PodcastShow[] = [];
  for (const entry of entries) {
    const show = byAppleId.get(entry.appleId);
    if (show === undefined) continue;
    shows.push({
      ...show,
      source: 'charts',
      sourceKey: `charts:${entry.appleId}`,
      artworkUrl: show.artworkUrl ?? entry.artworkUrl,
    });
  }

  return { ok: true, shows };
}
