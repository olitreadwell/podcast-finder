// A second directory, for shows Apple never indexed.
//
// fyyd is a German-run podcast directory with an open search API and no key,
// which makes it the only other directory this app can call the way it calls
// Apple. Its rows carry the feed URL directly, so a result can be judged the
// same way an Apple result is.
//
// Two things do not survive the mapping: fyyd files genres as numeric ids, and
// its `language` is a language tag, not a storefront. Rather than guess at a
// genre table or print "en" where a country belongs, both are left empty.

import { z } from 'zod';

/** fyyd's podcast search endpoint. Keyless, so it is called from the server. */
export const FYYD_SEARCH_ENDPOINT = 'https://api.fyyd.de/0.2/search/podcast';

/** Results per search when the page does not say otherwise. */
export const DEFAULT_FYYD_SEARCH_LIMIT = 25;

/**
 * Milliseconds the search waits for fyyd before giving up.
 *
 * The merged search waits for every directory it asked, so fyyd's slowest
 * answer is the whole table's wait. Measured here, fyyd answers a term in
 * anywhere between 1.5 s and 8.3 s depending on the term, so the cap is ten
 * seconds: below that, half the terms lost the second directory to a sentence
 * in `unavailable`, which is worse than a table that takes a few seconds.
 */
export const FYYD_TIMEOUT_MS = 10_000;

/** How the app identifies itself to fyyd. */
export const FYYD_USER_AGENT = 'PodcastFinder/1.0 (+https://podcast-finder-ruby.vercel.app)';

import type { PodcastShow } from './itunes-search';

const fyydRowSchema = z.object({
  id: z.number(),
  title: z.string(),
  xmlURL: z.string().optional(),
  htmlURL: z.string().optional(),
  imgURL: z.string().optional(),
  author: z.string().optional(),
  lastpub: z.string().optional(),
  episode_count: z.number().optional(),
});

// `data` is required: a response without it is not an empty result, it is a
// response this app does not understand, and the two must not look the same.
const fyydResponseSchema = z.object({
  status: z.number().optional(),
  data: z.array(z.unknown()),
});

/** Build the fyyd search URL. fyyd pages from zero, which is worth spelling out. */
export function buildFyydSearchUrl(term: string, limit?: number): string {
  const url = new URL(FYYD_SEARCH_ENDPOINT);
  url.searchParams.set('term', term.trim());
  url.searchParams.set(
    'count',
    String(Math.min(100, Math.max(1, Math.floor(limit ?? DEFAULT_FYYD_SEARCH_LIMIT))))
  );
  url.searchParams.set('page', '0');
  return url.toString();
}

/** Read a date string, returning null rather than an Invalid Date. */
function readFyydDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Parse a fyyd search response. Rows without a title or an id are dropped, and
 * a row with no `xmlURL` is kept: it is still a real show, it just cannot get a
 * verdict, and the card says so.
 */
export function parseFyydSearch(
  value: unknown
): { ok: true; shows: PodcastShow[] } | { ok: false; reason: string } {
  const parsed = fyydResponseSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'fyyd sent something unexpected.' };

  const shows: PodcastShow[] = [];
  for (const row of parsed.data.data) {
    const candidate = fyydRowSchema.safeParse(row);
    if (!candidate.success) continue;
    const raw = candidate.data;
    shows.push({
      source: 'fyyd',
      sourceKey: `fyyd:${raw.id}`,
      appleId: null,
      title: raw.title,
      publisher: raw.author ?? 'Unknown publisher',
      artistId: null,
      feedUrl: raw.xmlURL ?? null,
      genres: [],
      country: '',
      artworkUrl: raw.imgURL ?? null,
      pageUrl: raw.htmlURL ?? `https://fyyd.de/podcast/${raw.id}`,
      episodeCount: raw.episode_count ?? null,
      latestReleaseAt: readFyydDate(raw.lastpub),
      explicit: false,
    });
  }

  return { ok: true, shows };
}

/** Search fyyd, answering a sentence rather than throwing on failure. */
export async function searchFyydPodcasts(
  term: string,
  limit?: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; shows: PodcastShow[] } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(buildFyydSearchUrl(term, limit), {
      cache: 'no-store',
      signal: AbortSignal.timeout(FYYD_TIMEOUT_MS),
      headers: { 'user-agent': FYYD_USER_AGENT },
    });
    if (!response.ok) return { ok: false, reason: `fyyd answered ${response.status}.` };
    return parseFyydSearch(await response.json());
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: timedOut ? 'fyyd took too long to answer.' : 'Could not reach fyyd.',
    };
  }
}
