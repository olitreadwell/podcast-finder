import { describe, expect, it, vi } from 'vitest';

import {
  buildPodcastPublisherRouteUrl,
  buildPodcastSearchRouteUrl,
  clampPodcastResultLimit,
  describeStatusProgress,
  fetchPodcastStatus,
  fetchPublisherShows,
  listResultFeedUrls,
  searchPodcastShows,
} from './api-client';
import { DEFAULT_PODCAST_SEARCH_LIMIT } from './itunes-search';

/** One serialised show, as the search route returns it. */
function wireShow(overrides: Record<string, unknown> = {}) {
  return {
    appleId: 1,
    title: 'Weekly Wipe',
    publisher: 'Drain Media',
    artistId: null,
    source: 'apple',
    sourceKey: 'apple:1',
    feedUrl: 'https://example.com/feed.xml',
    genres: ['Society & Culture'],
    country: 'US',
    artworkUrl: null,
    pageUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 10,
    latestReleaseAt: '2025-12-22T09:00:00.000Z',
    explicit: false,
    ...overrides,
  };
}

/** A JSON response body. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildPodcastSearchRouteUrl', () => {
  it('builds a stable URL', () => {
    expect(
      buildPodcastSearchRouteUrl({ term: ' drains ', country: 'nz', genreId: 1324, limit: 10 })
    ).toBe('/api/podcast-search?term=drains&country=nz&genreId=1324&limit=10');
  });

  it('omits an unset genre and defaults the storefront and limit', () => {
    const url = buildPodcastSearchRouteUrl({ term: 'drains' });

    expect(url).toContain('country=us');
    expect(url).toContain(`limit=${DEFAULT_PODCAST_SEARCH_LIMIT}`);
    expect(url).not.toContain('genreId');
  });

  it('omits the all-genres sentinel', () => {
    expect(buildPodcastSearchRouteUrl({ term: 'drains', genreId: 0 })).not.toContain('genreId');
  });
});

describe('clampPodcastResultLimit', () => {
  it('keeps the limit inside what Apple serves', () => {
    expect(clampPodcastResultLimit(0)).toBe(1);
    expect(clampPodcastResultLimit(5000)).toBe(200);
    expect(clampPodcastResultLimit(20.9)).toBe(20);
  });
});

describe('searchPodcastShows', () => {
  it('returns domain shows with real dates', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ shows: [wireShow()] }));

    const outcome = await searchPodcastShows({ term: 'drains' }, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.shows[0]?.latestReleaseAt).toBeInstanceOf(Date);
      expect(outcome.shows[0]?.title).toBe('Weekly Wipe');
    }
  });

  it('survives a null release date', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ shows: [wireShow({ latestReleaseAt: null })] })
    );

    const outcome = await searchPodcastShows({ term: 'drains' }, fetchImpl);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.shows[0]?.latestReleaseAt).toBeNull();
  });

  it('passes the route’s own error sentence through', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Apple answered 429.' }, 502));

    const outcome = await searchPodcastShows({ term: 'drains' }, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('Apple answered 429.');
  });

  it('falls back to a status sentence when the error body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>oops</html>', { status: 500 }));

    const outcome = await searchPodcastShows({ term: 'drains' }, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('Search failed (500).');
  });

  it('handles a body with no shows array', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }));

    const outcome = await searchPodcastShows({ term: 'drains' }, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('Search returned an unexpected shape.');
  });

  it('reports a transport failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    const outcome = await searchPodcastShows({ term: 'drains' }, fetchImpl);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('Could not reach the search route.');
  });
});

describe('fetchPodcastStatus', () => {
  it('posts unique feed URLs and returns reports', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ feeds: ['https://example.com/feed.xml'] });
      return jsonResponse({ reports: [{ feedUrl: 'https://example.com/feed.xml', ok: true }] });
    });

    const outcome = await fetchPodcastStatus(
      ['https://example.com/feed.xml', 'https://example.com/feed.xml'],
      fetchImpl
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.reports).toHaveLength(1);
  });

  it('asks for nothing when there are no feeds', async () => {
    const fetchImpl = vi.fn();

    const outcome = await fetchPodcastStatus([], fetchImpl);

    expect(outcome).toEqual({ ok: true, reports: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps the batch at what the route accepts', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { feeds: string[] };
      expect(body.feeds).toHaveLength(20);
      return jsonResponse({ reports: [] });
    });
    const feedUrls = new Array(30).fill(null).map((_, index) => `https://example.com/${index}.xml`);

    await fetchPodcastStatus(feedUrls, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reports a refused batch in plain words', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'Send between 1 and 20 feed URLs.' }, 400)
    );

    const outcome = await fetchPodcastStatus(['https://example.com/feed.xml'], fetchImpl);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('Send between 1 and 20 feed URLs.');
  });

  it('reports a transport failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    const outcome = await fetchPodcastStatus(['https://example.com/feed.xml'], fetchImpl);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('Could not reach the status route.');
  });
});

describe('describeStatusProgress', () => {
  it('says nothing when nothing is being checked', () => {
    expect(describeStatusProgress(0, 0)).toBe('');
  });

  it('counts progress out loud', () => {
    expect(describeStatusProgress(0, 12)).toBe('Checking 12 shows for recent episodes.');
    expect(describeStatusProgress(4, 12)).toBe('Checked 4 of 12 shows.');
    expect(describeStatusProgress(12, 12)).toBe('Checked all 12 shows.');
  });
});

describe('listResultFeedUrls', () => {
  /** A show with just the feed URL field set, plus the fields nothing here reads. */
  function showWithFeed(feedUrl: string | null) {
    return {
      appleId: 1,
      title: 'Weekly Wipe',
      publisher: 'Drain Media',
      feedUrl,
      genres: [],
      country: 'US',
      artworkUrl: null,
      artistId: null,
      source: 'apple' as const,
      sourceKey: 'apple:1',
      pageUrl: 'https://podcasts.apple.com/podcast/id1',
      episodeCount: null,
      latestReleaseAt: null,
      explicit: false,
    };
  }

  it('deduplicates and drops shows Apple gave no feed for', () => {
    const shows = [
      showWithFeed('https://example.com/a.xml'),
      showWithFeed(null),
      showWithFeed('https://example.com/a.xml'),
      showWithFeed('https://example.com/b.xml'),
    ];

    expect(listResultFeedUrls(shows)).toEqual([
      'https://example.com/a.xml',
      'https://example.com/b.xml',
    ]);
  });

  it('caps the list at what the status route accepts', () => {
    const shows = new Array(30)
      .fill(null)
      .map((_, index) => showWithFeed(`https://example.com/${index}.xml`));

    expect(listResultFeedUrls(shows)).toHaveLength(20);
  });

  it('answers an empty list for no shows', () => {
    expect(listResultFeedUrls([])).toEqual([]);
  });
});

describe('buildPodcastPublisherRouteUrl', () => {
  it('carries the artist id and storefront', () => {
    expect(buildPodcastPublisherRouteUrl(125443881, 'nz')).toBe(
      '/api/publisher-shows?artistId=125443881&country=nz'
    );
  });
});

describe('fetchPublisherShows', () => {
  it('answers domain-typed shows', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ shows: [wireShow({ artistId: 125443881 })] })
    ) as unknown as typeof fetch;

    const outcome = await fetchPublisherShows(125443881, 'us', fetchImpl);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.shows[0]?.artistId).toBe(125443881);
    expect(outcome.shows[0]?.latestReleaseAt).toBeInstanceOf(Date);
  });

  it('uses the route error wording', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'Apple answered 502.' }, 502)
    ) as unknown as typeof fetch;

    await expect(fetchPublisherShows(1, 'us', fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Apple answered 502.',
    });
  });

  it('refuses a response that is not a show list', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ shows: 'nope' })) as unknown as typeof fetch;

    await expect(fetchPublisherShows(1, 'us', fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Publisher lookup returned an unexpected shape.',
    });
  });

  it('answers a sentence when the route cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(fetchPublisherShows(1, 'us', fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Could not reach the publisher route.',
    });
  });
});
