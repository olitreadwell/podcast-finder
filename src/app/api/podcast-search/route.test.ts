import { beforeEach, describe, expect, it, vi } from 'vitest';

import { directorySearchCache } from '@/lib/podcast-finder/directory-search-cache';

import { GET } from './route';

/** A fetch stand-in that answers each directory from a map of URLs to bodies. */
function stubDirectories(answers: { fyydStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('itunes.apple.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              trackId: 1,
              trackName: 'The Water Drop',
              artistName: 'Padre Dam',
              feedUrl: 'https://example.com/water.xml',
              genres: ['Government'],
              country: 'USA',
              collectionViewUrl: 'https://podcasts.apple.com/podcast/id1',
            },
          ],
        }),
      };
    }
    if (url.includes('api.fyyd.de')) {
      if (answers.fyydStatus !== undefined && answers.fyydStatus >= 400) {
        return { ok: false, status: answers.fyydStatus };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
    if (url.includes('archive.org')) {
      return { ok: true, status: 200, json: async () => ({ response: { docs: [] } }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** One request to the route, built the way the page builds it. */
function searchRequest(query: string): Request {
  return new Request(`https://podcast-finder.test/api/podcast-search?${query}`);
}

describe('GET /api/podcast-search', () => {
  beforeEach(() => {
    directorySearchCache.clear();
  });

  it('marks an answer every directory gave as cacheable at the edge', async () => {
    vi.stubGlobal('fetch', stubDirectories() as unknown as typeof fetch);

    const response = await GET(searchRequest('term=science'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=600, stale-while-revalidate=300'
    );
    const body = (await response.json()) as { shows: unknown[]; unavailable: string[] };
    expect(body.shows).toHaveLength(1);
    expect(body.unavailable).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('answers a repeated term without asking a directory again', async () => {
    const fetchImpl = stubDirectories();
    vi.stubGlobal('fetch', fetchImpl as unknown as typeof fetch);

    await GET(searchRequest('term=science'));
    const callsAfterFirst = fetchImpl.mock.calls.length;
    const second = await GET(searchRequest('term=science'));

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
    expect(second.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('keeps a partial answer out of the edge cache', async () => {
    vi.stubGlobal('fetch', stubDirectories({ fyydStatus: 503 }) as unknown as typeof fetch);

    const response = await GET(searchRequest('term=science'));
    const body = (await response.json()) as { unavailable: string[] };

    expect(response.status).toBe(200);
    expect(body.unavailable).toHaveLength(1);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    vi.unstubAllGlobals();
  });

  it('rejects a term too short to search', async () => {
    const response = await GET(searchRequest('term=a'));

    expect(response.status).toBe(400);
  });
});
