// Reads a podcast RSS feed and turns it into the facts the finder needs:
// episode dates, episode lengths, and the show's own description.
//
// Apple's search API returns at most 200 episodes per show and its idea of the
// "latest" episode can lag the real feed, so the feed itself is the source of
// truth for whether a show is still publishing. Feeds are hand-written and
// inconsistent, so the parser is deliberately forgiving: one broken `<pubDate>`
// drops one episode rather than the whole show.
//
// The parser is a targeted extractor, not a general XML parser. It reads the
// handful of tags this app uses and ignores the rest, including `<content:encoded>`
// bodies that are often hundreds of kilobytes each.

import type { EpisodeSample } from './episode-cadence';

/** Longest feed the parser will accept, so a huge archive cannot fill memory. */
export const FEED_MAX_BYTES = 4_000_000;

/**
 * Milliseconds the status route waits for a feed before giving up on it.
 *
 * Measured against real feeds: an 1.8 MB, 596-episode feed took 3.1 s on its
 * own, and feeds pulled in parallel share the connection, so 8 s was tight
 * enough to time out a show that was only slow, not broken.
 */
export const FEED_FETCH_TIMEOUT_MS = 12_000;

/** Most episodes read per feed. Older ones cannot change the recent verdict. */
export const FEED_MAX_ITEMS = 300;

/** How the app identifies itself when it pulls a feed, as podcast hosts ask. */
export const PODCAST_FEED_USER_AGENT =
  'PodcastFinder/1.0 (+https://podcast-finder-ruby.vercel.app)';

/** One episode as the feed describes it. */
export interface FeedEpisode {
  /** Episode title, HTML stripped, or null when the feed omits it. */
  title: string | null;
  /** Publication date, or null when missing or unparsable. */
  publishedAt: Date | null;
  /** Length in seconds, or null when the feed omits or mangles it. */
  durationSeconds: number | null;
  /** Audio file URL from the enclosure, or null when absent. */
  audioUrl: string | null;
}

/** The parts of a show's channel the finder reads. */
export interface PodcastFeed {
  /** Show title from the channel, or null. */
  title: string | null;
  /** Show description, HTML stripped, or null. */
  description: string | null;
  /** Language the feed declares, reduced to its primary subtag, or null. */
  language: string | null;
  /** Author or owner name, or null. */
  author: string | null;
  /** Channel `lastBuildDate`, or null. */
  lastBuildDate: Date | null;
  /** Episodes in feed order, newest first where the feed bothers to sort. */
  episodes: FeedEpisode[];
}

/** A feed read, or a plain sentence saying why it could not be read. */
export type FeedParseResult = { ok: true; feed: PodcastFeed } | { ok: false; reason: string };

/** A feed fetched and parsed, or the reason it is missing. */
export type FeedFetchResult =
  { ok: true; feed: PodcastFeed; fetchedBytes: number } | { ok: false; reason: string };

/** Decode the XML entities podcast feeds actually use. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Drop CDATA wrappers and HTML tags, leaving readable text. */
export function stripFeedMarkup(value: string): string {
  return decodeXmlEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text of the first `tag` inside `xml`, markup stripped, or null when absent. */
export function readFeedTagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (match === null) return null;
  const text = stripFeedMarkup(match[1] ?? '');
  return text.length > 0 ? text : null;
}

/**
 * The language a feed declares, or null.
 *
 * RSS writes `<language>en-us</language>` and Atom writes `xml:lang` on its
 * `<feed>` element, so both are read. Either way the answer is reduced to the
 * primary subtag: `en-us`, `en-GB` and `en` are the same answer to "what
 * language is this in", and a column that shows all three cannot be filtered.
 *
 * This is the feed's own claim, not a measurement of the audio. A show whose
 * notes were written once can be as wrong about its language as it is about its
 * episode schedule.
 */
export function readFeedLanguage(xml: string): string | null {
  const declared =
    readFeedTagText(xml, 'language') ??
    /<feed\b[^>]*\bxml:lang=["']([^"']+)["']/i.exec(xml)?.[1] ??
    null;
  if (declared === null) return null;

  const primary = declared.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

/**
 * Parse `<itunes:duration>`, which podcast hosts write as seconds, `MM:SS`,
 * `HH:MM:SS`, or as a lie. Anything unparsable becomes null.
 */
export function readRssDurationSeconds(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Math.round(Number.parseFloat(trimmed));
    return seconds > 0 ? seconds : null;
  }

  const parts = trimmed.split(':').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;

  const [first = 0, second = 0, third = 0] = parts.map((part) => Number.parseInt(part, 10));
  const seconds = parts.length === 3 ? first * 3600 + second * 60 + third : first * 60 + second;
  return seconds > 0 ? seconds : null;
}

/** Read a date, returning null rather than an Invalid Date. */
function readFeedDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** Read one attribute out of an XML tag's attribute list. */
function readTagAttribute(tag: string, attribute: string): string | null {
  const match = new RegExp(`\\b${attribute}=["']([^"']*)["']`, 'i').exec(tag);
  return match?.[1] ?? null;
}

/**
 * The audio file for an episode. RSS writes `<enclosure url="...">`; Atom
 * writes `<link rel="enclosure" href="...">` with the attributes in any order,
 * so each `<link>` tag is read as a whole rather than matched positionally.
 */
export function readEpisodeAudioUrl(block: string): string | null {
  const enclosure = /<enclosure\b[^>]*>/i.exec(block)?.[0];
  const enclosureUrl = enclosure === undefined ? null : readTagAttribute(enclosure, 'url');
  if (enclosureUrl !== null) return enclosureUrl;

  for (const linkTag of block.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = readTagAttribute(linkTag, 'rel');
    if (rel?.toLowerCase() === 'enclosure') return readTagAttribute(linkTag, 'href');
  }
  return null;
}

/** One `<item>` or Atom `<entry>` block, as a `FeedEpisode`. */
function parseFeedEntry(block: string): FeedEpisode {
  return {
    title: readFeedTagText(block, 'title'),
    publishedAt: readFeedDate(
      readFeedTagText(block, 'pubDate') ??
        readFeedTagText(block, 'published') ??
        readFeedTagText(block, 'updated')
    ),
    durationSeconds: readRssDurationSeconds(readFeedTagText(block, 'itunes:duration')),
    audioUrl: readEpisodeAudioUrl(block),
  };
}

/**
 * Parse a podcast feed document into channel metadata and episodes. Answers a
 * reason instead of throwing when the document is not a feed at all, which is
 * what a host's HTML error page looks like over HTTP 200.
 */
export function parsePodcastFeed(xml: string): FeedParseResult {
  if (!/<rss\b|<feed\b|<channel\b/i.test(xml)) {
    return { ok: false, reason: 'That URL returned a web page, not a feed.' };
  }

  // Each match always has its capture group filled, but TypeScript cannot know
  // that from the type of `matchAll`, so the blocks are filtered to strings.
  const itemBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  );
  const entryBlocks = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  );
  const blocks = (itemBlocks.length > 0 ? itemBlocks : entryBlocks).slice(0, FEED_MAX_ITEMS);

  // Channel metadata must be read from the part of the document outside the
  // episodes: the first `<title>` in a document is often an episode title.
  const channel = xml
    .replace(/<item\b[\s\S]*<\/item>/gi, '')
    .replace(/<entry\b[\s\S]*<\/entry>/gi, '');

  const episodes = blocks
    .map(parseFeedEntry)
    .sort(
      (left, right) => (right.publishedAt?.getTime() ?? 0) - (left.publishedAt?.getTime() ?? 0)
    );

  return {
    ok: true,
    feed: {
      title: readFeedTagText(channel, 'title'),
      description:
        readFeedTagText(channel, 'itunes:summary') ??
        readFeedTagText(channel, 'description') ??
        readFeedTagText(channel, 'subtitle'),
      language: readFeedLanguage(xml),
      author: readFeedTagText(channel, 'itunes:author') ?? readFeedTagText(channel, 'author'),
      lastBuildDate: readFeedDate(readFeedTagText(channel, 'lastBuildDate')),
      episodes,
    },
  };
}

/** Reduce parsed episodes to the samples cadence maths wants. */
export function listDatedEpisodeSamples(episodes: readonly FeedEpisode[]): EpisodeSample[] {
  const samples: EpisodeSample[] = [];
  for (const episode of episodes) {
    if (episode.publishedAt === null) continue;
    samples.push({ publishedAt: episode.publishedAt, durationSeconds: episode.durationSeconds });
  }
  return samples;
}

/** Only http(s) URLs are fetched, so a feed field cannot be pointed at `file:`. */
export function isHttpFeedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Read a response body as text, stopping at `maxBytes`. */
async function readCappedText(
  response: Response,
  maxBytes: number
): Promise<{ text: string; bytes: number }> {
  if (response.body === null) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    const capped = buffer.subarray(0, maxBytes);
    return { text: new TextDecoder().decode(capped), bytes: capped.byteLength };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;

    const remaining = maxBytes - total;
    if (value.length >= remaining) {
      chunks.push(value.subarray(0, remaining));
      total = maxBytes;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(body), bytes: total };
}

/** Options for `fetchPodcastFeed`, so tests can swap in a fake fetch. */
export interface FetchPodcastFeedOptions {
  /** The fetch implementation to call. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Milliseconds to wait before giving up. */
  timeoutMs?: number;
  /** Largest body to read. */
  maxBytes?: number;
}

/**
 * Fetch and parse a podcast feed. Every failure answers a sentence a reader can
 * act on: the host is down, the host is too slow, the URL is not a feed.
 */
export async function fetchPodcastFeed(
  feedUrl: string,
  options: FetchPodcastFeedOptions = {}
): Promise<FeedFetchResult> {
  if (!isHttpFeedUrl(feedUrl)) {
    return { ok: false, reason: 'That feed URL is not http or https.' };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FEED_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? FEED_MAX_BYTES;

  try {
    const response = await fetchImpl(feedUrl, {
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': PODCAST_FEED_USER_AGENT,
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });

    if (!response.ok) {
      return { ok: false, reason: `The feed host answered ${response.status}.` };
    }

    const { text, bytes } = await readCappedText(response, maxBytes);
    const parsed = parsePodcastFeed(text);
    if (!parsed.ok) return parsed;

    return { ok: true, feed: parsed.feed, fetchedBytes: bytes };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      reason: timedOut
        ? 'The feed host took too long to answer.'
        : 'Could not reach the feed host.',
    };
  }
}
