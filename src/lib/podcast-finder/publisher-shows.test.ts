import { describe, expect, it } from 'vitest';

import type { PodcastShow } from './itunes-search';
import {
  describePublisherSelection,
  filterShowsByPublisher,
  publisherKeyForShow,
  readPublisherArtistId,
  readPublisherName,
} from './publisher-shows';

/** A show with only the fields these functions read. */
function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  return {
    appleId: 1,
    title: 'Weekly Wipe',
    publisher: 'Drain Media',
    artistId: null,
    feedUrl: 'https://example.com/feed.xml',
    genres: [],
    country: 'US',
    artworkUrl: null,
    appleUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 10,
    latestReleaseAt: null,
    explicit: false,
    ...overrides,
  };
}

describe('publisherKeyForShow', () => {
  it('prefers Apple artist id, because one publisher spells its name several ways', () => {
    expect(publisherKeyForShow(show({ artistId: 125443881 }))).toBe('artist:125443881');
  });

  it('falls back to the trimmed lowercase name when Apple sent no id', () => {
    expect(publisherKeyForShow(show({ publisher: '  Drain Media ' }))).toBe('name:drain media');
  });

  it('keeps two publishers that share an id together even when names differ', () => {
    expect(publisherKeyForShow(show({ artistId: 7, publisher: 'NPR' }))).toBe(
      publisherKeyForShow(show({ artistId: 7, publisher: 'NPR News' }))
    );
  });
});

describe('readPublisherArtistId', () => {
  it('reads the id back out of an artist key', () => {
    expect(readPublisherArtistId('artist:125443881')).toBe(125443881);
  });

  it('answers null for a name key', () => {
    expect(readPublisherArtistId('name:drain media')).toBeNull();
  });

  it('answers null rather than NaN for a malformed key', () => {
    expect(readPublisherArtistId('artist:not-a-number')).toBeNull();
    expect(readPublisherArtistId('artist:-3')).toBeNull();
  });
});

describe('filterShowsByPublisher', () => {
  const shows = [
    show({ appleId: 1, publisher: 'NPR', artistId: 125443881 }),
    show({ appleId: 2, publisher: 'NPR News', artistId: 125443881 }),
    show({ appleId: 3, publisher: 'Drain Media', artistId: null }),
  ];

  it('keeps every show filed under the same artist id', () => {
    expect(filterShowsByPublisher(shows, 'artist:125443881').map((entry) => entry.appleId)).toEqual(
      [1, 2]
    );
  });

  it('groups by name when Apple sent no artist id', () => {
    expect(filterShowsByPublisher(shows, 'name:drain media').map((entry) => entry.appleId)).toEqual(
      [3]
    );
  });

  it('answers nothing for a publisher that is not in the list', () => {
    expect(filterShowsByPublisher(shows, 'artist:999')).toEqual([]);
  });
});

describe('readPublisherName', () => {
  it('names the publisher from the first matching show', () => {
    expect(readPublisherName([show({ publisher: 'Drain Media' })], 'name:drain media')).toBe(
      'Drain Media'
    );
  });

  it('answers null when nothing matches', () => {
    expect(readPublisherName([show()], 'artist:999')).toBeNull();
  });
});

describe('describePublisherSelection', () => {
  it('says when the whole list is one publisher', () => {
    expect(describePublisherSelection(4, 4, 'NPR')).toBe('All 4 loaded shows are from NPR.');
  });

  it('says how many of the loaded shows matched', () => {
    expect(describePublisherSelection(4, 25, 'NPR')).toBe('4 of 25 loaded shows are from NPR.');
  });

  it('covers a list that has not loaded yet', () => {
    expect(describePublisherSelection(0, 0, 'NPR')).toBe('Nothing loaded from NPR yet.');
  });
});
