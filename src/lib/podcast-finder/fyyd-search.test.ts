import { describe, expect, it, vi } from 'vitest';

import { buildFyydSearchUrl, parseFyydSearch, searchFyydPodcasts } from './fyyd-search';

/** One row in the shape fyyd actually sends. */
function fyydRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 88753,
    title: 'The Water Drop',
    xmlURL: 'https://example.com/water.xml',
    htmlURL: 'https://fyyd.de/podcast/the-water-drop/0',
    imgURL: 'https://img-1.fyyd.de/pd/micro/abc.png',
    author: 'Padre Dam',
    lastpub: '2026-09-30T07:00:00+02:00',
    episode_count: 89,
    ...overrides,
  };
}

describe('buildFyydSearchUrl', () => {
  it('asks for a page of results from zero, which is what fyyd pages from', () => {
    const url = new URL(buildFyydSearchUrl('  water ', 10));
    expect(url.origin + url.pathname).toBe('https://api.fyyd.de/0.2/search/podcast');
    expect(url.searchParams.get('term')).toBe('water');
    expect(url.searchParams.get('count')).toBe('10');
    expect(url.searchParams.get('page')).toBe('0');
  });

  it('clamps the count', () => {
    expect(buildFyydSearchUrl('water', 5000)).toContain('count=100');
    expect(buildFyydSearchUrl('water', 0)).toContain('count=1');
  });
});

describe('parseFyydSearch', () => {
  it('maps a row to a show that can be judged', () => {
    const parsed = parseFyydSearch({ status: 1, data: [fyydRow()] });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows[0]).toMatchObject({
      source: 'fyyd',
      sourceKey: 'fyyd:88753',
      appleId: null,
      title: 'The Water Drop',
      publisher: 'Padre Dam',
      feedUrl: 'https://example.com/water.xml',
      country: '',
      genres: [],
      episodeCount: 89,
    });
    expect(parsed.shows[0]?.latestReleaseAt?.toISOString()).toBe('2026-09-30T05:00:00.000Z');
  });

  it('keeps a show fyyd has no feed for, and says where else to look', () => {
    const parsed = parseFyydSearch({ data: [fyydRow({ xmlURL: undefined, htmlURL: undefined })] });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows[0]?.feedUrl).toBeNull();
    expect(parsed.shows[0]?.pageUrl).toBe('https://fyyd.de/podcast/88753');
  });

  it('drops rows that are not shows', () => {
    const parsed = parseFyydSearch({ data: [fyydRow(), { id: 'nope' }, null] });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.shows).toHaveLength(1);
  });

  it('refuses a response that is not a fyyd envelope', () => {
    expect(parseFyydSearch({ things: [] })).toEqual({
      ok: false,
      reason: 'fyyd sent something unexpected.',
    });
  });

  it('answers an empty list rather than failing when fyyd has no data', () => {
    expect(parseFyydSearch({ status: 1, data: [] })).toEqual({ ok: true, shows: [] });
  });
});

describe('searchFyydPodcasts', () => {
  it('names fyyd when it refuses', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(searchFyydPodcasts('water', 5, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'fyyd answered 503.',
    });
  });

  it('names a timeout rather than blaming the network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('slow'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await expect(searchFyydPodcasts('water', 5, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'fyyd took too long to answer.',
    });
  });
});
