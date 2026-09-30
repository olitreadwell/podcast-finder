// The Internet Archive, for shows that were never a podcast anyone would find
// today: conference recordings, radio programmes, one-season experiments.
//
// The Archive is the odd one out in this app. Its search returns items with an
// identifier and a title, and no feed at all, so nothing here can be judged by
// the cadence machinery. Those rows are still worth listing, and the card says
// plainly that there is no feed to check rather than showing a verdict it does
// not have.

import { z } from 'zod';

import type { PodcastShow } from './itunes-search';

/** The Archive's search endpoint. Keyless, no account, no rate limit worth fearing. */
export const ARCHIVE_SEARCH_ENDPOINT = 'https://archive.org/advancedsearch.php';

/** Results per search when the page does not say otherwise. */
export const DEFAULT_ARCHIVE_SEARCH_LIMIT = 25;

/** Seconds the Archive route waits before giving up. */
export const ARCHIVE_TIMEOUT_MS = 10_000;

/** How the app identifies itself to the Archive. */
export const ARCHIVE_USER_AGENT = 'PodcastFinder/1.0 (+https://podcast-finder-ruby.vercel.app)';

const archiveDocSchema = z.object({
  identifier: z.string(),
  title: z.union([z.string(), z.array(z.string())]).optional(),
  creator: z.union([z.string(), z.array(z.string())]).optional(),
  date: z.string().optional(),
});

const archiveResponseSchema = z.object({
  response: z.object({ docs: z.array(z.unknown()) }),
});

/** Read a field that may arrive as one string or as a list of them. */
function readArchiveText(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Reduce a visitor's term to words the Archive's query language cannot read as
 * syntax. The term is interpolated into that query, so anything with a meaning
 * there, a quote, a colon, brackets, or the wildcards, is dropped rather than
 * escaped: a search for a topic has no use for them and the alternative is a
 * visitor editing the query we send.
 */
export function sanitiseArchiveTerm(term: string): string {
  return term
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the Archive search URL: audio inside the podcasts collection, matching
 * the term in the title or the creator, newest first.
 */
export function buildArchiveSearchUrl(term: string, limit?: number): string {
  const url = new URL(ARCHIVE_SEARCH_ENDPOINT);
  const clean = sanitiseArchiveTerm(term);
  url.searchParams.set(
    'q',
    `collection:podcasts AND mediatype:audio AND (title:("${clean}") OR creator:("${clean}"))`
  );
  url.searchParams.set('fl[]', 'identifier');
  url.searchParams.append('fl[]', 'title');
  url.searchParams.append('fl[]', 'creator');
  url.searchParams.append('fl[]', 'date');
  url.searchParams.set('sort[]', 'date desc');
  url.searchParams.set(
    'rows',
    String(Math.min(100, Math.max(1, Math.floor(limit ?? DEFAULT_ARCHIVE_SEARCH_LIMIT))))
  );
  url.searchParams.set('page', '1');
  url.searchParams.set('output', 'json');
  return url.toString();
}

/** Read a date string, returning null rather than an Invalid Date. */
function readArchiveDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Parse an Archive search response into shows. Every row here has no feed URL,
 * which the card reports as a show that cannot be checked.
 */
export function parseArchiveSearch(
  value: unknown
): { ok: true; shows: PodcastShow[] } | { ok: false; reason: string } {
  const parsed = archiveResponseSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'The Archive sent something unexpected.' };

  const shows: PodcastShow[] = [];
  for (const row of parsed.data.response.docs) {
    const candidate = archiveDocSchema.safeParse(row);
    if (!candidate.success) continue;
    const identifier = candidate.data.identifier;
    shows.push({
      source: 'archive',
      sourceKey: `archive:${identifier}`,
      appleId: null,
      title: readArchiveText(candidate.data.title) ?? identifier,
      publisher: readArchiveText(candidate.data.creator) ?? 'Unknown publisher',
      artistId: null,
      feedUrl: null,
      genres: [],
      country: '',
      artworkUrl: `https://archive.org/services/img/${identifier}`,
      pageUrl: `https://archive.org/details/${identifier}`,
      episodeCount: null,
      latestReleaseAt: readArchiveDate(candidate.data.date),
      explicit: false,
    });
  }

  return { ok: true, shows };
}

/** Search the Archive, answering a sentence rather than throwing on failure. */
export async function searchArchivePodcasts(
  term: string,
  limit?: number,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; shows: PodcastShow[] } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(buildArchiveSearchUrl(term, limit), {
      cache: 'no-store',
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
      headers: { 'user-agent': ARCHIVE_USER_AGENT },
    });
    if (!response.ok) return { ok: false, reason: `The Archive answered ${response.status}.` };
    return parseArchiveSearch(await response.json());
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: timedOut ? 'The Archive took too long to answer.' : 'Could not reach the Archive.',
    };
  }
}
