import { describe, expect, it } from 'vitest';

import type { PodcastFeedReport } from './feed-report';
import type { PodcastShow } from './itunes-search';
import {
  MAX_QUERY_LENGTH,
  extractPodcastSearchTerm,
  matchesPodcastQuery,
  matchesTextQuery,
  parsePodcastQuery,
  type PodcastQueryNode,
} from './search-query';

/** A show with the fields the query reads. */
function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  return {
    appleId: 1,
    title: 'The Water Drop',
    publisher: 'Padre Dam',
    artistId: null,
    source: 'apple',
    sourceKey: 'apple:1',
    feedUrl: 'https://example.com/feed.xml',
    genres: ['Government'],
    country: 'US',
    artworkUrl: null,
    pageUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 10,
    latestReleaseAt: null,
    explicit: false,
    ...overrides,
  };
}

/** A report with the cadence numbers a query can compare. */
function report(overrides: Partial<PodcastFeedReport> = {}): PodcastFeedReport {
  return {
    feedUrl: 'https://example.com/feed.xml',
    ok: true,
    reason: null,
    feedTitle: 'The Water Drop',
    description: null,
    latestEpisodeTitle: null,
    language: null,
    health: 'active',
    claim: null,
    claimMismatch: null,
    cadence: {
      datedEpisodeCount: 21,
      lastEpisodeAt: null,
      daysSinceLastEpisode: 39,
      medianGapDays: 42,
      gapSpreadDays: 2,
      episodesInLast30Days: 0,
      episodesInLast90Days: 1,
      episodesInLast365Days: 7,
      medianDurationSeconds: 1320,
      monthlyReleaseCounts: [],
    },
    ...overrides,
  };
}

/** Parse a query that is expected to work, and fail loudly when it does not. */
function node(query: string): PodcastQueryNode {
  const parsed = parsePodcastQuery(query);
  if (!parsed.ok) throw new Error(parsed.reason);
  if (parsed.node === null) throw new Error('expected a tree');
  return parsed.node;
}

describe('parsePodcastQuery', () => {
  it('treats an empty query as everything', () => {
    expect(parsePodcastQuery('   ')).toEqual({ ok: true, node: null });
  });

  it('reads two bare terms as AND', () => {
    expect(node('water drop')).toEqual({
      kind: 'and',
      nodes: [
        { kind: 'text', field: null, value: 'water' },
        { kind: 'text', field: null, value: 'drop' },
      ],
    });
  });

  it('gives OR lower precedence than AND', () => {
    expect(node('a b OR c')).toMatchObject({
      kind: 'or',
      nodes: [
        {
          kind: 'and',
          nodes: [
            { kind: 'text', field: null, value: 'a' },
            { kind: 'text', field: null, value: 'b' },
          ],
        },
        { kind: 'text', field: null, value: 'c' },
      ],
    });
  });

  it('binds NOT to the term after it', () => {
    expect(node('NOT dead')).toEqual({
      kind: 'not',
      node: { kind: 'text', field: null, value: 'dead' },
    });
  });

  it('lets parentheses override precedence', () => {
    expect(node('(a OR b) c')).toMatchObject({
      kind: 'and',
      nodes: [{ kind: 'or' }, { kind: 'text', field: null, value: 'c' }],
    });
  });

  it('accepts lowercase keywords', () => {
    expect(node('a or b')).toMatchObject({ kind: 'or' });
  });

  it('reads a quoted phrase as one value, spaces and all', () => {
    expect(node('publisher:"Pipe Media"')).toEqual({
      kind: 'text',
      field: 'publisher',
      value: 'Pipe Media',
    });
  });

  it('reads a field prefix', () => {
    expect(node('genre:government')).toEqual({
      kind: 'text',
      field: 'genre',
      value: 'government',
    });
  });

  it('reads a numeric comparison and defaults a bare value to equals', () => {
    expect(node('gap>30')).toEqual({ kind: 'number', field: 'gap', operator: '>', value: 30 });
    expect(node('last<=14')).toEqual({
      kind: 'number',
      field: 'last',
      operator: '<=',
      value: 14,
    });
    expect(node('episodes:5')).toEqual({
      kind: 'number',
      field: 'episodes',
      operator: '=',
      value: 5,
    });
    expect(node('releases>=8')).toEqual({
      kind: 'number',
      field: 'releases',
      operator: '>=',
      value: 8,
    });
  });

  it('names the field when a numeric field gets something else', () => {
    expect(parsePodcastQuery('gap:soon')).toEqual({
      ok: false,
      reason: '`gap:` wants a number, as in `gap>30`.',
    });
  });

  it('lists the real fields when one is misspelled', () => {
    const parsed = parsePodcastQuery('titel:water');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('no `titel` field');
    expect(parsed.reason).toContain('title');
  });

  it('rejects an unclosed quote', () => {
    expect(parsePodcastQuery('title:"water')).toEqual({
      ok: false,
      reason: 'A quote is not closed.',
    });
  });

  it('rejects an empty group and a dangling keyword', () => {
    expect(parsePodcastQuery('()')).toEqual({
      ok: false,
      reason: 'There is an empty group of parentheses.',
    });
    expect(parsePodcastQuery('water AND')).toEqual({
      ok: false,
      reason: '`AND` needs a term after it.',
    });
    expect(parsePodcastQuery('NOT')).toEqual({
      ok: false,
      reason: '`NOT` needs a term after it.',
    });
  });

  it('rejects an unclosed bracket', () => {
    expect(parsePodcastQuery('(water')).toEqual({ ok: false, reason: 'A bracket is not closed.' });
  });

  it('caps how long a query may be', () => {
    const parsed = parsePodcastQuery('a'.repeat(MAX_QUERY_LENGTH + 1));
    expect(parsed).toEqual({
      ok: false,
      reason: `Queries are capped at ${MAX_QUERY_LENGTH} characters.`,
    });
  });
});

describe('matchesTextQuery', () => {
  it('matches a substring whatever the case', () => {
    expect(matchesTextQuery('The Water Drop', 'water')).toBe(true);
    expect(matchesTextQuery('The Water Drop', 'WATER')).toBe(true);
  });

  it('treats * as any run and ? as one character', () => {
    expect(matchesTextQuery('The Water Drop', 'wat*')).toBe(true);
    expect(matchesTextQuery('The Water Drop', 'w?ter')).toBe(true);
    expect(matchesTextQuery('ct', 'c?t')).toBe(false);
  });

  it('treats regex punctuation as literal text', () => {
    expect(matchesTextQuery('Cost (per litre)', '(per litre)')).toBe(true);
    expect(matchesTextQuery('abc', 'a.c')).toBe(false);
  });
});

describe('matchesPodcastQuery', () => {
  const subject = { show: show(), report: report() };

  it('matches a bare term across title, publisher and genres', () => {
    expect(matchesPodcastQuery(node('drop'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('padre'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('government'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('volcano'), subject)).toBe(false);
  });

  it('matches a bare term in the words the feed itself supplies', () => {
    const withDescription = {
      show: show(),
      report: report({ description: 'A show about volcanoes.' }),
    };

    expect(matchesPodcastQuery(node('volcano'), withDescription)).toBe(true);
    expect(matchesPodcastQuery(node('title:volcano'), withDescription)).toBe(false);
  });

  it('filters on the language the feed declares', () => {
    const english = { show: show(), report: report({ language: 'en' }) };

    expect(matchesPodcastQuery(node('language:en'), english)).toBe(true);
    expect(matchesPodcastQuery(node('language:fr'), english)).toBe(false);
    // A feed that has not been read cannot be said to be in any language.
    expect(matchesPodcastQuery(node('language:en'), subject)).toBe(false);
  });

  it('filters on the median episode length in minutes', () => {
    // The fixture's median episode is 1320 seconds, which is 22 minutes.
    expect(matchesPodcastQuery(node('length>30'), subject)).toBe(false);
    expect(matchesPodcastQuery(node('length<30'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('length:22'), subject)).toBe(true);
  });

  it('filters on the releases across the feed year of bars', () => {
    const steady = {
      show: show(),
      report: report({
        cadence: {
          ...report().cadence!,
          monthlyReleaseCounts: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        },
      }),
    };

    expect(matchesPodcastQuery(node('releases:12'), steady)).toBe(true);
    expect(matchesPodcastQuery(node('releases>=6'), steady)).toBe(true);
    expect(matchesPodcastQuery(node('releases>12'), steady)).toBe(false);
    // Nothing measured releases yet, so the row does not match by accident.
    expect(matchesPodcastQuery(node('releases>0'), subject)).toBe(false);
  });

  it('scopes a field term to that field only', () => {
    expect(matchesPodcastQuery(node('publisher:padre'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('title:padre'), subject)).toBe(false);
  });

  it('combines AND, OR and NOT', () => {
    expect(matchesPodcastQuery(node('water AND padre'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('water AND volcano'), subject)).toBe(false);
    expect(matchesPodcastQuery(node('volcano OR padre'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('water AND NOT volcano'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('NOT water'), subject)).toBe(false);
  });

  it('compares the numbers the feed measured', () => {
    expect(matchesPodcastQuery(node('gap>30'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('gap<30'), subject)).toBe(false);
    expect(matchesPodcastQuery(node('last<=39'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('episodes:21'), subject)).toBe(true);
  });

  it('reads the verdict as a field', () => {
    expect(matchesPodcastQuery(node('verdict:active'), subject)).toBe(true);
    expect(matchesPodcastQuery(node('verdict:dead'), subject)).toBe(false);
  });

  it('does not match a numeric term while the feed is unanswered', () => {
    const unanswered = { show: show(), report: null };
    expect(matchesPodcastQuery(node('gap>30'), unanswered)).toBe(false);
    expect(matchesPodcastQuery(node('verdict:unknown'), unanswered)).toBe(true);
  });

  it('treats a report with no health as unknown', () => {
    const subjectWithoutVerdict = { show: show(), report: report({ health: null }) };
    expect(matchesPodcastQuery(node('verdict:unknown'), subjectWithoutVerdict)).toBe(true);
  });
});

describe('extractPodcastSearchTerm', () => {
  it('takes the words a directory can search for', () => {
    expect(extractPodcastSearchTerm(node('water drain'))).toBe('water drain');
  });

  it('keeps the words a field term is scoped to, and searches a superset', () => {
    expect(extractPodcastSearchTerm(node('title:water'))).toBe('water');
  });

  it('leaves out a word the visitor excluded, so the request is not wasted', () => {
    expect(extractPodcastSearchTerm(node('water AND NOT fire'))).toBe('water');
  });

  it('asks for nothing when the query is only fields or numbers', () => {
    expect(extractPodcastSearchTerm(node('gap>30'))).toBe('');
    expect(extractPodcastSearchTerm(node('verdict:active'))).toBe('');
    expect(extractPodcastSearchTerm(null)).toBe('');
  });

  it('strips wildcards and drops a word too short to search', () => {
    expect(extractPodcastSearchTerm(node('wa*ter AND a'))).toBe('water');
  });
});
