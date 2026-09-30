import { describe, expect, it, vi } from 'vitest';

import { buildArchiveSearchUrl, parseArchiveSearch, searchArchivePodcasts } from './archive-search';

/** One document in the shape the Archive's search API sends. */
function archiveDoc(overrides: Record<string, unknown> = {}) {
  return {
    identifier: 'osr141-welcome-and-i',
    title: 'OSR141 Welcome and Introduction',
    creator: 'Open Science Radio',
    date: '2019-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildArchiveSearchUrl', () => {
  it('searches audio inside the podcasts collection, newest first', () => {
    const url = new URL(buildArchiveSearchUrl('water', 10));
    expect(url.origin + url.pathname).toBe('https://archive.org/advancedsearch.php');
    const query = url.searchParams.get('q') ?? '';
    expect(query).toContain('collection:podcasts');
    expect(query).toContain('mediatype:audio');
    expect(query).toContain('title:("water")');
    expect(query).toContain('creator:("water")');
    expect(url.searchParams.getAll('fl[]')).toEqual(['identifier', 'title', 'creator', 'date']);
    expect(url.searchParams.get('rows')).toBe('10');
    expect(url.searchParams.get('output')).toBe('json');
  });

  it('reduces the term to words, so it cannot edit the query around it', () => {
    const url = new URL(buildArchiveSearchUrl('water" OR collection:everything*', 5));
    const query = url.searchParams.get('q') ?? '';
    expect(query).not.toContain('collection:everything');
    expect(query).toContain('title:("water OR collection everything")');
  });

  it('clamps the row count', () => {
    expect(buildArchiveSearchUrl('water', 5000)).toContain('rows=100');
    expect(buildArchiveSearchUrl('water', 0)).toContain('rows=1');
  });
});

describe('parseArchiveSearch', () => {
  it('maps an item to a show with no feed, because the Archive has none', () => {
    const parsed = parseArchiveSearch({ response: { docs: [archiveDoc()] } });
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.shows[0]).toMatchObject({
      source: 'archive',
      sourceKey: 'archive:osr141-welcome-and-i',
      appleId: null,
      title: 'OSR141 Welcome and Introduction',
      publisher: 'Open Science Radio',
      feedUrl: null,
      country: '',
      genres: [],
      episodeCount: null,
      pageUrl: 'https://archive.org/details/osr141-welcome-and-i',
      artworkUrl: 'https://archive.org/services/img/osr141-welcome-and-i',
    });
  });

  it('reads a title or creator that arrives as a list', () => {
    const parsed = parseArchiveSearch({
      response: { docs: [archiveDoc({ title: ['First', 'Second'], creator: ['One', 'Two'] })] },
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.shows[0]?.title).toBe('First');
    expect(parsed.shows[0]?.publisher).toBe('One');
  });

  it('falls back to the identifier for a title, and drops rows with none', () => {
    const parsed = parseArchiveSearch({
      response: { docs: [archiveDoc({ title: undefined }), { title: 'no identifier' }] },
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.shows).toHaveLength(1);
    expect(parsed.shows[0]?.title).toBe('osr141-welcome-and-i');
  });

  it('refuses a response that is not an Archive envelope', () => {
    expect(parseArchiveSearch({ docs: [] })).toEqual({
      ok: false,
      reason: 'The Archive sent something unexpected.',
    });
  });
});

describe('searchArchivePodcasts', () => {
  it('names the Archive when it refuses', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
    await expect(searchArchivePodcasts('water', 5, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'The Archive answered 502.',
    });
  });

  it('answers a sentence when the Archive cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(searchArchivePodcasts('water', 5, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'Could not reach the Archive.',
    });
  });
});
