// Two caches over one merged directory search.
//
// One search is three upstream calls plus the promise of a hundred and sixty
// feed checks behind it, and the same handful of terms come back all day, so an
// answer is worth keeping. The merged result is held in process for ten
// minutes, the same time the feed reports live, and the route also marks a
// complete answer cacheable at the edge so a repeat of the same term never
// reaches the function at all.
//
// A partial answer is deliberately not marked cacheable: a term where fyyd
// timed out is a fact about one moment, and pinning that sentence to the edge
// for ten minutes would turn a blip into the site's answer.

import { createTtlCache, type TtlCache } from './analysis-cache';
import type { MergedDirectorySearchResult } from './directory-search';
import type { PodcastSearchOptions } from './itunes-search';

/** Milliseconds a merged search stays fresh; matched to the feed report TTL. */
export const DIRECTORY_SEARCH_TTL_MS = 10 * 60 * 1000;

/** Seconds the edge may serve one complete answer before asking again. */
export const DIRECTORY_SEARCH_EDGE_SECONDS = 600;

/** Seconds the edge may serve a stale answer while one refresh runs. */
export const DIRECTORY_SEARCH_EDGE_STALE_SECONDS = 300;

/**
 * The cache key for one search.
 *
 * Every input that changes the rows belongs in the key, so `science` in the
 * United States and `science` in New Zealand cannot answer each other, and
 * neither can two genres.
 */
export function readDirectorySearchCacheKey(options: PodcastSearchOptions): string {
  return JSON.stringify([
    options.term.trim().toLowerCase(),
    options.country ?? 'us',
    options.genreId ?? null,
  ]);
}

/**
 * The `Cache-Control` header for one answer.
 *
 * Only a search every directory answered is cacheable at the edge; a search
 * carrying a sentence about a directory that did not answer is served fresh
 * every time, so a blip never becomes the cached truth.
 */
export function readDirectorySearchCacheControl(unavailable: readonly string[]): string {
  if (unavailable.length > 0) return 'no-store';
  return `public, s-maxage=${DIRECTORY_SEARCH_EDGE_SECONDS}, stale-while-revalidate=${DIRECTORY_SEARCH_EDGE_STALE_SECONDS}`;
}

/**
 * The in-process cache of merged searches.
 *
 * Per process and not shared between instances, like the feed report cache: it
 * is there to keep a warm instance from asking three directories again for a
 * term it just answered.
 */
export const directorySearchCache: TtlCache<MergedDirectorySearchResult> =
  createTtlCache<MergedDirectorySearchResult>(DIRECTORY_SEARCH_TTL_MS);
