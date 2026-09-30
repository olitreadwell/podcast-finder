import { describe, expect, it } from 'vitest';

import {
  CADENCE_TREND_MONTHS,
  classifyShowHealth,
  describeShowHealth,
  formatCadenceLabel,
  formatDaysSinceLastEpisode,
  formatEpisodeDuration,
  formatGapDays,
  median,
  summariseEpisodeCadence,
  type CadenceSummary,
  type EpisodeSample,
} from './episode-cadence';

/** A fixed clock, so "days since" assertions do not move with the calendar. */
const NOW = new Date('2026-01-01T00:00:00.000Z');

/** One episode sample from an ISO date. */
function sample(publishedAt: string, durationSeconds: number | null = null): EpisodeSample {
  return { publishedAt: new Date(publishedAt), durationSeconds };
}

/** A cadence summary with only the fields a health test cares about set. */
function cadenceSummary(overrides: Partial<CadenceSummary> = {}): CadenceSummary {
  return {
    datedEpisodeCount: 12,
    lastEpisodeAt: NOW,
    daysSinceLastEpisode: 0,
    medianGapDays: 7,
    gapSpreadDays: 1,
    episodesInLast30Days: 4,
    episodesInLast90Days: 12,
    episodesInLast365Days: 50,
    medianDurationSeconds: 2400,
    monthlyReleaseCounts: new Array(CADENCE_TREND_MONTHS).fill(4),
    ...overrides,
  };
}

describe('median', () => {
  it('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });

  it('returns the middle value for an odd count', () => {
    expect(median([5, 1, 9])).toBe(5);
  });

  it('averages the two middles for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('summariseEpisodeCadence', () => {
  it('measures a weekly show from its gaps', () => {
    const summary = summariseEpisodeCadence(
      [
        sample('2025-12-25T00:00:00.000Z', 1800),
        sample('2025-12-18T00:00:00.000Z', 3600),
        sample('2025-12-11T00:00:00.000Z', 2400),
        sample('2025-12-04T00:00:00.000Z', 1800),
        sample('2025-11-27T00:00:00.000Z', 1800),
      ],
      NOW
    );

    expect(summary.medianGapDays).toBe(7);
    expect(summary.daysSinceLastEpisode).toBe(7);
    expect(summary.datedEpisodeCount).toBe(5);
    expect(summary.episodesInLast30Days).toBe(4);
    expect(summary.medianDurationSeconds).toBe(1800);
    expect(summary.gapSpreadDays).toBe(0);
  });

  it('ignores episodes with unparseable dates instead of throwing', () => {
    const summary = summariseEpisodeCadence(
      [
        { publishedAt: new Date('nonsense'), durationSeconds: 100 },
        sample('2025-12-25T00:00:00.000Z'),
      ],
      NOW
    );

    expect(summary.datedEpisodeCount).toBe(1);
    expect(summary.daysSinceLastEpisode).toBe(7);
    expect(summary.medianGapDays).toBeNull();
  });

  it('ignores non-positive durations when averaging lengths', () => {
    const summary = summariseEpisodeCadence(
      [
        sample('2025-12-25T00:00:00.000Z', 0),
        sample('2025-12-18T00:00:00.000Z', -5),
        sample('2025-12-11T00:00:00.000Z', 1200),
      ],
      NOW
    );

    expect(summary.medianDurationSeconds).toBe(1200);
  });

  it('counts releases per month across the trend window, oldest first', () => {
    const summary = summariseEpisodeCadence(
      [
        sample('2025-12-25T00:00:00.000Z'),
        sample('2025-12-05T00:00:00.000Z'),
        sample('2025-02-15T00:00:00.000Z'),
        sample('2019-05-05T00:00:00.000Z'),
      ],
      NOW
    );

    expect(summary.monthlyReleaseCounts).toHaveLength(CADENCE_TREND_MONTHS);
    expect(summary.monthlyReleaseCounts[CADENCE_TREND_MONTHS - 1 - 1]).toBe(2);
    expect(summary.monthlyReleaseCounts[0]).toBe(1);
    expect(summary.monthlyReleaseCounts.reduce((total, count) => total + count, 0)).toBe(3);
  });

  it('answers an empty summary rather than throwing on an empty feed', () => {
    const summary = summariseEpisodeCadence([], NOW);

    expect(summary.datedEpisodeCount).toBe(0);
    expect(summary.lastEpisodeAt).toBeNull();
    expect(summary.daysSinceLastEpisode).toBeNull();
    expect(summary.medianGapDays).toBeNull();
    expect(summary.medianDurationSeconds).toBeNull();
    expect(summary.monthlyReleaseCounts).toEqual(new Array(CADENCE_TREND_MONTHS).fill(0));
  });
});

describe('classifyShowHealth', () => {
  it('calls a weekly show active when it published this week', () => {
    expect(classifyShowHealth(cadenceSummary({ daysSinceLastEpisode: 6 }))).toBe('active');
  });

  it('calls it slowing when it missed a few weeks', () => {
    expect(classifyShowHealth(cadenceSummary({ daysSinceLastEpisode: 20 }))).toBe('slowing');
  });

  it('calls it dormant when it missed a couple of months', () => {
    expect(classifyShowHealth(cadenceSummary({ daysSinceLastEpisode: 70 }))).toBe('dormant');
  });

  it('calls it dead when it missed more than a year', () => {
    expect(classifyShowHealth(cadenceSummary({ daysSinceLastEpisode: 800 }))).toBe('dead');
  });

  it('gives a monthly show more room than a weekly one', () => {
    const monthly = cadenceSummary({ medianGapDays: 30, daysSinceLastEpisode: 40 });
    const weekly = cadenceSummary({ medianGapDays: 7, daysSinceLastEpisode: 40 });

    expect(classifyShowHealth(monthly)).toBe('active');
    expect(classifyShowHealth(weekly)).toBe('dormant');
  });

  it('falls back to fixed windows for a show with one episode', () => {
    const single = cadenceSummary({ medianGapDays: null, daysSinceLastEpisode: 100 });
    expect(classifyShowHealth(single)).toBe('slowing');
    expect(classifyShowHealth({ ...single, daysSinceLastEpisode: 300 })).toBe('dormant');
    expect(classifyShowHealth({ ...single, daysSinceLastEpisode: 900 })).toBe('dead');
  });

  it('answers unknown when the feed had no usable dates', () => {
    expect(classifyShowHealth(cadenceSummary({ daysSinceLastEpisode: null }))).toBe('unknown');
  });
});

describe('formatting', () => {
  it('names the rhythm behind a median gap', () => {
    expect(formatCadenceLabel(null)).toBe('no pattern yet');
    expect(formatCadenceLabel(1)).toBe('daily');
    expect(formatCadenceLabel(7)).toBe('weekly');
    expect(formatCadenceLabel(14)).toBe('fortnightly');
    expect(formatCadenceLabel(30)).toBe('monthly');
    expect(formatCadenceLabel(90)).toBe('quarterly');
    expect(formatCadenceLabel(400)).toBe('rarely');
  });

  it('writes a median gap as an interval', () => {
    expect(formatGapDays(null)).toBe('unknown gap');
    expect(formatGapDays(7.4)).toBe('every 7 days');
    expect(formatGapDays(0.5)).toBe('more than once a day');
  });

  it('writes the age of the newest episode', () => {
    expect(formatDaysSinceLastEpisode(null)).toBe('no dated episodes');
    expect(formatDaysSinceLastEpisode(0)).toBe('today');
    expect(formatDaysSinceLastEpisode(1)).toBe('yesterday');
    expect(formatDaysSinceLastEpisode(9)).toBe('9 days ago');
    expect(formatDaysSinceLastEpisode(28)).toBe('4 weeks ago');
    expect(formatDaysSinceLastEpisode(200)).toBe('7 months ago');
    expect(formatDaysSinceLastEpisode(1500)).toBe('4.1 years ago');
  });

  it('writes an episode length in minutes or hours', () => {
    expect(formatEpisodeDuration(null)).toBe('length unknown');
    expect(formatEpisodeDuration(0)).toBe('length unknown');
    expect(formatEpisodeDuration(2880)).toBe('48 min');
    expect(formatEpisodeDuration(3600)).toBe('1 h');
    expect(formatEpisodeDuration(4320)).toBe('1 h 12 min');
  });

  it('explains each verdict in a sentence', () => {
    expect(describeShowHealth('active').tone).toBe('live');
    expect(describeShowHealth('slowing').tone).toBe('warning');
    expect(describeShowHealth('dormant').tone).toBe('stale');
    expect(describeShowHealth('dead').tone).toBe('gone');
    expect(describeShowHealth('unknown').tone).toBe('unknown');
    expect(describeShowHealth('dead').label).toBe('Dead');
  });
});
