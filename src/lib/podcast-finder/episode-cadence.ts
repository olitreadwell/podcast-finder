// Turns a show's episode dates and lengths into the numbers the page shows:
// how often it really publishes, how long since the last episode, and whether
// that silence means the show is finished.
//
// This module exists because podcast apps report the schedule a publisher
// claimed ("new episodes monthly") rather than the one the feed proves. A
// show can advertise monthly cadence and have published nothing in four
// years; the gaps between real publication dates are the only honest signal.

const MILLISECONDS_PER_DAY = 86_400_000;

/** How many months of release history `monthlyReleaseCounts` covers. */
export const CADENCE_TREND_MONTHS = 12;

/** One episode, reduced to the two facts cadence maths needs. */
export interface EpisodeSample {
  /** When the episode was published. Invalid dates are dropped. */
  publishedAt: Date;
  /** Episode length in seconds, or null when the feed omits it. */
  durationSeconds: number | null;
}

/**
 * Where a show sits between "publishing on schedule" and "finished", judged
 * against its own publishing rhythm rather than a fixed deadline.
 */
export type ShowHealth = 'active' | 'slowing' | 'dormant' | 'dead' | 'unknown';

/** Everything the page needs to describe how a show publishes. */
export interface CadenceSummary {
  /** Episodes with a usable publication date. */
  datedEpisodeCount: number;
  /** Publication date of the newest episode, or null when none parsed. */
  lastEpisodeAt: Date | null;
  /** Whole days since the newest episode, or null when none parsed. */
  daysSinceLastEpisode: number | null;
  /** Typical gap between episodes in days, or null with fewer than two. */
  medianGapDays: number | null;
  /** Typical distance from that median gap, in days. Low means regular. */
  gapSpreadDays: number | null;
  /** Episodes published in the last 30, 90 and 365 days. */
  episodesInLast30Days: number;
  episodesInLast90Days: number;
  episodesInLast365Days: number;
  /** Typical episode length in seconds, or null when no feed had one. */
  medianDurationSeconds: number | null;
  /** Release counts for the last `CADENCE_TREND_MONTHS` months, oldest first. */
  monthlyReleaseCounts: number[];
}

/** Middle value of a list, or null when the list is empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  if (lower === undefined) return null;
  return (lower + upper) / 2;
}

/** Count the samples published within `days` of `now`. */
function countPublishedWithin(samples: readonly EpisodeSample[], now: Date, days: number): number {
  const cutoff = now.getTime() - days * MILLISECONDS_PER_DAY;
  return samples.filter((sample) => sample.publishedAt.getTime() >= cutoff).length;
}

/** How many calendar months back `date` sits from `now`, counting the current one as 0. */
function monthsBetween(date: Date, now: Date): number {
  return (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
}

/** Release counts per calendar month, oldest first, for the trend bar chart. */
function countReleasesPerMonth(samples: readonly EpisodeSample[], now: Date): number[] {
  const counts = new Array<number>(CADENCE_TREND_MONTHS).fill(0);
  for (const sample of samples) {
    const monthsAgo = monthsBetween(sample.publishedAt, now);
    if (monthsAgo >= 0 && monthsAgo < CADENCE_TREND_MONTHS) {
      const bucket = CADENCE_TREND_MONTHS - 1 - monthsAgo;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Summarise how a show publishes from its episodes. Samples with invalid dates
 * are ignored rather than throwing, so one junk `<pubDate>` in a feed cannot
 * take down the whole result.
 */
export function summariseEpisodeCadence(
  samples: readonly EpisodeSample[],
  now: Date = new Date()
): CadenceSummary {
  const dated = samples
    .filter((sample) => Number.isFinite(sample.publishedAt.getTime()))
    .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime());

  const durations = dated
    .map((sample) => sample.durationSeconds)
    .filter((value): value is number => typeof value === 'number' && value > 0);

  const gaps: number[] = [];
  for (let index = 1; index < dated.length; index += 1) {
    const previous = dated[index - 1];
    const current = dated[index];
    if (previous === undefined || current === undefined) continue;
    const gap =
      (previous.publishedAt.getTime() - current.publishedAt.getTime()) / MILLISECONDS_PER_DAY;
    if (gap > 0) gaps.push(gap);
  }

  const medianGapDays = median(gaps);
  const lastEpisodeAt = dated[0]?.publishedAt ?? null;
  const daysSinceLastEpisode =
    lastEpisodeAt === null
      ? null
      : Math.max(0, Math.floor((now.getTime() - lastEpisodeAt.getTime()) / MILLISECONDS_PER_DAY));

  return {
    datedEpisodeCount: dated.length,
    lastEpisodeAt,
    daysSinceLastEpisode,
    medianGapDays,
    gapSpreadDays:
      medianGapDays === null ? null : median(gaps.map((gap) => Math.abs(gap - medianGapDays))),
    episodesInLast30Days: countPublishedWithin(dated, now, 30),
    episodesInLast90Days: countPublishedWithin(dated, now, 90),
    episodesInLast365Days: countPublishedWithin(dated, now, 365),
    medianDurationSeconds: median(durations),
    monthlyReleaseCounts: countReleasesPerMonth(dated, now),
  };
}

/**
 * Judge whether a show is still publishing from its own rhythm: a monthly show
 * five weeks late is slowing, a daily show five weeks late is finished. Shows
 * with a single episode fall back to fixed windows because there is no rhythm
 * to measure yet.
 */
export function classifyShowHealth(summary: CadenceSummary): ShowHealth {
  const days = summary.daysSinceLastEpisode;
  if (days === null) return 'unknown';

  if (summary.medianGapDays === null) {
    if (days <= 45) return 'active';
    if (days <= 180) return 'slowing';
    if (days <= 365) return 'dormant';
    return 'dead';
  }

  const gap = summary.medianGapDays;
  if (days <= Math.max(1.5 * gap, 14)) return 'active';
  if (days <= Math.max(2.5 * gap, 30)) return 'slowing';
  if (days <= Math.max(6 * gap, 180)) return 'dormant';
  return 'dead';
}

/** Badge wording and colour tone for a health verdict. */
export interface ShowHealthDescription {
  /** Short badge label, e.g. "Dormant". */
  label: string;
  /** Sentence explaining the verdict in plain terms. */
  explanation: string;
  /** Which colour family the badge uses. */
  tone: 'live' | 'warning' | 'stale' | 'gone' | 'unknown';
}

/** Describe a health verdict for a badge and a screen-reader sentence. */
export function describeShowHealth(health: ShowHealth): ShowHealthDescription {
  switch (health) {
    case 'active':
      return { label: 'Active', explanation: 'Publishing on its usual rhythm.', tone: 'live' };
    case 'slowing':
      return {
        label: 'Slowing',
        explanation: 'Later than usual, but recent enough to still be alive.',
        tone: 'warning',
      };
    case 'dormant':
      return {
        label: 'Dormant',
        explanation: 'Overdue by a wide margin. Could come back, probably will not.',
        tone: 'stale',
      };
    case 'dead':
      return {
        label: 'Dead',
        explanation: 'No episode for far longer than its own schedule allows.',
        tone: 'gone',
      };
    case 'unknown':
      return {
        label: 'Unknown',
        explanation: 'No usable episode dates in the feed.',
        tone: 'unknown',
      };
  }
}

/** Name the publishing rhythm behind a median gap, for a one-word badge. */
export function formatCadenceLabel(medianGapDays: number | null): string {
  if (medianGapDays === null) return 'no pattern yet';
  if (medianGapDays <= 2) return 'daily';
  if (medianGapDays <= 10) return 'weekly';
  if (medianGapDays <= 18) return 'fortnightly';
  if (medianGapDays <= 45) return 'monthly';
  if (medianGapDays <= 120) return 'quarterly';
  return 'rarely';
}

/** Write a median gap as a readable interval, e.g. "every 7 days". */
export function formatGapDays(medianGapDays: number | null): string {
  if (medianGapDays === null) return 'unknown gap';
  if (medianGapDays < 1) return 'more than once a day';
  return `every ${Math.round(medianGapDays)} days`;
}

/** Write a gap since the last episode as a readable age, e.g. "3 years ago". */
export function formatDaysSinceLastEpisode(daysSinceLastEpisode: number | null): string {
  if (daysSinceLastEpisode === null) return 'no dated episodes';
  if (daysSinceLastEpisode <= 0) return 'today';
  if (daysSinceLastEpisode === 1) return 'yesterday';
  if (daysSinceLastEpisode < 14) return `${daysSinceLastEpisode} days ago`;
  if (daysSinceLastEpisode < 60) return `${Math.round(daysSinceLastEpisode / 7)} weeks ago`;
  if (daysSinceLastEpisode < 730) return `${Math.round(daysSinceLastEpisode / 30.44)} months ago`;
  return `${(daysSinceLastEpisode / 365.25).toFixed(1)} years ago`;
}

/** Write an episode length as minutes or hours, e.g. "48 min" or "1 h 12 min". */
export function formatEpisodeDuration(durationSeconds: number | null): string {
  if (durationSeconds === null || durationSeconds <= 0) return 'length unknown';
  const minutes = Math.round(durationSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}
