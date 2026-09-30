import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PODCAST_SEARCH_LIMIT,
  ITUNES_MAX_LIMIT,
  buildItunesPodcastSearchUrl,
  buildItunesPublisherLookupUrl,
  clampPodcastSearchLimit,
  lookupItunesPublisherShows,
  parseItunesPodcastSearch,
  searchItunesPodcasts,
  type PodcastShow,
} from './itunes-search';

/** One result row in the shape Apple actually sends. */
function appleRow(overrides: Record<string, unknown> = {}) {
  return {
    wrapperType: 'track',
    kind: 'podcast',
    trackId: 1234567890,
    trackName: 'Weekly Wipe',
    artistName: 'Drain Media',
    artistId: 987654321,
    feedUrl: 'https://example.com/feed.xml',
    genres: ['Society & Culture', 'Podcasts'],
    country: 'USA',
    artworkUrl600: 'https://example.com/art-600.jpg',
    collectionViewUrl: 'https://podcasts.apple.com/us/podcast/id1234567890',
    trackCount: 42,
    releaseDate: '2025-12-22T09:00:00Z',
    contentAdvisoryRating: 'Clean',
    ...overrides,
  };
}

/** A show for the sorting and tagging tests. */
function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  return {
    appleId: 1,
    title: 'Weekly Wipe',
    publisher: 'Drain Media',
    artistId: null,
    feedUrl: 'https://example.com/feed.xml',
    genres: ['Society & Culture'],
    country: 'US',
    artworkUrl: null,
    appleUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 10,
    latestReleaseAt: new Date('2025-12-22T09:00:00.000Z'),
    explicit: false,
    ...overrides,
  };
}

describe('clampPodcastSearchLimit', () => {
  it('defaults, floors and caps to what Apple serves', () => {
    expect(clampPodcastSearchLimit(undefined)).toBe(DEFAULT_PODCAST_SEARCH_LIMIT);
    expect(clampPodcastSearchLimit(Number.NaN)).toBe(DEFAULT_PODCAST_SEARCH_LIMIT);
    expect(clampPodcastSearchLimit(0)).toBe(1);
    expect(clampPodcastSearchLimit(5000)).toBe(ITUNES_MAX_LIMIT);
    expect(clampPodcastSearchLimit(12.7)).toBe(12);
  });
});

describe('buildItunesPodcastSearchUrl', () => {
  it('builds a podcast search with a stable parameter order', () => {
    const url = buildItunesPodcastSearchUrl({
      term: ' drains ',
      country: 'nz',
      genreId: 1324,
      limit: 10,
    });

    expect(url).toBe(
      'https://itunes.apple.com/search?term=drains&media=podcast&entity=podcast&limit=10&country=nz&genreId=1324'
    );
  });

  it('leaves the genre out when none is chosen and defaults the storefront', () => {
    const url = buildItunesPodcastSearchUrl({ term: 'drains' });

    expect(url).toContain('country=us');
    expect(url).not.toContain('genreId');
  });
});

describe('parseItunesPodcastSearch', () => {
  it('normalises show metadata', () => {
    const parsed = parseItunesPodcastSearch({ resultCount: 1, results: [appleRow()] });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows[0]).toEqual({
      appleId: 1234567890,
      title: 'Weekly Wipe',
      publisher: 'Drain Media',
      artistId: 987654321,
      feedUrl: 'https://example.com/feed.xml',
      genres: ['Society & Culture', 'Podcasts'],
      country: 'USA',
      artworkUrl: 'https://example.com/art-600.jpg',
      appleUrl: 'https://podcasts.apple.com/us/podcast/id1234567890',
      episodeCount: 42,
      latestReleaseAt: new Date('2025-12-22T09:00:00.000Z'),
      explicit: false,
    });
  });

  it('falls back to smaller artwork and a directory link when Apple omits the big ones', () => {
    const parsed = parseItunesPodcastSearch({
      results: [
        appleRow({
          artworkUrl600: undefined,
          artworkUrl100: 'https://example.com/art-100.jpg',
          collectionViewUrl: undefined,
          trackViewUrl: undefined,
        }),
      ],
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows[0]?.artworkUrl).toBe('https://example.com/art-100.jpg');
    expect(parsed.shows[0]?.appleUrl).toBe('https://podcasts.apple.com/podcast/id1234567890');
  });

  it('marks explicit shows and missing feed URLs', () => {
    const parsed = parseItunesPodcastSearch({
      results: [appleRow({ contentAdvisoryRating: 'Explicit', feedUrl: undefined })],
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows[0]?.explicit).toBe(true);
    expect(parsed.shows[0]?.feedUrl).toBeNull();
  });

  it('drops malformed rows and keeps the good ones', () => {
    const parsed = parseItunesPodcastSearch({
      results: [appleRow(), { trackId: 'not a number' }, appleRow({ trackId: 2 })],
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows.map((entry) => entry.appleId)).toEqual([1234567890, 2]);
  });

  it('answers a reason when the body is not a search response', () => {
    const parsed = parseItunesPodcastSearch('<html>rate limited</html>');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('Apple sent something unexpected.');
  });
});

describe('searchItunesPodcasts', () => {
  it('searches and parses', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('entity=podcast');
      return new Response(JSON.stringify({ resultCount: 1, results: [appleRow()] }), {
        status: 200,
      });
    });

    const result = await searchItunesPodcasts({ term: 'drains' }, fetchImpl);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shows[0]?.title).toBe('Weekly Wipe');
  });

  it('reports an upstream status', async () => {
    const fetchImpl = vi.fn(async () => new Response('slow down', { status: 429 }));

    const result = await searchItunesPodcasts({ term: 'drains' }, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Apple answered 429.');
  });

  it('reports a timeout in plain words', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });

    const result = await searchItunesPodcasts({ term: 'drains' }, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Apple took too long to answer.');
  });
});

describe('show fixture', () => {
  it('defaults to an active-looking show', () => {
    expect(show().title).toBe('Weekly Wipe');
  });
});

describe('publisher lookup', () => {
  it('asks Apple for one artist id and only its podcasts', () => {
    const url = new URL(buildItunesPublisherLookupUrl(125443881, 'nz'));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/lookup');
    expect(url.searchParams.get('id')).toBe('125443881');
    expect(url.searchParams.get('entity')).toBe('podcast');
    expect(url.searchParams.get('country')).toBe('nz');
  });

  it('drops the artist row Apple returns ahead of the shows', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        resultCount: 3,
        results: [
          { wrapperType: 'artist', artistId: 125443881, artistName: 'NPR' },
          appleRow({ trackId: 1, trackName: 'Up First from NPR' }),
          appleRow({ trackId: 2, trackName: 'Fresh Air' }),
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await lookupItunesPublisherShows(125443881, {}, fetchImpl);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shows.map((entry) => entry.title)).toEqual(['Up First from NPR', 'Fresh Air']);
  });

  it('answers a sentence when Apple refuses', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(lookupItunesPublisherShows(1, {}, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Apple answered 503.',
    });
  });

  it('names a timeout rather than blaming the network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await expect(lookupItunesPublisherShows(1, {}, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Apple took too long to answer.',
    });
  });
});
