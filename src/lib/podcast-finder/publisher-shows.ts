// Grouping shows by the publisher behind them, so a card's publisher name can
// be clicked to answer "what else does this network make, and is any of it
// still running?".
//
// The grouping key is Apple's artist id, not the name. One artist id can spell
// itself several ways across its own shows ("NPR" next to "NPR News"), and two
// unrelated publishers can share a name, so matching on the string would both
// split one publisher and merge two.

import type { PodcastShow } from './itunes-search';

/** Prefix for a key built from Apple's artist id. */
const ARTIST_KEY_PREFIX = 'artist:';

/** Prefix for a key built from the publisher name, used when Apple sent no id. */
const NAME_KEY_PREFIX = 'name:';

/** The key that groups shows by publisher: Apple's artist id, or the name. */
export function publisherKeyForShow(show: PodcastShow): string {
  if (show.artistId !== null) return `${ARTIST_KEY_PREFIX}${show.artistId}`;
  return `${NAME_KEY_PREFIX}${show.publisher.trim().toLowerCase()}`;
}

/** True when the key came from Apple's artist id. */
export function publisherKeyHasArtistId(publisherKey: string): boolean {
  return publisherKey.startsWith(ARTIST_KEY_PREFIX);
}

/** The artist id behind a key, or null when the key is a name. */
export function readPublisherArtistId(publisherKey: string): number | null {
  if (!publisherKeyHasArtistId(publisherKey)) return null;
  const value = Number(publisherKey.slice(ARTIST_KEY_PREFIX.length));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** The shows in a result set that belong to one publisher. */
export function filterShowsByPublisher(
  shows: readonly PodcastShow[],
  publisherKey: string
): PodcastShow[] {
  return shows.filter((show) => publisherKeyForShow(show) === publisherKey);
}

/** The publisher name to show for a key, taken from the first matching show. */
export function readPublisherName(
  shows: readonly PodcastShow[],
  publisherKey: string
): string | null {
  return filterShowsByPublisher(shows, publisherKey)[0]?.publisher ?? null;
}

/**
 * Sentence for the bar above the results, so a filtered list never looks like a
 * short search. Says how many of the current results matched, and names the
 * publisher, because the same list is drawn either way.
 */
export function describePublisherSelection(
  matched: number,
  total: number,
  publisherName: string
): string {
  if (total === 0) return `Nothing loaded from ${publisherName} yet.`;
  if (matched === total) return `All ${total} loaded shows are from ${publisherName}.`;
  return `${matched} of ${total} loaded shows are from ${publisherName}.`;
}
