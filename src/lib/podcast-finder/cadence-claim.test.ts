import { describe, expect, it } from 'vitest';

import {
  describeCadenceMismatch,
  readClaimedCadence,
  readFeedCadenceClaim,
  type CadenceClaim,
} from './cadence-claim';

/** A claim to compare against a measured gap. */
function claim(label: string, expectedGapDays: number): CadenceClaim {
  return { label, expectedGapDays, phrase: label };
}

describe('readClaimedCadence', () => {
  it('reads a weekday promise', () => {
    expect(readClaimedCadence('New episodes every Monday.')?.label).toBe('weekly');
  });

  it('reads explicit cadence words', () => {
    expect(readClaimedCadence('A weekly show about bins.')?.label).toBe('weekly');
    expect(readClaimedCadence('Published monthly.')?.label).toBe('monthly');
    expect(readClaimedCadence('New episode daily.')?.label).toBe('daily');
    expect(readClaimedCadence('Fortnightly deep dives.')?.label).toBe('fortnightly');
  });

  it('prefers the leftmost claim so a drifting show reads honestly', () => {
    const text = 'Originally a weekly show, now released monthly.';
    expect(readClaimedCadence(text)?.label).toBe('weekly');
  });

  it('reads the longer phrase when both start at the same place', () => {
    expect(readClaimedCadence('Every four weeks we talk about drains.')?.label).toBe('monthly');
  });

  it('answers null for a blurb that promises nothing', () => {
    expect(readClaimedCadence('Conversations about municipal plumbing.')).toBeNull();
    expect(readClaimedCadence('')).toBeNull();
    expect(readClaimedCadence(null)).toBeNull();
  });
});

describe('describeCadenceMismatch', () => {
  it('reports a show that says weekly and publishes monthly, and which way it drifted', () => {
    expect(describeCadenceMismatch(claim('weekly', 7), 43)).toEqual({
      direction: 'slower',
      sentence: 'Says weekly, actually every ~43 days',
    });
  });

  it('reports a show that publishes far more often than it claims', () => {
    expect(describeCadenceMismatch(claim('monthly', 30), 6)).toEqual({
      direction: 'faster',
      sentence: 'Says monthly, actually more often (every ~6 days)',
    });
  });

  it('stays quiet when the claim broadly holds', () => {
    expect(describeCadenceMismatch(claim('weekly', 7), 9)).toBeNull();
    expect(describeCadenceMismatch(claim('monthly', 30), 34)).toBeNull();
  });

  it('stays quiet without a claim or without a measured gap', () => {
    expect(describeCadenceMismatch(null, 40)).toBeNull();
    expect(describeCadenceMismatch(claim('weekly', 7), null)).toBeNull();
  });
});

describe('readFeedCadenceClaim', () => {
  it('reads the description before the title', () => {
    const feed = {
      title: 'Daily Drip',
      description: 'A monthly look at roofing.',
      author: null,
    };

    expect(readFeedCadenceClaim(feed)?.label).toBe('monthly');
  });

  it('falls back to the title and the author', () => {
    expect(
      readFeedCadenceClaim({ title: 'Weekly Wipe', description: null, author: null })?.label
    ).toBe('weekly');
    expect(
      readFeedCadenceClaim({ title: null, description: null, author: 'The Daily Bunker' })?.label
    ).toBe('daily');
  });

  it('answers null when the feed claims nothing', () => {
    expect(
      readFeedCadenceClaim({ title: 'Drains', description: 'Pipes.', author: null })
    ).toBeNull();
  });
});
