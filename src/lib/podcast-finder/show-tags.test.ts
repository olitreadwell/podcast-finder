import { describe, expect, it } from 'vitest';

import type { CadenceMismatch } from './cadence-claim';
import type { CadenceSummary } from './episode-cadence';
import { describePodcastShowTags, rankShowHealth, type PodcastShowTag } from './show-tags';

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
