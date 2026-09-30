// Which directories answered a merged search, and the sentence that says so.
//
// A merged search is one list drawn from several directories, so the page has
// to name where the rows came from. This module is the fetch-free half of that
// idea: the page can import it without dragging the directory adapters, and the
// server can import it without knowing how the page renders.

import type { PodcastShow, PodcastSource } from './itunes-search';

/** How many rows one directory contributed to a merged search. */
export interface PodcastSourceCount {
  /** The directory that answered. */
  source: PodcastSource;
  /** How many of its rows survived the merge. */
  count: number;
}

/** Directory order for every sentence and table, so lists never reshuffle. */
const DIRECTORY_ORDER: readonly PodcastSource[] = ['apple', 'fyyd', 'archive'];

/** Human wording for each directory, used in the sentence above the results. */
const SOURCE_LABELS: Record<PodcastSource, string> = {
  apple: 'Apple',
  fyyd: 'fyyd',
  archive: 'the Internet Archive',
};

/**
 * Count the merged rows by directory, in listing order.
 *
 * Counted after deduplication rather than from each directory's own answer, so
 * the numbers add up to the list underneath them instead of counting a row that
 * a richer directory had already supplied.
 */
export function countDirectoryRows(shows: readonly PodcastShow[]): PodcastSourceCount[] {
  return DIRECTORY_ORDER.map((source) => ({
    source,
    count: shows.filter((show) => show.source === source).length,
  })).filter((entry) => entry.count > 0);
}

/** Sentence for the bar above the results, naming where each row came from. */
export function describeDirectoryMix(counts: readonly PodcastSourceCount[]): string {
  if (counts.length === 0) return 'No results from any directory.';
  return counts
    .map((entry) => `${entry.count} from ${SOURCE_LABELS[entry.source]}`)
    .join(', ')
    .concat('.');
}

/** The directory's name as a sentence uses it, e.g. "the Internet Archive". */
export function describePodcastSource(source: PodcastSource): string {
  return SOURCE_LABELS[source];
}
