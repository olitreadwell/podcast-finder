'use client';

// built on the iTunes Search API
// https://performance-partners.apple.com/search-api
//
// Podcast apps tell you what a show promises, not what it does. A page can say
// "new episodes monthly" for four years after the last one shipped, because
// that text is show notes, written once. This app searches Apple's keyless
// directory for shows about a topic, then pulls each show's own RSS feed and
// measures the gaps between real publication dates. The verdict per card comes
// from the feed: publish rhythm, how long since the newest episode, and whether
// the promise in the show notes still matches the dates.

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  describeStatusProgress,
  fetchPodcastStatus,
  fetchPublisherShows,
  listResultFeedUrls,
  searchPodcastShows,
} from '@/lib/podcast-finder/api-client';
import type { ShowHealth } from '@/lib/podcast-finder/episode-cadence';
import { MAX_FEEDS_PER_REQUEST, type PodcastFeedReport } from '@/lib/podcast-finder/feed-report';
import {
  PODCAST_COUNTRY_OPTIONS,
  PODCAST_GENRE_OPTIONS,
  type PodcastShow,
} from '@/lib/podcast-finder/itunes-search';
import {
  matchesPodcastQuery,
  parsePodcastQuery,
  QUERY_NUMBER_FIELDS,
  QUERY_TEXT_FIELDS,
} from '@/lib/podcast-finder/search-query';
import {
  describePublisherSelection,
  filterShowsByPublisher,
  publisherKeyForShow,
  readPublisherArtistId,
} from '@/lib/podcast-finder/publisher-shows';
import {
  PODCAST_SORT_OPTIONS,
  describePodcastShowFacts,
  describePodcastShowTags,
  sortPodcastShows,
  type PodcastSortOrder,
  type ShowTagTone,
} from '@/lib/podcast-finder/show-tags';

/** How long the search box waits after typing before it searches. */
const SEARCH_DEBOUNCE_MS = 400;

/** Where the page remembers the filters between visits. */
const FILTERS_STORAGE_KEY = 'podcast-finder.filters';

/** Shown when a visitor has not typed anything yet. */
const EXAMPLE_SEARCHES = ['municipal water', 'type design', 'climate policy'];

/**
 * Results per search. Deliberately the same number as the status route's feed
 * cap: ask for more and the extra results can never get a verdict, which shows
 * up as a card that says "reading the feed" forever.
 */
const SEARCH_RESULT_LIMIT = MAX_FEEDS_PER_REQUEST;

/** Badge colours per tag tone, legible in dark mode. */
const TAG_CLASS: Record<ShowTagTone, string> = {
  live: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300',
  stale: 'bg-orange-500/15 text-orange-300',
  gone: 'bg-rose-500/15 text-rose-300',
  unknown: 'bg-neutral-700/40 text-neutral-300',
};

/** A search that worked, or a sentence saying why it did not. */
interface SearchState {
  /** The filters this result belongs to, so a stale response cannot land. */
  key: string;
  /** What the last request left behind. */
  stage: 'searching' | 'ready' | 'failed';
  /** Shows Apple returned for the current filters. */
  shows: PodcastShow[];
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
 * A publisher the visitor narrowed to: either a filter over the results already
 * on screen, or the full catalogue fetched from Apple's lookup endpoint.
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

/** Fields the filter box understands, shown as a hint under the form. */
const QUERY_FIELD_HINT = [...QUERY_TEXT_FIELDS, ...QUERY_NUMBER_FIELDS].join(', ');

const INITIAL_SEARCH_STATE: SearchState = { key: '', stage: 'ready', shows: [], reason: null };
const INITIAL_REPORT_STATE: ReportState = { key: '', byFeedUrl: {}, reason: null };

/** One card: what Apple knows, then what the feed proved. */
function PodcastShowCard({
  show,
  report,
  checking,
  onSelectPublisher,
}: {
  show: PodcastShow;
  report: PodcastFeedReport | null;
  /** True while the feed batch is still in flight. */
  checking: boolean;
  /** Called with the card's show when the visitor clicks its publisher name. */
  onSelectPublisher: (show: PodcastShow) => void;
}) {
  const facts = describePodcastShowFacts(show, report);
  const tags =
    report?.cadence != null
      ? describePodcastShowTags({
          health: report.health ?? 'unknown',
          medianGapDays: report.cadence.medianGapDays,
          gapSpreadDays: report.cadence.gapSpreadDays,
          datedEpisodeCount: report.cadence.datedEpisodeCount,
          claimMismatch: report.claimMismatch,
        })
      : [];

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 sm:flex-row">
      {show.artworkUrl !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- artwork comes from Apple's CDN at a size next/image would re-encode and re-host.
        <img
          alt={`Cover art for ${show.title}`}
          className="h-24 w-24 shrink-0 rounded-lg object-cover"
          height={96}
          loading="lazy"
          src={show.artworkUrl}
          width={96}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="truncate text-lg font-semibold">
            <a
              className="hover:underline"
              href={show.appleUrl}
              rel="noreferrer noopener"
              target="_blank"
            >
              {show.title}
            </a>
          </h2>
          <button
            className="text-xs text-neutral-400 underline decoration-dotted underline-offset-2 transition-colors hover:text-neutral-200"
            onClick={() => onSelectPublisher(show)}
            type="button"
          >
            {show.publisher}
          </button>
        </div>

        {tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${TAG_CLASS[tag.tone]}`}
                key={tag.id}
              >
                {tag.label}
              </li>
            ))}
          </ul>
        )}

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {facts.map((fact) => (
            <div className="flex gap-1" key={fact.label}>
              <dt className="text-neutral-400">{fact.label}</dt>
              <dd className="text-neutral-200">{fact.value}</dd>
            </div>
          ))}
        </dl>

        {report?.claimMismatch != null && (
          <p className="mt-2 text-sm text-amber-300">{report.claimMismatch.sentence}</p>
        )}

        {report === null && show.feedUrl !== null && (
          <p className="mt-2 text-xs text-neutral-400" role="status">
            {checking ? 'Reading the feed\u2026' : 'Feed not checked.'}
          </p>
        )}

        {show.feedUrl === null && (
          <p className="mt-2 text-xs text-neutral-400">
            Apple returned no feed URL for this one, so it cannot be checked.
          </p>
        )}

        {report !== null && !report.ok && (
          <p className="mt-2 text-xs text-neutral-400">Could not read the feed: {report.reason}</p>
        )}

        {report?.cadence != null && (
          <div className="mt-3 flex items-center gap-3">
            <ReleaseTrend counts={report.cadence.monthlyReleaseCounts} />
            <span className="text-xs text-neutral-400">releases per month, oldest left</span>
          </div>
        )}

        {report?.cadence != null && (
          <p className="mt-2 text-xs text-neutral-400">
            {report.cadence.datedEpisodeCount} dated episodes in the feed
            {report.cadence.episodesInLast90Days > 0
              ? `, ${report.cadence.episodesInLast90Days} in the last 90 days`
              : ', none in the last 90 days'}
            .
          </p>
        )}

        <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-neutral-400">
          {show.feedUrl !== null && (
            <a
              className="hover:text-neutral-300"
              href={show.feedUrl}
              rel="noreferrer noopener"
              target="_blank"
            >
              RSS feed
            </a>
          )}
          {show.genres.slice(0, 2).map((genre) => (
            <span key={genre}>{genre}</span>
          ))}
          {show.country !== '' && <span>{show.country}</span>}
          {show.explicit && <span>Explicit</span>}
        </p>
      </div>
    </article>
  );
}

/** A year of release counts as bars, one per month, oldest on the left. */
function ReleaseTrend({ counts }: { counts: readonly number[] }) {
  const peak = Math.max(1, ...counts);

  return (
    <div
      aria-label={`Releases per month over the last year: ${counts.join(', ')}`}
      className="flex h-8 items-end gap-0.5"
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

/** The filters a visitor can set, in one object so restoring them is one write. */
interface PodcastFilters {
  country: string;
  genreId: number;
  sortOrder: PodcastSortOrder;
  hideStale: boolean;
}

const DEFAULT_FILTERS: PodcastFilters = {
  country: 'us',
  genreId: 0,
  sortOrder: 'newest',
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
      sortOrder: parsed.sortOrder ?? DEFAULT_FILTERS.sortOrder,
      hideStale: parsed.hideStale ?? DEFAULT_FILTERS.hideStale,
    };
  } catch {
    return null;
  }
}

/** Search shows about a topic, then check whether they still publish. */
export default function PodcastFinderPage() {
  const [term, setTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [filters, setFilters] = useState<PodcastFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [reports, setReports] = useState<ReportState>(INITIAL_REPORT_STATE);
  const [publisher, setPublisher] = useState<PublisherState | null>(null);
  // The filter is not persisted with the other filters: a saved query answers a
  // question the visitor asked last time, and a stale one looks like a bug.
  const [query, setQuery] = useState('');

  const searchKey = `${debouncedTerm}|${filters.country}|${filters.genreId}`;

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

  // Whether the results on screen answer the filters on screen. Deriving this
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
    debouncedTerm.length < 2 ? 'idle' : searchIsCurrent ? search.stage : 'searching';
  const searchReason = searchIsCurrent ? search.reason : null;

  useEffect(() => {
    if (debouncedTerm.length < 2) return;

    let active = true;
    void searchPodcastShows({
      term: debouncedTerm,
      country: filters.country,
      genreId: filters.genreId > 0 ? filters.genreId : undefined,
      limit: SEARCH_RESULT_LIMIT,
    }).then((outcome) => {
      if (!active) return;
      // A new result set answers a new question, so a publisher filter from the
      // old one would only ever read "0 of 25 shows are from ...".
      setPublisher(null);
      setSearch(
        outcome.ok
          ? { key: searchKey, stage: 'ready', shows: outcome.shows, reason: null }
          : { key: searchKey, stage: 'failed', shows: [], reason: outcome.reason }
      );
    });

    return () => {
      active = false;
    };
  }, [searchKey, debouncedTerm, filters.country, filters.genreId]);

  const feedUrls = useMemo(() => listResultFeedUrls(publisherPool), [publisherPool]);

  // Ask for verdicts on the feeds of whatever just came back.
  useEffect(() => {
    if (feedUrls.length === 0) return;

    let active = true;
    void fetchPodcastStatus(feedUrls).then((outcome) => {
      if (!active) return;
      const byFeedUrl: Record<string, PodcastFeedReport> = {};
      if (outcome.ok) {
        for (const report of outcome.reports) byFeedUrl[report.feedUrl] = report;
      }
      setReports({ key: displayKey, byFeedUrl, reason: outcome.ok ? null : outcome.reason });
    });

    return () => {
      active = false;
    };
  }, [feedUrls, displayKey]);

  const reportIndex = reports.key === displayKey ? reports.byFeedUrl : NO_REPORTS;
  const statusReason = reports.key === displayKey ? reports.reason : null;

  const healthByAppleId = useMemo(() => {
    const map = new Map<string, ShowHealth>();
    for (const show of currentShows) {
      const report = show.feedUrl === null ? undefined : reportIndex[show.feedUrl];
      if (report?.health != null) map.set(String(show.appleId), report.health);
    }
    return map;
  }, [currentShows, reportIndex]);

  const parsedQuery = useMemo(() => parsePodcastQuery(query), [query]);
  const queryNode = parsedQuery.ok ? parsedQuery.node : null;

  const results = useMemo(() => {
    const withVerdicts = publisherMatches.map((show) => ({
      show,
      report: show.feedUrl === null ? null : (reportIndex[show.feedUrl] ?? null),
    }));
    const byQuery =
      queryNode === null
        ? withVerdicts
        : withVerdicts.filter((entry) => matchesPodcastQuery(queryNode, entry));
    const kept = filters.hideStale
      ? byQuery.filter(
          (entry) => entry.report?.health !== 'dormant' && entry.report?.health !== 'dead'
        )
      : byQuery;
    return {
      visibleShows: sortPodcastShows(
        kept.map((entry) => entry.show),
        healthByAppleId,
        filters.sortOrder
      ),
      matchedCount: byQuery.length,
    };
  }, [
    publisherMatches,
    reportIndex,
    filters.hideStale,
    filters.sortOrder,
    healthByAppleId,
    queryNode,
  ]);

  const visibleShows = results.visibleShows;
  const hiddenCount = results.matchedCount - visibleShows.length;
  const answeredCount = Object.keys(reportIndex).length;
  // Clicking a publisher name filters the results already on screen, which is
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

  const reportFor = useCallback(
    (show: PodcastShow) => (show.feedUrl === null ? null : (reportIndex[show.feedUrl] ?? null)),
    [reportIndex]
  );

  return (
    <main
      id="main-content"
      className="min-h-dvh bg-neutral-950 px-5 py-8 text-neutral-100 scroll-mt-20"
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
          Find shows about a topic, then see whether they still publish. Search comes from
          Apple&rsquo;s keyless{' '}
          <a
            className="underline decoration-neutral-600 underline-offset-2 hover:text-neutral-200"
            href="https://performance-partners.apple.com/search-api"
            rel="noreferrer noopener"
            target="_blank"
          >
            iTunes Search API
          </a>
          ; every verdict comes from the show&rsquo;s own feed, so a page promising monthly episodes
          since 2019 is labelled for what it is.
        </p>
      </header>

      <form
        className="mt-6 flex flex-wrap items-end gap-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <label className="text-xs text-neutral-400" htmlFor="podcast-term">
            Topic
          </label>
          <input
            autoFocus
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            id="podcast-term"
            onChange={(event) => setTerm(event.target.value)}
            placeholder="municipal water"
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

        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400" htmlFor="podcast-sort">
            Sort
          </label>
          <select
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            id="podcast-sort"
            onChange={(event) =>
              setFilters((previous) => ({
                ...previous,
                sortOrder: event.target.value as PodcastSortOrder,
              }))
            }
            value={filters.sortOrder}
          >
            {PODCAST_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label className="text-xs text-neutral-400" htmlFor="podcast-query">
            Filter
          </label>
          <input
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500"
            id="podcast-query"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="title:water AND NOT verdict:dead"
            type="text"
            value={query}
          />
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
        Filter uses AND, OR, NOT, brackets, quotes and wildcards. Fields: {QUERY_FIELD_HINT}.
        Numbers compare with `gap&gt;30`, `last&lt;14` or `episodes:12`.
      </p>

      <p aria-live="polite" className="mt-4 text-xs text-neutral-400" role="status">
        {searchStage === 'searching' && 'Searching Apple\u2026'}
        {searchStage === 'ready' && describeStatusProgress(answeredCount, feedUrls.length)}
        {queryNode !== null &&
          ` ${results.matchedCount} of ${publisherMatches.length} match the filter.`}
        {hiddenCount > 0 && ` ${hiddenCount} dormant or dead shows hidden.`}
      </p>

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
          Feeds could not be checked: {statusReason} The numbers below are Apple&rsquo;s.
        </p>
      )}

      {searchStage === 'idle' && (
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

      {searchStage === 'ready' && visibleShows.length === 0 && (
        <p className="mt-6 text-sm text-neutral-400">
          {publisher !== null && publisherMatches.length === 0
            ? 'None of the loaded shows are from that publisher. Clear it to see the rest.'
            : queryNode !== null && results.matchedCount === 0
              ? 'No loaded shows match that filter.'
              : currentShows.length === 0
                ? 'No shows matched that topic.'
                : 'Every match was dormant or dead. Untick the box to see them.'}
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {visibleShows.map((show) => (
          <li key={show.appleId}>
            <PodcastShowCard
              checking={searchStage === 'searching' || answeredCount < feedUrls.length}
              onSelectPublisher={selectPublisher}
              report={reportFor(show)}
              show={show}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}
