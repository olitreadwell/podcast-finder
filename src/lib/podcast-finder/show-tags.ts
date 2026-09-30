// Turns the raw cadence numbers into the short labels the results list shows,
// including the one this app exists for: telling a listener that a show is
// finished even though its page still promises new episodes.
//
// Health is never the whole story on its own. A show can be publishing on
// schedule and still be a bad recommendation (four episodes, wildly uneven
// gaps), so the tags carry the exceptions next to the verdict.

import {
  describeShowHealth,
  formatDaysSinceLastEpisode,
  formatEpisodeDuration,
  formatGapDays,
  type ShowHealth,
} from './episode-cadence';
import type { CadenceMismatch } from './cadence-claim';
import type { PodcastFeedReport } from './feed-report';
import type { PodcastShow } from './itunes-search';

/** Colour tone a tag badge uses, matching the health badge palette. */
export type ShowTagTone = 'live' | 'warning' | 'stale' | 'gone' | 'unknown';

/** One short label shown on a result card. */
export interface PodcastShowTag {
  /** Stable id, used as the React key and in tests. */
  id: string;
  /** Short wording for the badge. */
  label: string;
  /** Which colour family the badge uses. */
  tone: ShowTagTone;
}

/** A spread wider than this share of the typical gap counts as irregular. */
const IRREGULAR_SPREAD_RATIO = 0.6;

/** Episodes below this count means there is barely a pattern to trust. */
const THIN_CATALOGUE_EPISODES = 3;

/** What the tags are computed from. */
export interface ShowTagInput {
  /** Verdict from `classifyShowHealth`. */
  health: ShowHealth;
  /** Typical gap between episodes in days, or null with fewer than two. */
  medianGapDays: number | null;
  /** Typical distance from that median gap, in days. */
  gapSpreadDays: number | null;
  /** Episodes with a usable publication date. */
  datedEpisodeCount: number;
  /** Mismatch from `describeCadenceMismatch`, or null when the claim holds. */
  claimMismatch: CadenceMismatch | null;
}

/**
 * Describe a show in tags: its verdict first, then any reason to distrust that
 * verdict. Order matters — the list is rendered left to right and read aloud in
 * the same order.
 */
export function describePodcastShowTags(input: ShowTagInput): PodcastShowTag[] {
  const verdict = describeShowHealth(input.health);
  const tags: PodcastShowTag[] = [
    { id: `health-${input.health}`, label: verdict.label, tone: verdict.tone },
  ];

  if (input.claimMismatch !== null) {
    tags.push({
      id: 'claim-mismatch',
      label:
        input.claimMismatch.direction === 'slower'
          ? 'Schedule promise broken'
          : 'Publishes more often than promised',
      tone: 'warning',
    });
  }

  const { medianGapDays, gapSpreadDays, datedEpisodeCount } = input;
  if (
    medianGapDays !== null &&
    gapSpreadDays !== null &&
    datedEpisodeCount >= 4 &&
    gapSpreadDays / medianGapDays > IRREGULAR_SPREAD_RATIO
  ) {
    tags.push({ id: 'irregular', label: 'Irregular', tone: 'warning' });
  }

  if (datedEpisodeCount > 0 && datedEpisodeCount <= THIN_CATALOGUE_EPISODES) {
    tags.push({ id: 'thin-catalogue', label: 'Few episodes', tone: 'unknown' });
  }

  return tags;
}

/** Order the results list can be sorted in. */
export type PodcastSortOrder = 'relevance' | 'newest' | 'health';

/** How the sort options are labelled in the page. */
export const PODCAST_SORT_OPTIONS: ReadonlyArray<{ value: PodcastSortOrder; label: string }> = [
  { value: 'newest', label: 'Newest episode' },
  { value: 'health', label: 'Best condition' },
  { value: 'relevance', label: 'Apple relevance' },
];

/** Rank a verdict so "active" sorts ahead of "dead". */
export function rankShowHealth(health: ShowHealth | null): number {
  switch (health) {
    case 'active':
      return 0;
    case 'slowing':
      return 1;
    case 'dormant':
      return 2;
    case 'unknown':
      return 3;
    case 'dead':
      return 4;
    case null:
      return 5;
  }
}

/**
 * Sort shows for the results list. Health and newest both fall back to Apple's
 * order for shows whose feeds have not answered yet, so the list never looks
 * shuffled while statuses are still arriving.
 */
export function sortPodcastShows(
  shows: readonly PodcastShow[],
  healthByAppleId: ReadonlyMap<string, ShowHealth>,
  order: PodcastSortOrder
): PodcastShow[] {
  const sorted = [...shows];
  if (order === 'relevance') return sorted;

  if (order === 'health') {
    return sorted.sort((left, right) => {
      const byHealth =
        rankShowHealth(healthByAppleId.get(String(left.appleId)) ?? null) -
        rankShowHealth(healthByAppleId.get(String(right.appleId)) ?? null);
      if (byHealth !== 0) return byHealth;
      return (right.latestReleaseAt?.getTime() ?? 0) - (left.latestReleaseAt?.getTime() ?? 0);
    });
  }

  return sorted.sort(
    (left, right) =>
      (right.latestReleaseAt?.getTime() ?? 0) - (left.latestReleaseAt?.getTime() ?? 0)
  );
}

/** One labelled fact on a result card. */
export interface ShowFact {
  /** Short label, e.g. "Usual gap". */
  label: string;
  /** The value, already written for a reader, e.g. "every 7 days". */
  value: string;
}

/** Whole days between a date and now, or null. */
function daysBetween(date: Date | null, now: Date): number | null {
  if (date === null) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/**
 * The facts a result card shows. Before a feed has answered, the card falls
 * back to Apple's own numbers and says so, rather than showing an empty gap
 * that reads like "this show has no episodes".
 */
export function describePodcastShowFacts(
  show: PodcastShow,
  report: PodcastFeedReport | null,
  now: Date = new Date()
): ShowFact[] {
  if (report?.cadence != null) {
    return [
      {
        label: 'Last episode',
        value: formatDaysSinceLastEpisode(report.cadence.daysSinceLastEpisode),
      },
      { label: 'Usual gap', value: formatGapDays(report.cadence.medianGapDays) },
      {
        label: 'Typical length',
        value: formatEpisodeDuration(report.cadence.medianDurationSeconds),
      },
      { label: 'Episodes this year', value: String(report.cadence.episodesInLast365Days) },
    ];
  }

  const facts: ShowFact[] = [
    {
      label: 'Last episode',
      value: formatDaysSinceLastEpisode(daysBetween(show.latestReleaseAt, now)),
    },
  ];
  if (show.episodeCount !== null) {
    facts.push({ label: 'Episodes', value: `${show.episodeCount} per Apple` });
  }
  return facts;
}
