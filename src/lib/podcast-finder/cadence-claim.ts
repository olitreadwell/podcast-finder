// Reads the schedule a show advertises in its own blurb and compares it with
// the schedule its episodes prove.
//
// Show notes say things like "new episodes every Monday" long after the last
// Monday episode. Apple and Spotify repeat that promise in the show page, so
// the claim is what a listener sees first and the gaps between publication
// dates are what actually happened. This module turns the promise into a
// number so the two can be compared.

/** A publishing promise found in a show's own words. */
export interface CadenceClaim {
  /** Plain wording for the promise, e.g. "weekly". */
  label: string;
  /** How many days apart the promise implies. */
  expectedGapDays: number;
  /** The exact phrase the claim came from, so the page can quote it. */
  phrase: string;
}

/** Claim patterns in the order they are tested, longest phrase first. */
const CADENCE_CLAIM_PATTERNS: ReadonlyArray<{
  label: string;
  expectedGapDays: number;
  pattern: RegExp;
}> = [
  { label: 'monthly', expectedGapDays: 30, pattern: /\bevery (four|4) weeks\b/ },
  {
    label: 'monthly',
    expectedGapDays: 30,
    pattern: /\b(monthly|every month|once a month|each month)\b/,
  },
  {
    label: 'quarterly',
    expectedGapDays: 91,
    pattern: /\b(quarterly|every (three|3) months|every quarter)\b/,
  },
  {
    label: 'every two months',
    expectedGapDays: 61,
    pattern: /\b(bimonthly|every (two|other) months)\b/,
  },
  { label: 'twice a week', expectedGapDays: 3.5, pattern: /\btwice (a|per) week\b/ },
  {
    label: 'fortnightly',
    expectedGapDays: 14,
    pattern: /\b(fortnightly|biweekly|bi-weekly|every (two|other) weeks?|every second week)\b/,
  },
  {
    label: 'weekly',
    expectedGapDays: 7,
    pattern:
      /\b(weekly|every week|each week|every (mon|tues|wednes|thurs|fri|satur|sun)day|new episodes? (mon|tues|wednes|thurs|fri|satur|sun)day)\b/,
  },
  {
    label: 'daily',
    expectedGapDays: 1,
    pattern: /\b(daily|every day|every weekday|each weekday|every morning)\b/,
  },
];

/**
 * Find the schedule a show claims in its own description. The leftmost match
 * wins, so "a weekly show, now monthly" is read as weekly and the mismatch
 * gets reported rather than silently inverted.
 */
export function readClaimedCadence(text: string | null): CadenceClaim | null {
  if (!text) return null;
  const haystack = text.toLowerCase();

  let best: (CadenceClaim & { index: number }) | null = null;
  for (const candidate of CADENCE_CLAIM_PATTERNS) {
    const match = candidate.pattern.exec(haystack);
    if (match === null) continue;
    if (best !== null && match.index >= best.index) continue;
    best = {
      index: match.index,
      label: candidate.label,
      expectedGapDays: candidate.expectedGapDays,
      phrase: match[0],
    };
  }

  if (best === null) return null;
  return { label: best.label, expectedGapDays: best.expectedGapDays, phrase: best.phrase };
}

/** Where the promise and the dates disagree. */
export type CadenceMismatchDirection = 'slower' | 'faster';

/** A promise the feed contradicts, and which way it leans. */
export interface CadenceMismatch {
  /** `slower` when the show publishes less often than it says. */
  direction: CadenceMismatchDirection;
  /** Sentence for the card, quoting the promise and the measured gap. */
  sentence: string;
}

/**
 * Compare a claimed schedule with the measured one, in days. Returns null when
 * the claim is missing, the measured gap is missing, or the two broadly agree.
 * The direction is kept separate from the sentence because the badge beside it
 * has to say "broken promise" for a show that slowed down and something else
 * for one that never slowed down at all.
 */
export function describeCadenceMismatch(
  claim: CadenceClaim | null,
  medianGapDays: number | null
): CadenceMismatch | null {
  if (claim === null || medianGapDays === null) return null;

  const measured = Math.round(medianGapDays);
  if (medianGapDays > Math.max(1.75 * claim.expectedGapDays, claim.expectedGapDays + 10)) {
    return {
      direction: 'slower',
      sentence: `Says ${claim.label}, actually every ~${measured} days`,
    };
  }
  if (medianGapDays < 0.5 * claim.expectedGapDays) {
    return {
      direction: 'faster',
      sentence: `Says ${claim.label}, actually more often (every ~${measured} days)`,
    };
  }
  return null;
}

/** Read a claim out of the feed fields a publisher writes it into. */
export function readFeedCadenceClaim(feed: {
  title: string | null;
  description: string | null;
  author: string | null;
}): CadenceClaim | null {
  return (
    readClaimedCadence(feed.description) ??
    readClaimedCadence(feed.title) ??
    readClaimedCadence(feed.author)
  );
}
