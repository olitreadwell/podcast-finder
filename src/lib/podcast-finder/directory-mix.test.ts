import { describe, expect, it } from 'vitest';

import { countDirectoryRows, describeDirectoryMix } from './directory-mix';
import type { PodcastShow } from './itunes-search';

/** A show with just the field the count reads. */
function show(source: PodcastShow['source'], sourceKey: string): PodcastShow {
  return {
    source,
    sourceKey,
    appleId: null,
    title: 'The Water Drop',
    publisher: 'Padre Dam',
    artistId: null,
    feedUrl: null,
    genres: [],
    country: 'US',
    artworkUrl: null,
    pageUrl: 'https://example.com/show',
    episodeCount: null,
    latestReleaseAt: null,
    explicit: false,
  };
}

describe('countDirectoryRows', () => {
  it('counts the merged rows in directory order', () => {
    const counts = countDirectoryRows([
      show('fyyd', 'fyyd:1'),
      show('apple', 'apple:1'),
      show('archive', 'archive:1'),
      show('apple', 'apple:2'),
    ]);

    expect(counts).toEqual([
      { source: 'apple', count: 2 },
      { source: 'fyyd', count: 1 },
      { source: 'archive', count: 1 },
    ]);
  });

  it('leaves out a directory that contributed nothing', () => {
    expect(countDirectoryRows([show('apple', 'apple:1')])).toEqual([{ source: 'apple', count: 1 }]);
  });

  it('answers nothing for no rows', () => {
    expect(countDirectoryRows([])).toEqual([]);
  });
});

describe('describeDirectoryMix', () => {
  it('names where each row came from', () => {
    expect(
      describeDirectoryMix([
        { source: 'apple', count: 12 },
        { source: 'fyyd', count: 8 },
        { source: 'archive', count: 6 },
      ])
    ).toBe('12 from Apple, 8 from fyyd, 6 from the Internet Archive.');
  });

  it('names one directory without a list', () => {
    expect(describeDirectoryMix([{ source: 'apple', count: 3 }])).toBe('3 from Apple.');
  });

  it('covers an empty merge', () => {
    expect(describeDirectoryMix([])).toBe('No results from any directory.');
  });
});
