import { describe, expect, it, vi } from 'vitest';

import { createTtlCache } from './analysis-cache';
import {
  DEFAULT_APPLE_CHART_LIMIT,
  buildAppleChartsUrl,
  clampAppleChartLimit,
  fetchAppleChartShows,
  parseAppleChartsFeed,
} from './apple-charts';
import type { PodcastShow } from './itunes-search';

/** A cache per test: the module keeps one of its own, which would leak a chart
 * from one test into the next. */
function freshCache() {
  return createTtlCache<PodcastShow[]>();
}

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

/**
 * A fetch stand-in that answers the chart call and then the lookup call.
 * `chartFailures` makes the first chart attempts fail, which is how the retry
 * and the cache are tested.
 */
function stubApple(options: {
  chart?: unknown;
  chartStatus?: number;
  chartFailures?: number;
  lookup?: unknown;
  lookupStatus?: number;
}) {
  let chartFailuresLeft = options.chartFailures ?? 0;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('rss.marketingtools.apple.com')) {
      if (chartFailuresLeft > 0) {
        chartFailuresLeft -= 1;
        return { ok: false, status: 502 };
      }
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
      'https://rss.marketingtools.apple.com/api/v2/nz/podcasts/top/10/podcasts.json'
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

    const result = await fetchAppleChartShows('us', 10, fetchImpl, freshCache());

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

    await expect(fetchAppleChartShows('us', 10, fetchImpl, freshCache())).resolves.toEqual({
      ok: false,
      reason: 'The lookup for that chart failed: Apple answered 503.',
    });
  });

  it("names Apple's chart when the chart itself refuses, after one retry", async () => {
    const fetchImpl = stubApple({ chartStatus: 500 });

    await expect(fetchAppleChartShows('us', 10, fetchImpl, freshCache())).resolves.toEqual({
      ok: false,
      reason: "Apple's chart answered 500.",
    });
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it('retries the chart once, because the host answers 502 on some calls', async () => {
    const fetchImpl = stubApple({
      chart: { feed: { results: [chartRow()] } },
      chartFailures: 1,
      lookup: { results: [lookupRow()] },
    });

    const result = await fetchAppleChartShows('us', 10, fetchImpl, freshCache());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shows).toHaveLength(1);
  });

  it('serves the next request from the ten-minute cache instead of asking again', async () => {
    const cache = createTtlCache<PodcastShow[]>();
    const fetchImpl = stubApple({
      chart: { feed: { results: [chartRow()] } },
      lookup: { results: [lookupRow()] },
    });

    const first = await fetchAppleChartShows('us', 10, fetchImpl, cache);
    const second = await fetchAppleChartShows('us', 10, fetchImpl, cache);

    expect(first.ok && second.ok).toBe(true);
    // One chart call and one lookup call in total, not four.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it('does not cache a failed chart', async () => {
    const cache = createTtlCache<PodcastShow[]>();
    const failing = stubApple({ chartStatus: 500 });

    await fetchAppleChartShows('us', 10, failing, cache);
    const second = await fetchAppleChartShows('us', 10, failing, cache);

    expect(second.ok).toBe(false);
  });

  it('answers an empty chart without asking for a lookup', async () => {
    const fetchImpl = stubApple({ chart: { feed: { results: [] } } });

    await expect(fetchAppleChartShows('us', 10, fetchImpl, freshCache())).resolves.toEqual({
      ok: true,
      shows: [],
    });
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });
});
