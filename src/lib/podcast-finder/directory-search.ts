// One search, every directory.
//
// The table's rows come from the two directories that describe shows and hand
// over a feed URL: Apple, whose rows carry the most metadata, and fyyd, which
// runs independently of it. The Internet Archive is still asked, but as extra
// reading rather than as rows: it holds audio items, not shows, so nothing from
// it can be checked and a page of unrelated items is noise in a comparison.
//
// A directory that fails does not fail the search. Its sentence is passed back
// with the results, because losing one source is worth a note rather than an
// empty page.

import { searchArchivePodcasts } from './archive-search';
import { countDirectoryRows, type PodcastSourceCount } from './directory-mix';
import { searchFyydPodcasts } from './fyyd-search';
import { searchItunesPodcasts, type PodcastSearchOptions, type PodcastShow } from './itunes-search';

/**
 * Rows each directory contributes to the table.
 *
 * A topic search should look like a directory search, not a top ten, so each
 * one is asked for a real page of results. The status route still judges twenty
 * feeds per request, so the page walks the rows twenty at a time and the
 * verdicts land in waves rather than all at once.
 */
export const APPLE_ROWS_PER_SEARCH = 30;

/** fyyd's share of the feed budget. */
export const FYYD_ROWS_PER_SEARCH = 20;

/** Archive items, offered beside the table as extra reading rather than in it. */
export const ARCHIVE_ROWS_PER_SEARCH = 6;

/** One result set, merged from every directory that answered. */
export interface MergedDirectorySearch {
  /** Every show, Apple's rows first, duplicates removed. */
  shows: PodcastShow[];
  /** How many rows each directory contributed, in listing order. */
  counts: PodcastSourceCount[];
  /** Archive items found for the same words, kept out of the table. */
  archiveItems: PodcastShow[];
  /** One sentence per directory that did not answer. */
  unavailable: string[];
}

/**
 * A key that identifies the same show twice.
 *
 * The feed URL is the real identity, so it is used whenever a row has one.
 * Without a feed, a title and publisher are all there is, so that pair is used
 * instead; it is deliberately loose, because two rows that look alike in a
 * merged list are worse than a row occasionally dropped.
 */
function readShowIdentity(show: PodcastShow): string {
  if (show.feedUrl !== null) {
    return `feed:${show.feedUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')}`;
  }
  return `title:${`${show.title} ${show.publisher}`.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

/** Drop rows a later directory repeated, keeping the first, richer copy. */
export function dedupeDirectoryShows(shows: readonly PodcastShow[]): PodcastShow[] {
  const seen = new Set<string>();
  const kept: PodcastShow[] = [];
  for (const show of shows) {
    const identity = readShowIdentity(show);
    if (seen.has(identity)) continue;
    seen.add(identity);
    kept.push(show);
  }
  return kept;
}

/**
 * Search every directory at once and merge what comes back.
 *
 * The table needs a directory that describes shows, so this fails only when both
 * Apple and fyyd are down. One of them down is a note beside the results, and
 * the Archive is a note even when it answers.
 */
export async function searchEveryDirectory(
  options: PodcastSearchOptions,
  fetchImpl: typeof fetch = fetch
): Promise<({ ok: true } & MergedDirectorySearch) | { ok: false; reason: string }> {
  const [apple, fyyd, archive] = await Promise.all([
    searchItunesPodcasts({ ...options, limit: APPLE_ROWS_PER_SEARCH }, fetchImpl),
    searchFyydPodcasts(options.term, FYYD_ROWS_PER_SEARCH, fetchImpl),
    searchArchivePodcasts(options.term, ARCHIVE_ROWS_PER_SEARCH, fetchImpl),
  ]);

  const unavailable: string[] = [];
  // Every adapter's sentence already names its own directory, so these are
  // passed through rather than prefixed twice.
  if (!apple.ok) unavailable.push(apple.reason);
  if (!fyyd.ok) unavailable.push(fyyd.reason);
  if (!archive.ok) unavailable.push(archive.reason);

  if (!apple.ok && !fyyd.ok) {
    return { ok: false, reason: unavailable[0] ?? 'No directory answered.' };
  }

  const appleShows = apple.ok ? apple.shows : [];
  const fyydShows = fyyd.ok ? fyyd.shows : [];
  const shows = dedupeDirectoryShows([...appleShows, ...fyydShows]);
  return {
    ok: true,
    shows,
    counts: countDirectoryRows(shows),
    archiveItems: archive.ok ? archive.shows : [],
    unavailable,
  };
}
