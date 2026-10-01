import { describe, expect, it } from 'vitest';

import {
  DIRECTORY_SEARCH_EDGE_SECONDS,
  DIRECTORY_SEARCH_EDGE_STALE_SECONDS,
  readDirectorySearchCacheControl,
  readDirectorySearchCacheKey,
} from './directory-search-cache';

describe('readDirectorySearchCacheKey', () => {
  it('separates the inputs that change the rows', () => {
    const plain = readDirectorySearchCacheKey({ term: 'science' });
    const elsewhere = readDirectorySearchCacheKey({ term: 'science', country: 'nz' });
    const genre = readDirectorySearchCacheKey({ term: 'science', genreId: 1533 });

    expect(elsewhere).not.toBe(plain);
    expect(genre).not.toBe(plain);
    expect(genre).not.toBe(elsewhere);
  });

  it('ignores case and padding, which do not change the rows', () => {
    expect(readDirectorySearchCacheKey({ term: '  Science ' })).toBe(
      readDirectorySearchCacheKey({ term: 'science' })
    );
  });
});

describe('readDirectorySearchCacheControl', () => {
  it('lets the edge hold an answer every directory gave', () => {
    expect(readDirectorySearchCacheControl([])).toBe(
      `public, s-maxage=${DIRECTORY_SEARCH_EDGE_SECONDS}, stale-while-revalidate=${DIRECTORY_SEARCH_EDGE_STALE_SECONDS}`
    );
  });

  it('keeps a partial answer out of the edge cache', () => {
    expect(readDirectorySearchCacheControl(['fyyd took too long to answer.'])).toBe('no-store');
  });
});
