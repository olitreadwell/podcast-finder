import { describe, expect, it } from 'vitest';

import type { PodcastFeedReport } from './feed-report';
import type { PodcastShow } from './itunes-search';
import { buildPodcastTableRows, sortPodcastTableRows } from './show-table';

/** A show with only the fields a row reads. */
function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  const appleId = typeof overrides.appleId === 'number' ? overrides.appleId : 1;
  return {
    appleId,
    source: 'apple',
    sourceKey: `apple:${appleId}`,
    title: 'Weekly Wipe',
    publisher: 'Drain Media',
    artistId: null,
    feedUrl: `https://example.com/${appleId}.xml`,
    genres: [],
    country: 'US',
    artworkUrl: null,
    pageUrl: 'https://podcasts.apple.com/podcast/id1',
    episodeCount: 10,
    latestReleaseAt: new Date('2025-12-22T09:00:00.000Z'),
    explicit: false,
    ...overrides,
  };
}

/** The cadence numbers a report carries, with only the tested fields changed. */
const BASE_CADENCE: NonNullable<PodcastFeedReport['cadence']> = {
  datedEpisodeCount: 30,
  lastEpisodeAt: '2025-12-22T09:00:00.000Z',
  daysSinceLastEpisode: 3,
  medianGapDays: 7,
  gapSpreadDays: 1,
  episodesInLast30Days: 4,
  episodesInLast90Days: 13,
  episodesInLast365Days: 52,
  medianDurationSeconds: 2880,
  monthlyReleaseCounts: new Array(12).fill(4),
};

/** A feed report with the numbers a row reads. */
function report(overrides: Partial<PodcastFeedReport> = {}): PodcastFeedReport {
  return {
    feedUrl: 'https://example.com/1.xml',
    ok: true,
    reason: null,
    feedTitle: 'Weekly Wipe',
    description: null,
    latestEpisodeTitle: 'Episode 30',
    language: null,
    health: 'active',
    claim: null,
    claimMismatch: null,
    cadence: BASE_CADENCE,
    ...overrides,
  };
}

const NOW = new Date('2025-12-25T09:00:00.000Z');

describe('buildPodcastTableRows', () => {
  it('uses the feed’s measured numbers once it has them', () => {
    const rows = buildPodcastTableRows([show()], { 'https://example.com/1.xml': report() }, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastEpisode).toEqual({ text: '3 days ago', value: 3 });
    expect(rows[0]?.gap).toEqual({ text: 'every 7 days', value: 7 });
    expect(rows[0]?.episodes).toEqual({ text: '30 in feed', value: 30 });
    expect(rows[0]?.length).toEqual({ text: '48 min', value: 2880 });
    expect(rows[0]?.tags.map((tag) => tag.id)).toEqual(['health-active']);
  });

  it('carries the promise the dates contradict', () => {
    const rows = buildPodcastTableRows(
      [show()],
      {
        'https://example.com/1.xml': report({
          health: 'dead',
          claimMismatch: { direction: 'slower', sentence: 'Says weekly, actually every ~400 days' },
        }),
      },
      NOW
    );

    expect(rows[0]?.claimMismatchSentence).toBe('Says weekly, actually every ~400 days');
    expect(rows[0]?.tags.map((tag) => tag.label)).toContain('Schedule promise broken');
  });

  it('names whose episode count it shows before the feed answers', () => {
    const rows = buildPodcastTableRows(
      [show(), show({ appleId: 2, source: 'fyyd', sourceKey: 'fyyd:2', episodeCount: 4 })],
      {},
      NOW
    );

    expect(rows[0]?.episodes).toEqual({ text: '10 per Apple', value: 10 });
    expect(rows[1]?.episodes).toEqual({ text: '4 per fyyd', value: 4 });
    expect(rows[0]?.gap).toEqual({ text: 'not measured', value: null });
    expect(rows[0]?.length).toEqual({ text: 'not measured', value: null });
    expect(rows[0]?.tags).toEqual([]);
  });

  it('leaves a show the directory gave no feed for unmeasured but dated', () => {
    const rows = buildPodcastTableRows(
      [
        show({
          source: 'archive',
          sourceKey: 'archive:osr141',
          appleId: null,
          feedUrl: null,
          episodeCount: null,
        }),
      ],
      {},
      NOW
    );

    expect(rows[0]?.report).toBeNull();
    expect(rows[0]?.episodes).toEqual({ text: 'not known', value: null });
    expect(rows[0]?.lastEpisode.text).toBe('3 days ago');
  });

  it('carries the language and the year of releases a feed declares', () => {
    const rows = buildPodcastTableRows(
      [show()],
      { 'https://example.com/1.xml': report({ language: 'en' }) },
      NOW
    );

    expect(rows[0]?.language).toEqual({ text: 'en', value: 'en' });
    expect(rows[0]?.releasesLastYear).toBe(48);
  });

  it('says the language is not known and the releases not measured before a feed answers', () => {
    const rows = buildPodcastTableRows([show()], {}, NOW);

    expect(rows[0]?.language).toEqual({ text: 'not known', value: null });
    expect(rows[0]?.releasesLastYear).toBeNull();
  });
});

describe('sortPodcastTableRows', () => {
  /** Three rows with different titles, verdicts, ages, gaps and counts. */
  function threeRows() {
    return buildPodcastTableRows(
      [
        show({ appleId: 1, title: 'Zebra Weekly', feedUrl: 'https://example.com/a.xml' }),
        show({ appleId: 2, title: 'Antelope Daily', feedUrl: 'https://example.com/b.xml' }),
        show({ appleId: 3, title: 'Mongoose Monthly', feedUrl: null }),
      ],
      {
        'https://example.com/a.xml': report({
          feedUrl: 'https://example.com/a.xml',
          health: 'dead',
          language: 'en',
          cadence: { ...BASE_CADENCE, daysSinceLastEpisode: 400, medianGapDays: 30 },
        }),
        'https://example.com/b.xml': report({
          feedUrl: 'https://example.com/b.xml',
          health: 'active',
          language: 'fr',
          cadence: { ...BASE_CADENCE, daysSinceLastEpisode: 1, medianGapDays: 1 },
        }),
      },
      NOW
    );
  }

  it('sorts by title', () => {
    const sorted = sortPodcastTableRows(threeRows(), 'show', 'ascending');

    expect(sorted.map((row) => row.show.title)).toEqual([
      'Antelope Daily',
      'Mongoose Monthly',
      'Zebra Weekly',
    ]);
  });

  it('sorts the best verdict first', () => {
    const sorted = sortPodcastTableRows(threeRows(), 'verdict', 'ascending');

    expect(sorted.map((row) => row.show.appleId)).toEqual([2, 1, 3]);
  });

  it('sorts the newest episode first in the default direction', () => {
    const sorted = sortPodcastTableRows(threeRows(), 'last', 'ascending');

    expect(sorted.map((row) => row.show.appleId)).toEqual([2, 3, 1]);
  });

  it('keeps rows with nothing to compare last in either direction', () => {
    const ascending = sortPodcastTableRows(threeRows(), 'gap', 'ascending');
    const descending = sortPodcastTableRows(threeRows(), 'gap', 'descending');

    expect(ascending[ascending.length - 1]?.show.appleId).toBe(3);
    expect(descending[descending.length - 1]?.show.appleId).toBe(3);
  });

  it('sorts by the language a feed declares, with the unknowns last', () => {
    const sorted = sortPodcastTableRows(threeRows(), 'language', 'ascending');

    expect(sorted.map((row) => row.show.appleId)).toEqual([1, 2, 3]);
  });

  it('sorts by the year of releases, with the unmeasured last', () => {
    const sorted = sortPodcastTableRows(threeRows(), 'releases', 'descending');

    expect(sorted[sorted.length - 1]?.show.appleId).toBe(3);
  });

  it('never mutates the caller’s rows', () => {
    const rows = threeRows();
    sortPodcastTableRows(rows, 'show', 'descending');

    expect(rows.map((row) => row.show.appleId)).toEqual([1, 2, 3]);
  });
});
