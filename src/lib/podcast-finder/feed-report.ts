// Turns a feed URL into the JSON-safe report the results list renders.
//
// The work here is the join between three modules: fetch and parse the feed,
// measure its publishing rhythm, then compare that rhythm with the schedule the
// show claims in its own words. The output is deliberately plain JSON because it
// crosses a route boundary: no `Date` objects, so the browser cannot end up with
// a string where the types promised a date.

import {
  describeCadenceMismatch,
  readFeedCadenceClaim,
  type CadenceClaim,
  type CadenceMismatch,
} from './cadence-claim';
import { createTtlCache, type TtlCache } from './analysis-cache';
import {
  classifyShowHealth,
  summariseEpisodeCadence,
  type CadenceSummary,
  type ShowHealth,
} from './episode-cadence';
import {
  fetchPodcastFeed,
  listDatedEpisodeSamples,
  type FeedFetchResult,
  type FetchPodcastFeedOptions,
} from './feed-analysis';

/** Cadence numbers with the date stringified, for the wire. */
export type SerialisedCadenceSummary = Omit<CadenceSummary, 'lastEpisodeAt'> & {
  /** Newest episode publication date as an ISO string, or null. */
  lastEpisodeAt: string | null;
};

/** What the page knows about one show after pulling its feed. */
export interface PodcastFeedReport {
  /** The feed that was pulled. */
  feedUrl: string;
  /** False when the feed could not be read; `reason` then explains why. */
  ok: boolean;
  /** Sentence explaining a failure, or null on success. */
  reason: string | null;
  /** Show title as the feed itself writes it, or null. */
  feedTitle: string | null;
  /** Show description, for the "what is this about" line, or null. */
  description: string | null;
  /** Title of the newest episode, or null. */
  latestEpisodeTitle: string | null;
  /** Verdict on whether the show is still publishing, or null when unread. */
  health: ShowHealth | null;
  /** The schedule the show claims in its own words, or null. */
  claim: CadenceClaim | null;
  /** Where the claim and the measured rhythm disagree, or null. */
  claimMismatch: CadenceMismatch | null;
  /** Measured cadence, or null when the feed could not be read. */
  cadence: SerialisedCadenceSummary | null;
}

/** Most feeds one status request may ask about. */
export const MAX_FEEDS_PER_REQUEST = 20;

/**
 * Feeds pulled at once. Four keeps a batch of twenty inside one serverless
 * invocation's budget while a big feed is still being read, and stays polite to
 * hosts that never agreed to serve this app.
 */
export const FEED_FETCH_CONCURRENCY = 4;

/** Stringify the newest-episode date so the report survives JSON. */
export function toSerialisedCadenceSummary(summary: CadenceSummary): SerialisedCadenceSummary {
  return { ...summary, lastEpisodeAt: summary.lastEpisodeAt?.toISOString() ?? null };
}

/**
 * Build one report from a feed read. Failures keep the feed URL and the reason
 * so the card can say "host refused" instead of silently vanishing.
 */
export function buildPodcastFeedReport(
  feedUrl: string,
  result: FeedFetchResult,
  now: Date = new Date()
): PodcastFeedReport {
  if (!result.ok) {
    return {
      feedUrl,
      ok: false,
      reason: result.reason,
      feedTitle: null,
      description: null,
      latestEpisodeTitle: null,
      health: null,
      claim: null,
      claimMismatch: null,
      cadence: null,
    };
  }

  const { feed } = result;
  const samples = listDatedEpisodeSamples(feed.episodes);
  const summary = summariseEpisodeCadence(samples, now);
  const claim = readFeedCadenceClaim(feed);

  return {
    feedUrl,
    ok: true,
    reason: null,
    feedTitle: feed.title,
    description: feed.description,
    latestEpisodeTitle:
      feed.episodes.find((episode) => episode.publishedAt !== null)?.title ?? null,
    health: classifyShowHealth(summary),
    claim,
    claimMismatch: describeCadenceMismatch(claim, summary.medianGapDays),
    cadence: toSerialisedCadenceSummary(summary),
  };
}

/** Run `task` over `items`, never more than `limit` at a time, keeping order. */
async function runWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item, index: number) => Promise<Result>
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await task(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Options for `analysePodcastFeeds`, kept injectable for tests. */
export interface AnalysePodcastFeedsOptions extends FetchPodcastFeedOptions {
  /** Clock used for "days since last episode". */
  now?: Date;
  /** How many feeds to pull at once. */
  concurrency?: number;
  /** Cache to read through, so a repeated search does not re-pull a host. */
  cache?: TtlCache<PodcastFeedReport>;
}

/**
 * Pull and analyse a batch of feeds, answering one report per URL in the order
 * asked. Every failure is reported, never thrown: a single unreachable host must
 * not stop the other nineteen shows from getting verdicts.
 */
export async function analysePodcastFeeds(
  feedUrls: readonly string[],
  options: AnalysePodcastFeedsOptions = {}
): Promise<PodcastFeedReport[]> {
  const now = options.now ?? new Date();
  const cache = options.cache ?? createTtlCache<PodcastFeedReport>();
  const concurrency = options.concurrency ?? FEED_FETCH_CONCURRENCY;
  const wanted = feedUrls.slice(0, MAX_FEEDS_PER_REQUEST);

  return runWithConcurrency(wanted, concurrency, async (feedUrl) => {
    const cached = cache.get(feedUrl);
    if (cached !== undefined) return cached;

    const result = await fetchPodcastFeed(feedUrl, options);
    const report = buildPodcastFeedReport(feedUrl, result, now);
    cache.set(feedUrl, report);
    return report;
  });
}
