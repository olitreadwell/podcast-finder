import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_APPLE_CHART_LIMIT,
  buildAppleChartsUrl,
  clampAppleChartLimit,
  fetchAppleChartShows,
  parseAppleChartsFeed,
} from './apple-charts';

/** One row in the shape Apple's chart feed sends. */
function chartRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1200361736',
    name: 'The Daily',
    artistName: 'The New York Times',
    kind: 'podcasts',
    artworkUrl100: 'https://example.com/chart-100.jpg',
    genres: [{ genreId: '1324', name: 'News', url: 'https://example.com/genre' }],
    ...overrides,
  };
}

/** One row in the shape Apple's lookup sends, which is what fills the feed in. */
function lookupRow(overrides: Record<string, unknown> = {}) {
  return {
    wrapperType: 'track',
    kind: 'podcast',
    trackId: 1200361736,
    trackName: 'The Daily',
    artistName: 'The New York Times',
    artistId: 98765,
    feedUrl: 'https://feeds.example.com/daily.xml',
    genres: ['News'],
    country: 'USA',
    artworkUrl600: 'https://example.com/art-600.jpg',
    collectionViewUrl: 'https://podcasts.apple.com/us/podcast/id1200361736',
    trackCount: 100,
    releaseDate: '2026-09-29T09:00:00Z',
    ...overrides,
  };
}

/** A fetch stand-in that answers the chart call and then the lookup call. */
function stubApple(options: {
  chart?: unknown;
  chartStatus?: number;
  lookup?: unknown;
  lookupStatus?: number;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('rss.applemarketingtools.com')) {
      if (options.chartStatus !== undefined && options.chartStatus >= 400) {
        return { ok: false, status: options.chartStatus };
      }
      return { ok: true, status: 200, json: async () => options.chart };
    }
    if (url.includes('/lookup')) {
      if (options.lookupStatus !== undefined && options.lookupStatus >= 400) {
        return { ok: false, status: options.lookupStatus };
      }
      return { ok: true, status: 200, json: async () => options.lookup };
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

describe('clampAppleChartLimit', () => {
  it('keeps the length inside what a chart serves', () => {
    expect(clampAppleChartLimit(undefined)).toBe(DEFAULT_APPLE_CHART_LIMIT);
    expect(clampAppleChartLimit(5000)).toBe(100);
    expect(clampAppleChartLimit(0)).toBe(1);
  });
});

describe('buildAppleChartsUrl', () => {
  it('points at one storefront chart', () => {
    expect(buildAppleChartsUrl('nz', 10)).toBe(
      'https://rss.applemarketingtools.com/api/v2/nz/podcasts/top/10/podcasts.json'
    );
  });
});

describe('parseAppleChartsFeed', () => {
  it('keeps the rows a chart can use', () => {
    const parsed = parseAppleChartsFeed({ feed: { results: [chartRow()] } });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.entries).toEqual([
      {
        appleId: 1200361736,
        title: 'The Daily',
        publisher: 'The New York Times',
        genres: ['News'],
        artworkUrl: 'https://example.com/chart-100.jpg',
      },
    ]);
  });

  it('drops a row whose id is not a number, rather than failing the chart', () => {
    const parsed = parseAppleChartsFeed({
      feed: { results: [chartRow({ id: 'not-an-id' }), chartRow({ id: '123' })] },
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.entries.map((entry) => entry.appleId)).toEqual([123]);
  });

  it('refuses a response that is not a chart', () => {
    expect(parseAppleChartsFeed({ results: [] })).toEqual({
      ok: false,
      reason: 'Apple sent something unexpected.',
    });
  });
});

describe('fetchAppleChartShows', () => {
  it('follows the chart with one lookup and keeps the chart art as a fallback', async () => {
    const fetchImpl = stubApple({
      chart: { feed: { results: [chartRow()] } },
      lookup: { results: [lookupRow({ artworkUrl600: undefined })] },
    });

    const result = await fetchAppleChartShows('us', 10, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shows[0]).toMatchObject({
      source: 'charts',
      sourceKey: 'charts:1200361736',
      feedUrl: 'https://feeds.example.com/daily.xml',
      artworkUrl: 'https://example.com/chart-100.jpg',
    });
    // One chart call, one lookup call, not one lookup per row.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it('fails the whole call when the lookup fails, because a chart row without a feed cannot be judged', async () => {
    const fetchImpl = stubApple({ chart: { feed: { results: [chartRow()] } }, lookupStatus: 503 });

    await expect(fetchAppleChartShows('us', 10, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Apple answered 503.',
    });
  });

  it('names Apple when the chart itself refuses', async () => {
    const fetchImpl = stubApple({ chartStatus: 500 });

    await expect(fetchAppleChartShows('us', 10, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Apple answered 500.',
    });
  });

  it('answers an empty chart without asking for a lookup', async () => {
    const fetchImpl = stubApple({ chart: { feed: { results: [] } } });

    await expect(fetchAppleChartShows('us', 10, fetchImpl)).resolves.toEqual({
      ok: true,
      shows: [],
    });
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
