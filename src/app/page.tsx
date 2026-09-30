'use client';

// built on the iTunes Search API
// https://performance-partners.apple.com/search-api
//
// Podcast apps tell you what a show promises, not what it does. A page can say
// "new episodes monthly" for four years after the last one shipped, because
// that text is show notes, written once. This app searches every directory it
// knows in one request, then pulls each show's own RSS feed and measures the
// gaps between real publication dates. The table shows one row per show, and
// the verdict in it comes from the feed: publish rhythm, how long since the
// newest episode, and whether the promise in the show notes still matches the
// dates.

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  describeStatusProgress,
  fetchPodcastStatus,
  fetchPublisherShows,
  listResultFeedUrls,
  searchEveryPodcastDirectory,
} from '@/lib/podcast-finder/api-client';
import { describeDirectoryMix, type PodcastSourceCount } from '@/lib/podcast-finder/directory-mix';
import { MAX_FEEDS_PER_REQUEST, type PodcastFeedReport } from '@/lib/podcast-finder/feed-report';
import {
  PODCAST_COUNTRY_OPTIONS,
  PODCAST_GENRE_OPTIONS,
  type PodcastShow,
  type PodcastSource,
} from '@/lib/podcast-finder/itunes-search';
import {
  describePublisherSelection,
  filterShowsByPublisher,
  publisherKeyForShow,
  readPublisherArtistId,
} from '@/lib/podcast-finder/publisher-shows';
import {
  extractPodcastSearchTerm,
  matchesPodcastQuery,
  MAX_QUERY_LENGTH,
  parsePodcastQuery,
  QUERY_NUMBER_FIELDS,
  QUERY_TEXT_FIELDS,
  type PodcastQueryParseResult,
} from '@/lib/podcast-finder/search-query';
import {
  buildPodcastTableRows,
  DEFAULT_PODCAST_SORT_COLUMN,
  DEFAULT_PODCAST_SORT_DIRECTION,
  sortPodcastTableRows,
  type PodcastSortColumn,
  type PodcastSortDirection,
  type PodcastTableRow,
  type TableCell,
} from '@/lib/podcast-finder/show-table';
import type { ShowTagTone } from '@/lib/podcast-finder/show-tags';

/** How long the search box waits after typing before it searches. */
const SEARCH_DEBOUNCE_MS = 400;

/** Where the page remembers the filters between visits. */
const FILTERS_STORAGE_KEY = 'podcast-finder.filters';

/** Shown when a visitor has not typed anything yet. */
const EXAMPLE_SEARCHES = ['municipal water', 'type design', 'climate policy'];

/** Sentence for a row whose directory returned no feed URL, so no verdict is possible. */
function describeMissingFeed(source: PodcastSource): string {
  switch (source) {
    case 'apple':
      return 'Apple returned no feed URL for this one, so it cannot be checked.';
    case 'fyyd':
      return 'fyyd returned no feed URL for this one, so it cannot be checked.';
    case 'archive':
      return 'The Internet Archive serves these as items, not feeds, so this one cannot be checked.';
  }
}

/** Badge colours per tag tone, legible in dark mode. */
const TAG_CLASS: Record<ShowTagTone, string> = {
  live: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300',
  stale: 'bg-orange-500/15 text-orange-300',
  gone: 'bg-rose-500/15 text-rose-300',
  unknown: 'bg-neutral-700/40 text-neutral-300',
};

/**
 * The table's columns, left to right.
 *
 * Every measured column sorts by clicking its header. The release bars are a
 * shape rather than a number, so that is the one column with nothing to sort.
 */
const TABLE_COLUMNS: ReadonlyArray<{
  /** Column heading. */
  label: string;
  /** Share of the table this column takes, so the grid stays stable. */
  widthClass: string;
  /** Column it sorts by, or null when there is nothing to compare. */
  sort: PodcastSortColumn | null;
  /** True for columns of numbers, which are right-aligned. */
  numeric: boolean;
}> = [
  { label: 'Show', widthClass: 'w-[26%]', sort: 'show', numeric: false },
  { label: 'Verdict', widthClass: 'w-[13%]', sort: 'verdict', numeric: false },
  { label: 'Language', widthClass: 'w-[7%]', sort: 'language', numeric: false },
  { label: 'Last episode', widthClass: 'w-[10%]', sort: 'last', numeric: true },
  { label: 'Usual gap', widthClass: 'w-[10%]', sort: 'gap', numeric: true },
  { label: 'Episodes', widthClass: 'w-[10%]', sort: 'episodes', numeric: true },
  { label: 'Typical length', widthClass: 'w-[10%]', sort: 'length', numeric: true },
  { label: 'Releases a month', widthClass: 'w-[14%]', sort: 'releases', numeric: false },
];

/** Columns a saved sort is allowed to name. */
const SORT_COLUMNS: readonly PodcastSortColumn[] = TABLE_COLUMNS.flatMap((entry) =>
  entry.sort === null ? [] : [entry.sort]
);

/** True when a saved value names a column the table can sort by. */
function isSortColumn(value: unknown): value is PodcastSortColumn {
  return typeof value === 'string' && (SORT_COLUMNS as readonly string[]).includes(value);
}

/** True when a saved value names a sort direction. */
function isSortDirection(value: unknown): value is PodcastSortDirection {
  return value === 'ascending' || value === 'descending';
}

/** A search that worked, or a sentence saying why it did not. */
interface SearchState {
  /** The filters this result belongs to, so a stale response cannot land. */
  key: string;
  /** What the last request left behind. */
  stage: 'searching' | 'ready' | 'failed';
  /** Every show the merged search returned for the current filters. */
  shows: PodcastShow[];
  /** How many rows each directory contributed, in listing order. */
  counts: PodcastSourceCount[];
  /** Archive items found for the same words, shown beside the table. */
  archiveItems: PodcastShow[];
  /** One sentence per directory that did not answer. */
  unavailable: string[];
  /** Plain sentence explaining a failure, or null. */
  reason: string | null;
}

/** Verdicts for the feeds in the current result set. */
interface ReportState {
  /** The search key these verdicts belong to. */
  key: string;
  /** Report per feed URL. */
  byFeedUrl: Record<string, PodcastFeedReport>;
  /** Sentence explaining why the feed check failed as a whole, or null. */
  reason: string | null;
}

/**
 * A publisher the visitor narrowed to: either a filter over the rows already on
 * screen, or the full catalogue fetched from Apple's lookup endpoint.
 */
interface PublisherState {
  /** Grouping key from `publisherKeyForShow`, which is the artist id when Apple sent one. */
  key: string;
  /** Publisher name to show above the results. */
  name: string;
  /** Full catalogue once loaded, or null while this is only a filter. */
  catalogue: PodcastShow[] | null;
  /** True while the catalogue request is in flight. */
  loading: boolean;
  /** Sentence explaining a failed catalogue request, or null. */
  reason: string | null;
}

/** Fields the search box understands, shown as a hint under the form. */
const QUERY_FIELD_HINT = [...QUERY_TEXT_FIELDS, ...QUERY_NUMBER_FIELDS].join(', ');

const INITIAL_SEARCH_STATE: SearchState = {
  key: '',
  stage: 'ready',
  shows: [],
  counts: [],
  archiveItems: [],
  unavailable: [],
  reason: null,
};
const INITIAL_REPORT_STATE: ReportState = { key: '', byFeedUrl: {}, reason: null };

/**
 * The words to send to a directory for whatever is in the box.
 *
 * A query that parses contributes only its positive words, so `water AND NOT
 * fire` searches `water`. One the parser rejects still has words in it, and a
 * visitor who mistyped an operator should keep the rows already on screen
 * while the error sentence explains what went wrong, so the raw text is sent
 * rather than nothing at all.
 */
function readDirectorySearchTerm(parsed: PodcastQueryParseResult, rawQuery: string): string {
  if (!parsed.ok) return rawQuery.replace(/[*?]/g, '').trim().slice(0, MAX_QUERY_LENGTH);
  return parsed.node === null ? '' : extractPodcastSearchTerm(parsed.node);
}

/** A year of release counts as bars, one per month, oldest on the left. */
function ReleaseTrend({ counts }: { counts: readonly number[] }) {
  const peak = Math.max(1, ...counts);

  return (
    <div
      aria-label={`Releases per month over the last year: ${counts.join(', ')}`}
      className="flex h-6 items-end gap-0.5"
      role="img"
    >
      {counts.map((count, index) => (
        <span
          aria-hidden="true"
          className="w-1.5 rounded-sm bg-neutral-600"
          key={index}
          style={{ height: `${Math.max(8, (count / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A number with a bar under it, the way a comparison table reads at a glance.
 *
 * The bar is drawn against the largest value in the same column and is
 * decorative: the number beside it is what a screen reader reads.
 */
function MeasuredCell({ cell, peak }: { cell: TableCell; peak: number }) {
  const value = typeof cell.value === 'number' ? cell.value : null;
  const share = value === null || peak <= 0 ? 0 : Math.max(4, Math.round((value / peak) * 100));

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="tabular-nums">{cell.text}</span>
      <span aria-hidden="true" className="h-1 w-full rounded-full bg-neutral-800">
        <span className="block h-full rounded-full bg-neutral-600" style={{ width: `${share}%` }} />
      </span>
    </div>
  );
}

/**
 * What to say in the verdict cell before a feed has answered, so a blank cell
 * never reads as "this show is fine".
 */
function describeUnmeasuredRow(row: PodcastTableRow, checking: boolean): string {
  if (row.report !== null && !row.report.ok) {
    return `Could not read the feed: ${row.report.reason}`;
  }
  if (row.show.feedUrl === null) return describeMissingFeed(row.show.source);
  return checking ? 'Reading the feed\u2026' : 'Feed not checked.';
}

/** The filters a visitor can set, in one object so restoring them is one write. */
interface PodcastFilters {
  country: string;
  genreId: number;
  sortColumn: PodcastSortColumn;
  sortDirection: PodcastSortDirection;
  hideStale: boolean;
}

const DEFAULT_FILTERS: PodcastFilters = {
  country: 'us',
  genreId: 0,
  sortColumn: DEFAULT_PODCAST_SORT_COLUMN,
  sortDirection: DEFAULT_PODCAST_SORT_DIRECTION,
  hideStale: true,
};

/** Shared empty verdict index, so a render with no reports allocates nothing. */
const NO_REPORTS: Record<string, PodcastFeedReport> = {};

/** What the page has to say about the current search: idle, working, or done. */
type SearchStage = 'idle' | 'searching' | 'ready' | 'failed';

/** Read saved filters, ignoring anything missing or malformed. */
function readSavedFilters(): PodcastFilters | null {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PodcastFilters>;
    if (typeof parsed.country !== 'string') return null;
    if (typeof parsed.genreId !== 'number') return null;
    return {
      country: parsed.country,
      genreId: parsed.genreId,
      sortColumn: isSortColumn(parsed.sortColumn) ? parsed.sortColumn : DEFAULT_FILTERS.sortColumn,
      sortDirection: isSortDirection(parsed.sortDirection)
        ? parsed.sortDirection
        : DEFAULT_FILTERS.sortDirection,
      hideStale: parsed.hideStale ?? DEFAULT_FILTERS.hideStale,
    };
  } catch {
    return null;
  }
}

/** Search every directory for shows about a topic, then check whether they still publish. */
export default function PodcastFinderPage() {
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [filters, setFilters] = useState<PodcastFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [reports, setReports] = useState<ReportState>(INITIAL_REPORT_STATE);
  const [publisher, setPublisher] = useState<PublisherState | null>(null);

  // One box holds the topic and the query language, so the parsed query decides
  // both what to search for and what to filter, and the two cannot disagree.
  // Searching on the debounced value keeps a whole word to one request; the
  // filter over the rows reads that same tree.
  const parsedQuery = useMemo(() => parsePodcastQuery(debouncedTerm), [debouncedTerm]);
  const queryNode = parsedQuery.ok ? parsedQuery.node : null;
  const directoryTerm = readDirectorySearchTerm(parsedQuery, debouncedTerm);
  const searchKey = `${directoryTerm}|${filters.country}|${filters.genreId}`;

  // Restore the filters a visitor last used. This runs after mount rather than
  // during the first render, because the server that prerenders this page has
  // no localStorage to read.
  useEffect(() => {
    const saved = readSavedFilters();
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-only read: localStorage does not exist during prerender */
    if (saved !== null) setFilters(saved);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // A visitor with storage disabled still gets a working search.
    }
  }, [filters]);

  // Wait for typing to stop before searching, so a whole word is one request.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  // Whether the rows on screen answer the filters on screen. Deriving this
  // instead of writing a "loading" flag keeps a filter change from ever leaving
  // a stale list behind a spinner that already finished.
  const searchIsCurrent = search.key === searchKey;
  const currentShows = useMemo(
    () => (searchIsCurrent ? search.shows : []),
    [searchIsCurrent, search.shows]
  );
  // The publisher filter narrows what is on screen; a loaded catalogue replaces
  // it, because Apple answers the whole catalogue in one call.
  const publisherPool = publisher?.catalogue ?? currentShows;
  const publisherMatches = useMemo(
    () =>
      publisher === null ? publisherPool : filterShowsByPublisher(publisherPool, publisher.key),
    [publisher, publisherPool]
  );
  const publisherArtistId = publisher === null ? null : readPublisherArtistId(publisher.key);
  const displayKey = publisher === null ? searchKey : `publisher:${publisher.key}`;

  const searchStage: SearchStage =
    directoryTerm.length < 2 ? 'idle' : searchIsCurrent ? search.stage : 'searching';
  const searchReason = searchIsCurrent ? search.reason : null;
  const searchCounts = searchIsCurrent ? search.counts : [];
  const searchArchiveItems = searchIsCurrent ? search.archiveItems : [];
  const searchUnavailable = searchIsCurrent ? search.unavailable : [];
  // A valid query can still carry nothing a directory can search for, as in
  // `gap>30`, and the box then has no topic at all to look up.
  const queryNeedsATopic = parsedQuery.ok && debouncedTerm.length >= 2 && directoryTerm.length < 2;

  useEffect(() => {
    if (directoryTerm.length < 2) return;

    let active = true;
    void searchEveryPodcastDirectory({
      term: directoryTerm,
      country: filters.country,
      genreId: filters.genreId > 0 ? filters.genreId : undefined,
    }).then((outcome) => {
      if (!active) return;
      // A new result set answers a new question, so a publisher filter from the
      // old one would only ever read "0 of 25 shows are from ...".
      setPublisher(null);
      setSearch(
        outcome.ok
          ? {
              key: searchKey,
              stage: 'ready',
              shows: outcome.shows,
              counts: outcome.counts,
              archiveItems: outcome.archiveItems,
              unavailable: outcome.unavailable,
              reason: null,
            }
          : {
              key: searchKey,
              stage: 'failed',
              shows: [],
              counts: [],
              archiveItems: [],
              unavailable: [],
              reason: outcome.reason,
            }
      );
    });

    return () => {
      active = false;
    };
  }, [searchKey, directoryTerm, filters.country, filters.genreId]);

  const feedUrls = useMemo(() => listResultFeedUrls(publisherPool), [publisherPool]);

  // Ask for verdicts on the feeds of whatever just came back, twenty at a time.
  // A topic search answers a page of rows rather than a top ten, and the status
  // route judges twenty feeds per request, so the batches are walked in order
  // and each answer is drawn as it lands instead of waiting for the slowest
  // host in the last batch.
  useEffect(() => {
    if (feedUrls.length === 0) return;

    let active = true;
    void (async () => {
      const byFeedUrl: Record<string, PodcastFeedReport> = {};
      for (let start = 0; start < feedUrls.length; start += MAX_FEEDS_PER_REQUEST) {
        const batch = feedUrls.slice(start, start + MAX_FEEDS_PER_REQUEST);
        const outcome = await fetchPodcastStatus(batch);
        if (!active) return;
        if (!outcome.ok) {
          setReports({ key: displayKey, byFeedUrl, reason: outcome.reason });
          return;
        }
        for (const report of outcome.reports) byFeedUrl[report.feedUrl] = report;
        setReports({ key: displayKey, byFeedUrl: { ...byFeedUrl }, reason: null });
      }
    })();

    return () => {
      active = false;
    };
  }, [feedUrls, displayKey]);

  const reportIndex = reports.key === displayKey ? reports.byFeedUrl : NO_REPORTS;
  const statusReason = reports.key === displayKey ? reports.reason : null;

  const rows = useMemo(
    () => buildPodcastTableRows(publisherMatches, reportIndex),
    [publisherMatches, reportIndex]
  );

  const table = useMemo(() => {
    const byQuery =
      queryNode === null ? rows : rows.filter((row) => matchesPodcastQuery(queryNode, row));
    const kept = filters.hideStale
      ? byQuery.filter((row) => row.report?.health !== 'dormant' && row.report?.health !== 'dead')
      : byQuery;
    return {
      visible: sortPodcastTableRows(kept, filters.sortColumn, filters.sortDirection),
      matchedCount: byQuery.length,
    };
  }, [rows, queryNode, filters.hideStale, filters.sortColumn, filters.sortDirection]);

  const visibleRows = table.visible;
  const hiddenCount = table.matchedCount - visibleRows.length;
  const answeredCount = Object.keys(reportIndex).length;
  const checking = searchStage === 'searching' || answeredCount < feedUrls.length;

  // Largest value in each numeric column, so the bar under a number says how it
  // compares with what is on screen rather than with an absolute scale.
  const columnPeaks = useMemo(() => {
    const peakOf = (read: (row: PodcastTableRow) => number | string | null): number =>
      visibleRows.reduce((highest, row) => {
        const value = read(row);
        return typeof value === 'number' ? Math.max(highest, value) : highest;
      }, 0);
    return {
      last: peakOf((row) => row.lastEpisode.value),
      gap: peakOf((row) => row.gap.value),
      episodes: peakOf((row) => row.episodes.value),
      length: peakOf((row) => row.length.value),
    };
  }, [visibleRows]);

  const toggleSort = useCallback((column: PodcastSortColumn) => {
    setFilters((previous) =>
      previous.sortColumn === column
        ? {
            ...previous,
            sortDirection: previous.sortDirection === 'ascending' ? 'descending' : 'ascending',
          }
        : { ...previous, sortColumn: column, sortDirection: 'ascending' }
    );
  }, []);

  // Clicking a publisher name filters the rows already on screen, which is
  // instant and needs no request. The catalogue behind the "see all" button is
  // a second, explicit step, because it is another call to Apple.
  const selectPublisher = useCallback((show: PodcastShow) => {
    const key = publisherKeyForShow(show);
    setPublisher((previous) =>
      previous?.key === key
        ? null
        : { key, name: show.publisher, catalogue: null, loading: false, reason: null }
    );
  }, []);

  const loadPublisherCatalogue = useCallback(() => {
    const artistId = publisher === null ? null : readPublisherArtistId(publisher.key);
    if (publisher === null || artistId === null) return;
    const requestedKey = publisher.key;

    setPublisher((previous) =>
      previous === null ? previous : { ...previous, loading: true, reason: null }
    );
    void fetchPublisherShows(artistId, filters.country).then((outcome) => {
      setPublisher((previous) => {
        if (previous === null || previous.key !== requestedKey) return previous;
        return outcome.ok
          ? { ...previous, loading: false, catalogue: outcome.shows, reason: null }
          : { ...previous, loading: false, reason: outcome.reason };
      });
    });
  }, [publisher, filters.country]);

  return (
    <main
      className="min-h-dvh bg-neutral-950 px-5 py-8 text-neutral-100 scroll-mt-20"
      id="main-content"
    >
      <a
        className="font-mono text-xs text-neutral-400 transition-colors hover:text-neutral-200"
        href="https://scratchpad-ashen.vercel.app/"
        rel="noreferrer noopener"
        target="_blank"
      >
        &larr; scratchpad
      </a>

      <header className="mt-8">
        <h1 className="text-3xl font-semibold tracking-tight">Podcast Finder</h1>
        <p className="mt-2 max-w-prose text-sm text-neutral-400">
          Find shows about a topic, then see whether they still publish. One search asks
          Apple&rsquo;s keyless{' '}
          <a
            className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
            href="https://performance-partners.apple.com/search-api"
            rel="noreferrer noopener"
            target="_blank"
          >
            iTunes Search API
          </a>
          , fyyd and the Internet Archive at once. Every verdict comes from the show&rsquo;s own
          feed, so a page promising monthly episodes since 2019 is labelled for what it is.
        </p>
      </header>

      <form
        className="mt-6 flex flex-wrap items-end gap-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label className="text-xs text-neutral-400" htmlFor="podcast-term">
            Search
          </label>
          <input
            autoFocus
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            id="podcast-term"
            onChange={(event) => setTerm(event.target.value)}
            placeholder="municipal water, or title:water AND NOT verdict:dead"
            type="search"
            value={term}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400" htmlFor="podcast-country">
            Storefront
          </label>
          <select
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            id="podcast-country"
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, country: event.target.value }))
            }
            value={filters.country}
          >
            {PODCAST_COUNTRY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400" htmlFor="podcast-genre">
            Genre
          </label>
          <select
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            id="podcast-genre"
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, genreId: Number(event.target.value) }))
            }
            value={filters.genreId}
          >
            <option value={0}>All genres</option>
            {PODCAST_GENRE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label
          className="flex items-center gap-2 pb-2 text-sm text-neutral-300"
          htmlFor="podcast-hide-stale"
        >
          <input
            checked={filters.hideStale}
            id="podcast-hide-stale"
            onChange={(event) =>
              setFilters((previous) => ({ ...previous, hideStale: event.target.checked }))
            }
            type="checkbox"
          />
          Hide shows that stopped publishing
        </label>
      </form>

      {!parsedQuery.ok && (
        <p className="mt-2 text-sm text-rose-300" role="alert">
          {parsedQuery.reason}
        </p>
      )}

      <p className="mt-2 text-xs text-neutral-400">
        The box takes a topic, or a query: AND, OR, NOT, brackets, quotes and wildcards. Fields:{' '}
        {QUERY_FIELD_HINT}. Numbers compare with `gap&gt;30`, `last&lt;14` or `episodes:12`.
      </p>

      <p aria-live="polite" className="mt-4 text-xs text-neutral-400" role="status">
        {searchStage === 'searching' && 'Searching every directory\u2026'}
        {searchStage === 'ready' && describeStatusProgress(answeredCount, feedUrls.length)}
        {table.matchedCount < publisherMatches.length &&
          ` ${table.matchedCount} of ${publisherMatches.length} match that query.`}
        {hiddenCount > 0 && ` ${hiddenCount} dormant or dead shows hidden.`}
      </p>

      {searchStage === 'ready' && searchCounts.length > 0 && (
        <p className="mt-2 text-xs text-neutral-400">{describeDirectoryMix(searchCounts)}</p>
      )}

      {searchUnavailable.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-amber-300" role="status">
          {searchUnavailable.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}

      {publisher !== null && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm">
          <span className="text-neutral-300">
            {describePublisherSelection(
              publisherMatches.length,
              publisherPool.length,
              publisher.name
            )}
          </span>
          {publisherArtistId !== null && publisher.catalogue === null && (
            <button
              className="rounded-full border border-neutral-700 px-3 py-1 text-xs transition-colors hover:bg-neutral-800 disabled:opacity-60"
              disabled={publisher.loading}
              onClick={loadPublisherCatalogue}
              type="button"
            >
              {publisher.loading
                ? `Loading all shows from ${publisher.name}\u2026`
                : `See all shows from ${publisher.name}`}
            </button>
          )}
          <button
            className="text-xs text-neutral-400 underline decoration-dotted underline-offset-2 hover:text-neutral-200"
            onClick={() => setPublisher(null)}
            type="button"
          >
            Clear publisher
          </button>
        </div>
      )}

      {publisher?.reason != null && (
        <p className="mt-2 text-sm text-amber-300" role="alert">
          Could not list every show from {publisher.name}: {publisher.reason}
        </p>
      )}

      {searchStage === 'failed' && (
        <p className="mt-4 text-sm text-rose-300" role="alert">
          {searchReason}
        </p>
      )}

      {statusReason !== null && (
        <p className="mt-2 text-sm text-amber-300" role="alert">
          Feeds could not be checked: {statusReason} The numbers below are each directory&rsquo;s
          own.
        </p>
      )}

      {searchStage === 'idle' && (
        <>
          {queryNeedsATopic ? (
            <p className="mt-6 text-sm text-neutral-400">
              That query only filters, so add a word to search for, as in `water AND gap&gt;30`.
            </p>
          ) : (
            <section className="mt-6">
              <h2 className="text-sm text-neutral-400">Try</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {EXAMPLE_SEARCHES.map((example) => (
                  <li key={example}>
                    <button
                      className="rounded-full border border-neutral-700 px-3 py-1 text-sm transition-colors hover:bg-neutral-800"
                      onClick={() => setTerm(example)}
                      type="button"
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {searchStage === 'ready' && visibleRows.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">
          {publisher !== null && publisherMatches.length === 0
            ? 'None of the loaded shows are from that publisher. Clear it to see the rest.'
            : currentShows.length === 0
              ? 'No shows matched that search.'
              : queryNode !== null && table.matchedCount === 0
                ? 'No loaded shows match that query.'
                : 'Every match was dormant or dead. Untick the box to see them.'}
        </p>
      )}

      {visibleRows.length > 0 && (
        <div className="mt-6 max-h-[70vh] overflow-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[72rem] table-fixed border-collapse text-sm">
            <caption className="sr-only">
              Shows matching the search, with the verdict and numbers each show&rsquo;s own feed
              proves.
            </caption>
            <thead className="sticky top-0 z-10 bg-neutral-900 text-left shadow-[0_1px_0_0_theme(colors.neutral.800)]">
              <tr>
                {TABLE_COLUMNS.map((entry) => {
                  const sortColumn = entry.sort;
                  const isActive = sortColumn !== null && sortColumn === filters.sortColumn;
                  return (
                    <th
                      aria-sort={
                        sortColumn === null ? undefined : isActive ? filters.sortDirection : 'none'
                      }
                      className={`${entry.widthClass} border-r border-neutral-800/70 px-3 py-2 font-medium text-neutral-400 last:border-r-0`}
                      key={entry.label}
                      scope="col"
                    >
                      {sortColumn === null ? (
                        entry.label
                      ) : (
                        <button
                          className="flex w-full items-center gap-1 text-left transition-colors hover:text-neutral-200"
                          onClick={() => toggleSort(sortColumn)}
                          type="button"
                        >
                          {entry.label}
                          <span aria-hidden="true" className="text-[10px]">
                            {isActive
                              ? filters.sortDirection === 'ascending'
                                ? '\u25b2'
                                : '\u25bc'
                              : '\u2195'}
                          </span>
                        </button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  className="border-t border-neutral-800 transition-colors hover:bg-neutral-900/60"
                  key={row.show.sourceKey}
                >
                  <td className="border-r border-neutral-800/70 px-3 py-2 align-top">
                    <div className="flex gap-3">
                      {row.show.artworkUrl !== null && (
                        // eslint-disable-next-line @next/next/no-img-element -- artwork comes from the show's own directory at a size next/image would re-encode and re-host.
                        <img
                          alt=""
                          className="h-9 w-9 shrink-0 rounded object-cover"
                          height={36}
                          loading="lazy"
                          src={row.show.artworkUrl}
                          width={36}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <a
                            className="truncate font-medium hover:underline"
                            href={row.show.pageUrl}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {row.show.title}
                          </a>
                          {row.show.feedUrl !== null && (
                            <a
                              className="shrink-0 text-xs text-neutral-400 hover:text-neutral-200"
                              href={row.show.feedUrl}
                              rel="noreferrer noopener"
                              target="_blank"
                            >
                              RSS
                            </a>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-400">
                          <button
                            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-neutral-200"
                            onClick={() => selectPublisher(row.show)}
                            type="button"
                          >
                            {row.show.publisher}
                          </button>
                          {row.show.genres.slice(0, 2).map((genre) => (
                            <span key={genre}>{genre}</span>
                          ))}
                          {row.show.country !== '' && <span>{row.show.country}</span>}
                          {row.show.explicit && <span>Explicit</span>}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="border-r border-neutral-800/70 px-3 py-2 align-top">
                    {row.tags.length > 0 && (
                      <ul className="flex flex-wrap gap-1">
                        {row.tags.map((tag) => (
                          <li
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${TAG_CLASS[tag.tone]}`}
                            key={tag.id}
                          >
                            {tag.label}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.tags.length === 0 && (
                      <p className="text-xs text-neutral-400">
                        {describeUnmeasuredRow(row, checking)}
                      </p>
                    )}
                    {row.claimMismatchSentence !== null && (
                      <p className="mt-1 text-xs text-amber-300">{row.claimMismatchSentence}</p>
                    )}
                  </td>

                  <td className="border-r border-neutral-800/70 px-3 py-2 text-neutral-200 align-top">
                    <span className="tabular-nums">{row.language.text}</span>
                  </td>

                  <td className="border-r border-neutral-800/70 px-3 py-2 text-neutral-200 align-top">
                    <MeasuredCell cell={row.lastEpisode} peak={columnPeaks.last} />
                  </td>
                  <td className="border-r border-neutral-800/70 px-3 py-2 text-neutral-200 align-top">
                    <MeasuredCell cell={row.gap} peak={columnPeaks.gap} />
                  </td>
                  <td className="border-r border-neutral-800/70 px-3 py-2 text-neutral-200 align-top">
                    <MeasuredCell cell={row.episodes} peak={columnPeaks.episodes} />
                  </td>
                  <td className="border-r border-neutral-800/70 px-3 py-2 text-neutral-200 align-top">
                    <MeasuredCell cell={row.length} peak={columnPeaks.length} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    {row.monthlyReleaseCounts === null ? (
                      <span className="text-xs text-neutral-500">not measured</span>
                    ) : (
                      <ReleaseTrend counts={row.monthlyReleaseCounts} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searchStage === 'ready' && searchArchiveItems.length > 0 && (
        <section className="mt-6 rounded-xl border border-neutral-800 p-4">
          <h2 className="text-sm font-medium text-neutral-300">
            Also on the Internet Archive ({searchArchiveItems.length})
          </h2>
          <p className="mt-1 text-xs text-neutral-400">
            The Archive holds audio items rather than shows, so nothing here has a feed to check and
            none of it is in the table above. Extra reading for the same words.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {searchArchiveItems.map((item) => (
              <li key={item.sourceKey}>
                <a
                  className="hover:underline"
                  href={item.pageUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {item.title}
                </a>
                {item.publisher !== '' && (
                  <span className="ml-2 text-xs text-neutral-400">{item.publisher}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
