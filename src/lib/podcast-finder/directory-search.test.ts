import { describe, expect, it, vi } from 'vitest';

import { dedupeDirectoryShows, searchEveryDirectory } from './directory-search';
import type { PodcastShow } from './itunes-search';

/** A show with the fields the merge reads. */
function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  return {
    source: 'apple',
    sourceKey: 'apple:1',
    appleId: 1,
    title: 'The Water Drop',
    publisher: 'Padre Dam',
    artistId: null,
    feedUrl: 'https://example.com/water.xml',
    genres: [],
    country: 'US',
    artworkUrl: null,
    pageUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 10,
    latestReleaseAt: null,
    explicit: false,
    ...overrides,
  };
}

/** A fetch stand-in that answers each directory from a map of URLs to bodies. */
function stubDirectories(answers: {
  apple?: unknown;
  fyyd?: unknown;
  archive?: unknown;
  appleStatus?: number;
  fyydStatus?: number;
  archiveStatus?: number;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('itunes.apple.com')) {
      if (answers.appleStatus !== undefined && answers.appleStatus >= 400)
        return { ok: false, status: answers.appleStatus };
      return { ok: true, status: 200, json: async () => answers.apple ?? { results: [] } };
    }
    if (url.includes('api.fyyd.de')) {
      if (answers.fyydStatus !== undefined && answers.fyydStatus >= 400)
        return { ok: false, status: answers.fyydStatus };
      return { ok: true, status: 200, json: async () => answers.fyyd ?? { data: [] } };
    }
    if (url.includes('archive.org')) {
      if (answers.archiveStatus !== undefined && answers.archiveStatus >= 400)
        return { ok: false, status: answers.archiveStatus };
      return {
        ok: true,
        status: 200,
        json: async () => answers.archive ?? { response: { docs: [] } },
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

/** One Apple row. */
function appleRow(overrides: Record<string, unknown> = {}) {
  return {
    trackId: 1,
    trackName: 'The Water Drop',
    artistName: 'Padre Dam',
    feedUrl: 'https://example.com/water.xml',
    genres: ['Government'],
    country: 'USA',
    collectionViewUrl: 'https://podcasts.apple.com/podcast/id1',
    ...overrides,
  };
}

/** One fyyd row. */
function fyydRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    title: 'Drain Weekly',
    author: 'Pipe Media',
    xmlURL: 'https://example.com/drain.xml',
    ...overrides,
  };
}

/** One Archive document. */
function archiveDoc(overrides: Record<string, unknown> = {}) {
  return { identifier: 'osr141', title: 'Open Science Radio 141', creator: 'OSR', ...overrides };
}

describe('dedupeDirectoryShows', () => {
  it('keeps the first copy of a feed another directory repeated', () => {
    const merged = dedupeDirectoryShows([
      show({ source: 'apple', sourceKey: 'apple:1' }),
      show({
        source: 'fyyd',
        sourceKey: 'fyyd:9',
        appleId: null,
        feedUrl: 'HTTP://WWW.Example.com/water.xml/',
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('apple');
  });

  it('falls back to the title and publisher when a row has no feed', () => {
    const merged = dedupeDirectoryShows([
      show({
        source: 'archive',
        sourceKey: 'archive:a',
        feedUrl: null,
        title: 'Open Science',
        publisher: 'OSR',
      }),
      show({
        source: 'archive',
        sourceKey: 'archive:b',
        feedUrl: null,
        title: 'open   science',
        publisher: 'osr',
      }),
    ]);

    expect(merged).toHaveLength(1);
  });

  it('keeps two different shows apart', () => {
    const merged = dedupeDirectoryShows([
      show({ sourceKey: 'apple:1', feedUrl: 'https://example.com/a.xml' }),
      show({ sourceKey: 'apple:2', feedUrl: 'https://example.com/b.xml' }),
    ]);

    expect(merged).toHaveLength(2);
  });
});

describe('searchEveryDirectory', () => {
  it('merges the two directories that describe shows, Apple first, and counts each', async () => {
    const fetchImpl = stubDirectories({
      apple: { results: [appleRow()] },
      fyyd: { data: [fyydRow()] },
      archive: { response: { docs: [archiveDoc()] } },
    });

    const outcome = await searchEveryDirectory({ term: 'water' }, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shows.map((entry) => entry.source)).toEqual(['apple', 'fyyd']);
    expect(outcome.counts).toEqual([
      { source: 'apple', count: 1 },
      { source: 'fyyd', count: 1 },
    ]);
    expect(outcome.archiveItems.map((entry) => entry.source)).toEqual(['archive']);
    expect(outcome.unavailable).toEqual([]);
  });

  it('keeps Archive items out of the table and answers them separately', async () => {
    const fetchImpl = stubDirectories({
      apple: { results: [appleRow()] },
      fyyd: { data: [] },
      archive: { response: { docs: [archiveDoc()] } },
    });

    const outcome = await searchEveryDirectory({ term: 'water' }, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shows.map((entry) => entry.title)).toEqual(['The Water Drop']);
    expect(outcome.archiveItems.map((entry) => entry.title)).toEqual(['Open Science Radio 141']);
  });

  it('returns the directories that answered, with a sentence for the one that did not', async () => {
    const fetchImpl = stubDirectories({
      apple: { results: [appleRow()] },
      fyydStatus: 503,
      archive: { response: { docs: [] } },
    });

    const outcome = await searchEveryDirectory({ term: 'water' }, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shows).toHaveLength(1);
    expect(outcome.unavailable).toEqual(['fyyd answered 503.']);
  });

  it('fails when neither directory that describes shows answered, Archive or not', async () => {
    const fetchImpl = stubDirectories({
      appleStatus: 500,
      fyydStatus: 503,
      archive: { response: { docs: [archiveDoc()] } },
    });

    const outcome = await searchEveryDirectory({ term: 'water' }, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('Apple');
  });

  it('asks each directory for its own page of rows', async () => {
    const fetchImpl = stubDirectories({});
    await searchEveryDirectory({ term: 'water' }, fetchImpl);

    const urls = (
      fetchImpl as unknown as { mock: { calls: [RequestInfo | URL][] } }
    ).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('itunes.apple.com') && url.includes('limit=100'))).toBe(
      true
    );
    expect(urls.some((url) => url.includes('api.fyyd.de') && url.includes('count=60'))).toBe(true);
    expect(urls.some((url) => url.includes('archive.org') && url.includes('rows=6'))).toBe(true);
  });
});
