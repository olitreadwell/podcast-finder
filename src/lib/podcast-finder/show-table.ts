// The results grid: one row per show, one cell per thing a listener asks about,
// and a sort for every measured column.
//
// A card list reads well one show at a time, but comparing twenty shows means
// comparing numbers, and numbers want columns. This module turns a result set
// into rows that carry both the text to render and the number to sort by, so
// the page can sort by clicking a column header without re-measuring anything.

import {
  formatDaysSinceLastEpisode,
  formatEpisodeDuration,
  formatGapDays,
} from './episode-cadence';
import { describePodcastSource } from './directory-mix';
import type { PodcastFeedReport, SerialisedCadenceSummary } from './feed-report';
import type { PodcastShow } from './itunes-search';
import { describePodcastShowTags, rankShowHealth, type PodcastShowTag } from './show-tags';

/** Columns the results table can be sorted by. */
export type PodcastSortColumn =
  'show' | 'verdict' | 'last' | 'gap' | 'episodes' | 'length' | 'language' | 'releases';

/** Which way a column runs. */
export type PodcastSortDirection = 'ascending' | 'descending';

/** The column the table starts sorted by: the newest episode first. */
export const DEFAULT_PODCAST_SORT_COLUMN: PodcastSortColumn = 'last';

/** The direction the table starts sorted in. */
export const DEFAULT_PODCAST_SORT_DIRECTION: PodcastSortDirection = 'ascending';

/** One measured cell: the text a reader sees and the value the sort uses. */
export interface TableCell {
  /** Written for a reader, e.g. "every 7 days", or "en". */
  text: string;
  /** Number or word to sort by, or null when nothing measured this cell. */
  value: number | string | null;
}

/** One row of the results table, ready to render. */
export interface PodcastTableRow {
  /** The show as its directory described it. */
  show: PodcastShow;
  /** The feed report behind every measured cell, or null when none arrived. */
  report: PodcastFeedReport | null;
  /** Verdict and exception badges, empty until a feed has answered. */
  tags: PodcastShowTag[];
  /** Age of the newest episode: measured from the feed, else the directory's date. */
  lastEpisode: TableCell;
  /** Median gap between episodes; only a feed can measure this. */
  gap: TableCell;
  /** Episode count, named with whose count it is. */
  episodes: TableCell;
  /** Median episode length; only a feed can measure this. */
  length: TableCell;
  /** Language the feed declares; only a feed can say this. */
  language: TableCell;
  /** Releases across the year of bars, so the shape has a number to sort on. */
  releasesLastYear: number | null;
  /** A year of monthly release counts, or null when nothing measured them. */
  monthlyReleaseCounts: readonly number[] | null;
  /** The promise a feed's dates contradict, or null when the claim holds. */
  claimMismatchSentence: string | null;
}

/** Whole days between a date and now, or null. */
function daysBetween(date: Date | null, now: Date): number | null {
  if (date === null) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

/**
 * The episodes cell.
 *
 * A feed counts its own dated episodes, which is the honest number, so that is
 * used once it has answered. Before then a directory's catalogue count is all
 * there is, and the cell says whose count it is rather than passing it off as
 * the feed's.
 */
function readEpisodesCell(show: PodcastShow, cadence: SerialisedCadenceSummary | null): TableCell {
  if (cadence !== null) {
    return { text: `${cadence.datedEpisodeCount} in feed`, value: cadence.datedEpisodeCount };
  }
  if (show.episodeCount === null) return { text: 'not known', value: null };
  return {
    text: `${show.episodeCount} per ${describePodcastSource(show.source)}`,
    value: show.episodeCount,
  };
}

/** Build one render-ready row per show, reading each feed report once. */
export function buildPodcastTableRows(
  shows: readonly PodcastShow[],
  reportByFeedUrl: Readonly<Record<string, PodcastFeedReport>>,
  now: Date = new Date()
): PodcastTableRow[] {
  return shows.map((show) => {
    const report = show.feedUrl === null ? null : (reportByFeedUrl[show.feedUrl] ?? null);
    const cadence = report?.cadence ?? null;
    const appleDays = daysBetween(show.latestReleaseAt, now);

    return {
      show,
      report,
      tags:
        cadence === null
          ? []
          : describePodcastShowTags({
              health: report?.health ?? 'unknown',
              medianGapDays: cadence.medianGapDays,
              gapSpreadDays: cadence.gapSpreadDays,
              datedEpisodeCount: cadence.datedEpisodeCount,
              claimMismatch: report?.claimMismatch ?? null,
            }),
      lastEpisode:
        cadence === null
          ? { text: formatDaysSinceLastEpisode(appleDays), value: appleDays }
          : {
              text: formatDaysSinceLastEpisode(cadence.daysSinceLastEpisode),
              value: cadence.daysSinceLastEpisode,
            },
      gap:
        cadence === null
          ? { text: 'not measured', value: null }
          : { text: formatGapDays(cadence.medianGapDays), value: cadence.medianGapDays },
      episodes: readEpisodesCell(show, cadence),
      length:
        cadence === null
          ? { text: 'not measured', value: null }
          : {
              text: formatEpisodeDuration(cadence.medianDurationSeconds),
              value: cadence.medianDurationSeconds,
            },
      language:
        report?.language == null
          ? { text: 'not known', value: null }
          : { text: report.language, value: report.language },
      releasesLastYear:
        cadence === null
          ? null
          : cadence.monthlyReleaseCounts.reduce((total, count) => total + count, 0),
      monthlyReleaseCounts: cadence?.monthlyReleaseCounts ?? null,
      claimMismatchSentence: report?.claimMismatch?.sentence ?? null,
    };
  });
}

/** The value one column sorts on, or null when the row has nothing to compare. */
function readSortValue(row: PodcastTableRow, column: PodcastSortColumn): string | number | null {
  switch (column) {
    case 'show':
      return row.show.title.toLowerCase();
    case 'verdict':
      return rankShowHealth(row.report?.health ?? null);
    case 'last':
      return row.lastEpisode.value;
    case 'gap':
      return row.gap.value;
    case 'episodes':
      return row.episodes.value;
    case 'length':
      return row.length.value;
    case 'language':
      return row.language.value;
    case 'releases':
      return row.releasesLastYear;
  }
}

/**
 * Sort the rows by one column.
 *
 * A row with nothing to compare sorts last either way, so flipping the
 * direction never floats the shows whose feeds have not answered to the top of
 * a list sorted by a number they do not have yet.
 */
export function sortPodcastTableRows(
  rows: readonly PodcastTableRow[],
  column: PodcastSortColumn,
  direction: PodcastSortDirection
): PodcastTableRow[] {
  const sign = direction === 'ascending' ? 1 : -1;

  return [...rows].sort((left, right) => {
    const first = readSortValue(left, column);
    const second = readSortValue(right, column);
    if (first === null && second === null) return 0;
    if (first === null) return 1;
    if (second === null) return -1;
    if (typeof first === 'string' || typeof second === 'string') {
      return String(first).localeCompare(String(second)) * sign;
    }
    if (first === second) return 0;
    return (first < second ? -1 : 1) * sign;
  });
}
