// Talks to Apple's iTunes Search API, the one podcast directory that needs no
// key and no account. It answers with show metadata (title, publisher, genres,
// artwork, episode count, feed URL, and the date of the newest episode) which
// is enough to list results and enough to know which feeds are worth pulling.
//
// Two limitations shape everything downstream, both measured against real
// responses: Apple's episode count can be capped at 200, and its release date
// is the collection's, not proof the feed is still moving. The feed itself is
// what settles whether a show is alive, so `feedUrl` is the important field
// here, not `releaseDate`.

import { z } from 'zod';

/** Apple's search endpoint. Keyless, but rate limited per IP, so it is called
 * from the server once per search rather than once per keystroke per visitor. */
export const ITUNES_SEARCH_ENDPOINT = 'https://itunes.apple.com/search';

/** Apple's lookup endpoint, which answers with every show filed under one
 * artist id. Used to list a publisher's catalogue after a click. */
export const ITUNES_LOOKUP_ENDPOINT = 'https://itunes.apple.com/lookup';

/** Most results one search may ask for; Apple's own documented ceiling. */
export const ITUNES_MAX_LIMIT = 200;

/** Most shows one publisher lookup may return. Apple's own ceiling again. */
export const ITUNES_MAX_PUBLISHER_SHOWS = 200;

/** Results per search when the page does not say otherwise. */
export const DEFAULT_PODCAST_SEARCH_LIMIT = 25;

/** How the app identifies itself to Apple. */
export const ITUNES_USER_AGENT =
  'ScratchpadPodcastFinder/1.0 (+https://scratchpad-ashen.vercel.app/podcast-finder)';

/** Seconds the search route waits for Apple before giving up. */
export const ITUNES_TIMEOUT_MS = 8_000;

/** A genre the search can be narrowed to, using Apple's own genre ids. */
export interface PodcastGenreOption {
  /** Display name, as Apple's directory spells it. */
  label: string;
  /** Apple genre id, sent as `genreId`. */
  id: number;
}

/** Storefront the search runs against, as an ISO 3166-1 alpha-2 code. */
export interface PodcastCountryOption {
  /** Country name for the select. */
  label: string;
  /** Lowercase two-letter code Apple expects. */
  code: string;
}

/** Apple's podcast genres, which is what its `genreId` filter accepts. */
export const PODCAST_GENRE_OPTIONS: readonly PodcastGenreOption[] = [
  { label: 'Arts', id: 1301 },
  { label: 'Business', id: 1321 },
  { label: 'Comedy', id: 1303 },
  { label: 'Education', id: 1304 },
  { label: 'Fiction', id: 1483 },
  { label: 'Government', id: 1325 },
  { label: 'Health & Fitness', id: 1512 },
  { label: 'History', id: 1487 },
  { label: 'Kids & Family', id: 1305 },
  { label: 'Leisure', id: 1502 },
  { label: 'Music', id: 1310 },
  { label: 'News', id: 1311 },
  { label: 'Religion & Spirituality', id: 1314 },
  { label: 'Science', id: 1315 },
  { label: 'Society & Culture', id: 1324 },
  { label: 'Sports', id: 1545 },
  { label: 'Technology', id: 1318 },
  { label: 'True Crime', id: 1488 },
  { label: 'TV & Film', id: 1309 },
];

/** Storefronts worth offering: the English-language ones plus a few big others. */
export const PODCAST_COUNTRY_OPTIONS: readonly PodcastCountryOption[] = [
  { label: 'United States', code: 'us' },
  { label: 'United Kingdom', code: 'gb' },
  { label: 'New Zealand', code: 'nz' },
  { label: 'Australia', code: 'au' },
  { label: 'Canada', code: 'ca' },
  { label: 'Ireland', code: 'ie' },
  { label: 'Germany', code: 'de' },
  { label: 'France', code: 'fr' },
  { label: 'Spain', code: 'es' },
  { label: 'Italy', code: 'it' },
  { label: 'Netherlands', code: 'nl' },
  { label: 'Sweden', code: 'se' },
  { label: 'Denmark', code: 'dk' },
  { label: 'Norway', code: 'no' },
  { label: 'India', code: 'in' },
  { label: 'Brazil', code: 'br' },
  { label: 'Mexico', code: 'mx' },
  { label: 'Japan', code: 'jp' },
  { label: 'South Africa', code: 'za' },
];

/** One show, normalised away from Apple's field names. */
export interface PodcastShow {
  /** Apple's collection id, used for the fallback directory link. */
  appleId: number;
  /** Show title. */
  title: string;
  /** Publisher or network name. */
  publisher: string;
  /** Apple's artist id for the publisher. This is the grouping key, because one
   * publisher can be spelled several ways across its own shows and unrelated
   * shows can share a name. Null when Apple did not return one. */
  artistId: number | null;
  /** RSS feed URL, or null when Apple did not return one. */
  feedUrl: string | null;
  /** Genre names as Apple lists them, most specific first. */
  genres: string[];
  /** Storefront the result came from, uppercase. */
  country: string;
  /** Cover art at the largest size Apple returned. */
  artworkUrl: string | null;
  /** Apple Podcasts page for the show. */
  appleUrl: string;
  /** Episode count Apple reports, or null. Can be capped at 200. */
  episodeCount: number | null;
  /** Apple's idea of the newest episode date. Approximate until the feed is read. */
  latestReleaseAt: Date | null;
  /** True when Apple marks the show explicit. */
  explicit: boolean;
}

/** A show with the date stringified, for the JSON the search route returns. */
export type SerialisedPodcastShow = Omit<PodcastShow, 'latestReleaseAt'> & {
  /** Newest episode date Apple reports, as an ISO string, or null. */
  latestReleaseAt: string | null;
};

/** Convert a show to its wire shape. */
export function toSerialisedPodcastShow(show: PodcastShow): SerialisedPodcastShow {
  return { ...show, latestReleaseAt: show.latestReleaseAt?.toISOString() ?? null };
}

/** Convert a wire show back to domain types, turning the date back into a Date. */
export function podcastShowFromWire(show: SerialisedPodcastShow): PodcastShow {
  const parsed = show.latestReleaseAt === null ? null : new Date(show.latestReleaseAt);
  return {
    ...show,
    latestReleaseAt: parsed !== null && Number.isFinite(parsed.getTime()) ? parsed : null,
  };
}

/** Search options the page exposes. */
export interface PodcastSearchOptions {
  /** Words to search for. Required, trimmed, at least two characters. */
  term: string;
  /** Storefront code, lowercase two letters. Defaults to `us`. */
  country?: string;
  /** Apple genre id to narrow the search to. */
  genreId?: number;
  /** How many results to ask for, clamped to `ITUNES_MAX_LIMIT`. */
  limit?: number;
}

/** Apple's per-result payload, validated at the boundary. */
const itunesPodcastSchema = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string().optional(),
  artistId: z.number().optional(),
  feedUrl: z.string().optional(),
  genres: z.array(z.string()).optional(),
  country: z.string().optional(),
  artworkUrl600: z.string().optional(),
  artworkUrl100: z.string().optional(),
  collectionViewUrl: z.string().optional(),
  trackViewUrl: z.string().optional(),
  trackCount: z.number().optional(),
  releaseDate: z.string().optional(),
  contentAdvisoryRating: z.string().optional(),
});

const itunesResponseSchema = z.object({
  results: z.array(z.unknown()),
});

/** Clamp a requested result count to what Apple will actually serve. */
export function clampPodcastSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PODCAST_SEARCH_LIMIT;
  return Math.min(ITUNES_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Build the search URL. The parameters are written in a fixed order so the same
 * search always produces the same request, which keeps the server cache useful.
 */
export function buildItunesPodcastSearchUrl(options: PodcastSearchOptions): string {
  const url = new URL(ITUNES_SEARCH_ENDPOINT);
  url.searchParams.set('term', options.term.trim());
  url.searchParams.set('media', 'podcast');
  url.searchParams.set('entity', 'podcast');
  url.searchParams.set('limit', String(clampPodcastSearchLimit(options.limit)));
  url.searchParams.set('country', options.country ?? 'us');
  if (options.genreId !== undefined) url.searchParams.set('genreId', String(options.genreId));
  return url.toString();
}

/** Read a date string, returning null rather than an Invalid Date. */
function readItunesDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** The Apple Podcasts page for a show, whether or not Apple returned one. */
function buildApplePodcastUrl(raw: {
  collectionViewUrl?: string;
  trackViewUrl?: string;
  trackId: number;
}): string {
  return (
    raw.collectionViewUrl ??
    raw.trackViewUrl ??
    `https://podcasts.apple.com/podcast/id${raw.trackId}`
  );
}

/**
 * Parse a search response into shows. Individual malformed results are dropped
 * rather than failing the whole search: Apple occasionally returns storefront
 * oddities, and one bad row should not hide twenty good ones.
 */
export function parseItunesPodcastSearch(
  value: unknown
): { ok: true; shows: PodcastShow[] } | { ok: false; reason: string } {
  const parsed = itunesResponseSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'Apple sent something unexpected.' };

  const shows: PodcastShow[] = [];
  for (const entry of parsed.data.results) {
    const candidate = itunesPodcastSchema.safeParse(entry);
    if (!candidate.success) continue;
    const raw = candidate.data;

    shows.push({
      appleId: raw.trackId,
      title: raw.trackName,
      publisher: raw.artistName ?? 'Unknown publisher',
      artistId: raw.artistId ?? null,
      feedUrl: raw.feedUrl ?? null,
      genres: raw.genres ?? [],
      country: (raw.country ?? '').toUpperCase(),
      artworkUrl: raw.artworkUrl600 ?? raw.artworkUrl100 ?? null,
      appleUrl: buildApplePodcastUrl(raw),
      episodeCount: raw.trackCount ?? null,
      latestReleaseAt: readItunesDate(raw.releaseDate),
      explicit: (raw.contentAdvisoryRating ?? '').toLowerCase() === 'explicit',
    });
  }

  return { ok: true, shows };
}

/** Search Apple for shows, answering a sentence rather than throwing on failure. */
export async function searchItunesPodcasts(
  options: PodcastSearchOptions,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; shows: PodcastShow[] } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(buildItunesPodcastSearchUrl(options), {
      cache: 'no-store',
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
      headers: { 'user-agent': ITUNES_USER_AGENT },
    });
    if (!response.ok) return { ok: false, reason: `Apple answered ${response.status}.` };
    return parseItunesPodcastSearch(await response.json());
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: timedOut ? 'Apple took too long to answer.' : 'Could not reach Apple.',
    };
  }
}

/**
 * Build the lookup URL that lists every show Apple files under one publisher.
 *
 * Apple files a publisher under a numeric artist id, and one id can carry more
 * than one spelling of the same name, so the id is the query key and the name
 * is only ever shown, never matched on.
 */
export function buildItunesPublisherLookupUrl(artistId: number, country?: string): string {
  const url = new URL(ITUNES_LOOKUP_ENDPOINT);
  url.searchParams.set('id', String(artistId));
  url.searchParams.set('entity', 'podcast');
  url.searchParams.set('limit', String(ITUNES_MAX_PUBLISHER_SHOWS));
  url.searchParams.set('country', country ?? 'us');
  return url.toString();
}

/**
 * List every show Apple attributes to one publisher.
 *
 * The response is the same envelope the search endpoint uses, plus one row for
 * the artist itself, which carries no `trackId` and is dropped by the parser.
 */
export async function lookupItunesPublisherShows(
  artistId: number,
  options: { country?: string } = {},
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; shows: PodcastShow[] } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(buildItunesPublisherLookupUrl(artistId, options.country), {
      cache: 'no-store',
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
      headers: { 'user-agent': ITUNES_USER_AGENT },
    });
    if (!response.ok) return { ok: false, reason: `Apple answered ${response.status}.` };
    return parseItunesPodcastSearch(await response.json());
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: timedOut ? 'Apple took too long to answer.' : 'Could not reach Apple.',
    };
  }
}
