import { describe, expect, it } from 'vitest';

import type { CadenceMismatch } from './cadence-claim';
import type { CadenceSummary } from './episode-cadence';
import type { PodcastShow } from './itunes-search';
import {
  describePodcastShowFacts,
  describePodcastShowTags,
  rankShowHealth,
  sortPodcastShows,
  type PodcastShowTag,
} from './show-tags';

/** The tag inputs, with only the fields a test cares about changed. */
function summary(overrides: Partial<CadenceSummary> = {}): Omit<CadenceSummary, 'lastEpisodeAt'> {
  return {
    datedEpisodeCount: 30,
    daysSinceLastEpisode: 3,
    medianGapDays: 7,
    gapSpreadDays: 1,
    episodesInLast30Days: 4,
    episodesInLast90Days: 13,
    episodesInLast365Days: 52,
    medianDurationSeconds: 2400,
    monthlyReleaseCounts: new Array(12).fill(4),
    ...overrides,
  };
}

/** Build the tag input from a cadence summary. */
function tagInput(
  health: Parameters<typeof describePodcastShowTags>[0]['health'],
  cadence: ReturnType<typeof summary> = summary(),
  claimMismatch: CadenceMismatch | null = null
): Parameters<typeof describePodcastShowTags>[0] {
  return {
    health,
    medianGapDays: cadence.medianGapDays,
    gapSpreadDays: cadence.gapSpreadDays,
    datedEpisodeCount: cadence.datedEpisodeCount,
    claimMismatch,
  };
}

/** A show for the sort tests. */
function show(overrides: Partial<PodcastShow> = {}): PodcastShow {
  const appleId = typeof overrides.appleId === 'number' ? overrides.appleId : 1;
  return {
    appleId,
    source: 'apple',
    sourceKey: `apple:${appleId}`,
    title: 'Weekly Wipe',
    publisher: 'Drain Media',
    artistId: null,
    feedUrl: 'https://example.com/feed.xml',
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

/** Tag ids, for terse assertions. */
function tagIds(tags: PodcastShowTag[]): string[] {
  return tags.map((tag) => tag.id);
}

describe('describePodcastShowTags', () => {
  it('words the mismatch tag for a show that sped up rather than slowed down', () => {
    const tags = describePodcastShowTags(
      tagInput('active', summary(), {
        direction: 'faster',
        sentence: 'Says weekly, actually more often',
      })
    );

    expect(tags[1]?.label).toBe('Publishes more often than promised');
  });

  it('leads with the verdict', () => {
    expect(tagIds(describePodcastShowTags(tagInput('dead')))).toEqual(['health-dead']);
  });

  it('flags a broken schedule promise', () => {
    const tags = describePodcastShowTags(
      tagInput('dormant', summary(), {
        direction: 'slower',
        sentence: 'Says weekly, actually every ~120 days',
      })
    );

    expect(tagIds(tags)).toEqual(['health-dormant', 'claim-mismatch']);
    expect(tags[1]?.label).toBe('Schedule promise broken');
    expect(tags[1]?.tone).toBe('warning');
  });

  it('flags an uneven release pattern', () => {
    const tags = describePodcastShowTags(tagInput('active', summary({ gapSpreadDays: 9 })));

    expect(tagIds(tags)).toContain('irregular');
  });

  it('does not flag irregularity on a thin sample', () => {
    const tags = describePodcastShowTags(
      tagInput('active', summary({ datedEpisodeCount: 2, gapSpreadDays: 9 }))
    );

    expect(tagIds(tags)).not.toContain('irregular');
  });

  it('flags a show with barely any episodes', () => {
    const tags = describePodcastShowTags(tagInput('slowing', summary({ datedEpisodeCount: 2 })));

    expect(tagIds(tags)).toContain('thin-catalogue');
  });

  it('adds nothing to a healthy, regular, honest show', () => {
    expect(tagIds(describePodcastShowTags(tagInput('active')))).toEqual(['health-active']);
  });
});

describe('rankShowHealth', () => {
  it('sorts the living ahead of the finished', () => {
    expect(rankShowHealth('active')).toBeLessThan(rankShowHealth('slowing'));
    expect(rankShowHealth('slowing')).toBeLessThan(rankShowHealth('dormant'));
    expect(rankShowHealth('dormant')).toBeLessThan(rankShowHealth('dead'));
    expect(rankShowHealth(null)).toBeGreaterThan(rankShowHealth('dead'));
  });
});

describe('sortPodcastShows', () => {
  const old = show({ appleId: 1, latestReleaseAt: new Date('2025-01-01T00:00:00.000Z') });
  const fresh = show({ appleId: 2, latestReleaseAt: new Date('2025-12-22T00:00:00.000Z') });
  const middling = show({ appleId: 3, latestReleaseAt: new Date('2025-06-01T00:00:00.000Z') });

  it('keeps Apple order for relevance', () => {
    expect(
      sortPodcastShows([old, fresh, middling], new Map(), 'relevance').map((entry) => entry.appleId)
    ).toEqual([1, 2, 3]);
  });

  it('puts the newest episode first', () => {
    expect(
      sortPodcastShows([old, fresh, middling], new Map(), 'newest').map((entry) => entry.appleId)
    ).toEqual([2, 3, 1]);
  });

  it('puts shows in the best condition first', () => {
    const health = new Map([
      ['apple:1', 'dead' as const],
      ['apple:2', 'slowing' as const],
      ['apple:3', 'active' as const],
    ]);

    expect(
      sortPodcastShows([old, fresh, middling], health, 'health').map((entry) => entry.appleId)
    ).toEqual([3, 2, 1]);
  });

  it('falls back to recency while statuses are still arriving', () => {
    expect(
      sortPodcastShows([old, fresh, middling], new Map(), 'health').map((entry) => entry.appleId)
    ).toEqual([2, 3, 1]);
  });

  it('never mutates the caller’s array', () => {
    const shows = [old, fresh];
    sortPodcastShows(shows, new Map(), 'newest');

    expect(shows.map((entry) => entry.appleId)).toEqual([1, 2]);
  });
});

describe('describePodcastShowFacts', () => {
  it('uses the feed’s measured numbers once it has them', () => {
    const facts = describePodcastShowFacts(show(), {
      feedUrl: 'https://example.com/feed.xml',
      ok: true,
      reason: null,
      feedTitle: 'Weekly Wipe',
      description: null,
      latestEpisodeTitle: 'Episode 3',
      health: 'active',
      claim: null,
      claimMismatch: null,
      cadence: {
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
      },
    });

    expect(facts).toEqual([
      { label: 'Last episode', value: '3 days ago' },
      { label: 'Usual gap', value: 'every 7 days' },
      { label: 'Typical length', value: '48 min' },
      { label: 'Episodes this year', value: '52' },
    ]);
  });

  it('falls back to Apple’s numbers and says whose they are', () => {
    const facts = describePodcastShowFacts(show(), null, new Date('2025-12-25T09:00:00.000Z'));

    expect(facts).toEqual([
      { label: 'Last episode', value: '3 days ago' },
      { label: 'Episodes', value: '10 per Apple' },
    ]);
  });

  it('answers an unknown age when Apple gave no date', () => {
    const facts = describePodcastShowFacts(
      show({ latestReleaseAt: null, episodeCount: null }),
      null
    );

    expect(facts).toEqual([{ label: 'Last episode', value: 'no dated episodes' }]);
  });
});
