import { describe, expect, it } from 'vitest';

import { createTtlCache, PODCAST_REPORT_TTL_MS } from './analysis-cache';

describe('createTtlCache', () => {
  it('stores and reads values', () => {
    const cache = createTtlCache<string>();

    cache.set('a', 'first');

    expect(cache.get('a')).toBe('first');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size()).toBe(1);
  });

  it('expires entries once the time to live has passed', () => {
    let clock = 1_000;
    const cache = createTtlCache<string>(100, () => clock);

    cache.set('a', 'first');
    clock += 99;
    expect(cache.get('a')).toBe('first');

    clock += 2;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('clears everything', () => {
    const cache = createTtlCache<string>();

    cache.set('a', 'first');
    cache.set('b', 'second');
    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('defaults to the report time to live', () => {
    let clock = 0;
    const cache = createTtlCache<string>(undefined, () => clock);

    cache.set('a', 'first');
    clock += PODCAST_REPORT_TTL_MS - 1;
    expect(cache.get('a')).toBe('first');
  });
});
