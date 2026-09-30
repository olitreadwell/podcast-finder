import { describe, expect, it, vi } from 'vitest';

import { createTtlCache } from './analysis-cache';
import { parsePodcastFeed, type FeedFetchResult } from './feed-analysis';
import {
  MAX_FEEDS_PER_REQUEST,
  analysePodcastFeeds,
  buildPodcastFeedReport,
  toSerialisedCadenceSummary,
  type PodcastFeedReport,
} from './feed-report';
import { summariseEpisodeCadence } from './episode-cadence';

/** The clock every report test measures against. */
const NOW = new Date('2026-01-01T00:00:00.000Z');

/**
 * An RSS feed whose episodes sit `gapDays` apart, whose newest episode landed
 * `lastDaysAgo` days ago, and whose blurb promises the cadence in `claim`.
 * Separating the two is what makes a "stopped publishing" fixture possible: a
 * show that always published monthly and last published a month ago is still
 * healthy, and only the two numbers together say otherwise.
 */
function feedXml(options: {
  claim: string;
  gapDays: number;
  lastDaysAgo?: number;
  episodes?: number;
}): string {
  const count = options.episodes ?? 6;
  const lastDaysAgo = options.lastDaysAgo ?? options.gapDays;
  const items = new Array(count).fill(null).map((_, index) => {
    const date = new Date(NOW.getTime() - (lastDaysAgo + index * options.gapDays) * 86_400_000);
    return `<item><title>Episode ${count - index}</title><pubDate>${date.toUTCString()}</pubDate><itunes:duration>2400</itunes:duration></item>`;
  });

  return `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
    <title>Weekly Wipe</title>
    <description>${options.claim}</description>
    <itunes:author>Drain Media</itunes:author>
    ${items.join('')}
  </channel></rss>`;
}

/** A successful feed read, as `fetchPodcastFeed` would return it. */
function fetched(xml: string): FeedFetchResult {
  const parsed = parsePodcastFeed(xml);
  if (!parsed.ok) throw new Error(parsed.reason);
  return { ok: true, feed: parsed.feed, fetchedBytes: xml.length };
}

/** A report for a weekly show that stopped four months ago. */
function staleReportFeed(): FeedFetchResult {
  return fetched(feedXml({ claim: 'New episodes every Monday.', gapDays: 7, episodes: 20 }));
}

describe('toSerialisedCadenceSummary', () => {
  it('stringifies the newest episode date for the wire', () => {
    const summary = summariseEpisodeCadence([{ publishedAt: NOW, durationSeconds: 600 }], NOW);

    expect(toSerialisedCadenceSummary(summary).lastEpisodeAt).toBe('2026-01-01T00:00:00.000Z');
    expect(
      toSerialisedCadenceSummary({ ...summary, lastEpisodeAt: null }).lastEpisodeAt
    ).toBeNull();
  });
});

describe('buildPodcastFeedReport', () => {
  it('measures a live show and leaves the promise alone', () => {
    const report = buildPodcastFeedReport(
      'https://example.com/feed.xml',
      fetched(feedXml({ claim: 'A weekly look at drains.', gapDays: 7 })),
      NOW
    );

    expect(report.ok).toBe(true);
    expect(report.feedTitle).toBe('Weekly Wipe');
    expect(report.health).toBe('active');
    expect(report.cadence?.medianGapDays).toBe(7);
    expect(report.cadence?.medianDurationSeconds).toBe(2400);
    expect(report.cadence?.lastEpisodeAt).toBe('2025-12-25T00:00:00.000Z');
    expect(report.latestEpisodeTitle).toBe('Episode 6');
    expect(report.claimMismatch).toBeNull();
  });

  it('catches a show that still says weekly and stopped publishing', () => {
    const report = buildPodcastFeedReport(
      'https://example.com/feed.xml',
      fetched(
        feedXml({ claim: 'New episodes every Monday.', gapDays: 45, lastDaysAgo: 140, episodes: 8 })
      ),
      NOW
    );

    expect(report.claim?.label).toBe('weekly');
    expect(report.claimMismatch).toEqual({
      direction: 'slower',
      sentence: 'Says weekly, actually every ~45 days',
    });
    expect(report.health).toBe('dormant');
  });

  it('reports a feed it could not read without pretending to know more', () => {
    const report = buildPodcastFeedReport(
      'https://example.com/feed.xml',
      { ok: false, reason: 'The feed host answered 404.' },
      NOW
    );

    expect(report).toEqual({
      feedUrl: 'https://example.com/feed.xml',
      ok: false,
      reason: 'The feed host answered 404.',
      feedTitle: null,
      description: null,
      latestEpisodeTitle: null,
      health: null,
      claim: null,
      claimMismatch: null,
      cadence: null,
    });
  });

  it('answers an unknown verdict for a feed with no dated episodes', () => {
    const report = buildPodcastFeedReport(
      'https://example.com/feed.xml',
      fetched(
        '<rss><channel><title>Empty</title><description>Nothing yet.</description></channel></rss>'
      ),
      NOW
    );

    expect(report.health).toBe('unknown');
    expect(report.cadence?.datedEpisodeCount).toBe(0);
    expect(report.latestEpisodeTitle).toBeNull();
  });
});

describe('analysePodcastFeeds', () => {
  it('answers one report per URL, in the order asked', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const xml = url.includes('live')
        ? feedXml({ claim: 'Weekly.', gapDays: 7, lastDaysAgo: 3 })
        : feedXml({ claim: 'Weekly.', gapDays: 7, lastDaysAgo: 400 });
      return new Response(xml, { status: 200 });
    });

    const reports = await analysePodcastFeeds(
      ['https://example.com/dead.xml', 'https://example.com/live.xml'],
      {
        fetchImpl,
        now: NOW,
      }
    );

    expect(reports.map((report) => report.feedUrl)).toEqual([
      'https://example.com/dead.xml',
      'https://example.com/live.xml',
    ]);
    expect(reports[0]?.health).toBe('dead');
    expect(reports[1]?.health).toBe('active');
  });

  it('keeps going when one host refuses', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('broken')) return new Response('nope', { status: 500 });
      return new Response(feedXml({ claim: 'Weekly.', gapDays: 7 }), { status: 200 });
    });

    const reports = await analysePodcastFeeds(
      ['https://example.com/broken.xml', 'https://example.com/fine.xml'],
      { fetchImpl, now: NOW }
    );

    expect(reports[0]?.ok).toBe(false);
    expect(reports[0]?.reason).toBe('The feed host answered 500.');
    expect(reports[1]?.ok).toBe(true);
  });

  it('reads a repeated feed from the cache instead of the host', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(feedXml({ claim: 'Weekly.', gapDays: 7 }), { status: 200 })
    );
    const cache = createTtlCache<PodcastFeedReport>();

    await analysePodcastFeeds(['https://example.com/feed.xml'], { fetchImpl, now: NOW, cache });
    await analysePodcastFeeds(['https://example.com/feed.xml'], { fetchImpl, now: NOW, cache });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(cache.size()).toBe(1);
  });

  it('caps how many feeds one request may ask about', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(feedXml({ claim: 'Weekly.', gapDays: 7 }), { status: 200 })
    );
    const feedUrls = new Array(MAX_FEEDS_PER_REQUEST + 5)
      .fill(null)
      .map((_, index) => `https://example.com/${index}.xml`);

    const reports = await analysePodcastFeeds(feedUrls, { fetchImpl, now: NOW });

    expect(reports).toHaveLength(MAX_FEEDS_PER_REQUEST);
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_FEEDS_PER_REQUEST);
  });

  it('never pulls more feeds at once than the concurrency limit', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return new Response(feedXml({ claim: 'Weekly.', gapDays: 7 }), { status: 200 });
    });
    const feedUrls = new Array(12).fill(null).map((_, index) => `https://example.com/${index}.xml`);

    await analysePodcastFeeds(feedUrls, { fetchImpl, now: NOW, concurrency: 3 });

    expect(peakInFlight).toBeLessThanOrEqual(3);
  });

  it('answers an empty list for no feeds', async () => {
    expect(await analysePodcastFeeds([], { now: NOW })).toEqual([]);
  });

  it('reuses the stale-report fixture', () => {
    const report = buildPodcastFeedReport('https://example.com/feed.xml', staleReportFeed(), NOW);

    expect(report.cadence?.datedEpisodeCount).toBeGreaterThan(0);
  });
});
