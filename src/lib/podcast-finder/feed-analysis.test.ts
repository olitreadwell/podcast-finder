import { describe, expect, it, vi } from 'vitest';

import {
  FEED_MAX_ITEMS,
  decodeXmlEntities,
  fetchPodcastFeed,
  isHttpFeedUrl,
  listDatedEpisodeSamples,
  parsePodcastFeed,
  readEpisodeAudioUrl,
  readFeedLanguage,
  readFeedTagText,
  readRssDurationSeconds,
  stripFeedMarkup,
  type FeedEpisode,
} from './feed-analysis';

/** One `<item>` block with the fields the parser reads. */
function itemBlock(options: {
  title: string;
  pubDate?: string;
  duration?: string;
  enclosure?: string;
}): string {
  return [
    '<item>',
    `<title><![CDATA[${options.title}]]></title>`,
    options.pubDate === undefined ? '' : `<pubDate>${options.pubDate}</pubDate>`,
    options.duration === undefined ? '' : `<itunes:duration>${options.duration}</itunes:duration>`,
    options.enclosure === undefined
      ? ''
      : `<enclosure url="${options.enclosure}" type="audio/mpeg" />`,
    '</item>',
  ].join('');
}

/** A three-episode RSS feed, the shape most hosts publish. */
function sampleFeed(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Weekly Wipe</title>
    <itunes:author>Drain Media</itunes:author>
    <description><![CDATA[A <em>weekly</em> look at drains &amp; pipes.]]></description>
    <lastBuildDate>Mon, 22 Dec 2025 09:00:00 GMT</lastBuildDate>
    ${itemBlock({
      title: 'Episode 2 &amp; the pipe',
      pubDate: 'Mon, 15 Dec 2025 09:00:00 GMT',
      duration: '01:02:03',
      enclosure: 'https://example.com/2.mp3',
    })}
    ${itemBlock({
      title: 'Episode 3',
      pubDate: 'Mon, 22 Dec 2025 09:00:00 GMT',
      duration: '45:12',
    })}
    ${itemBlock({ title: 'Episode 1', pubDate: 'Mon, 08 Dec 2025 09:00:00 GMT', duration: '3600' })}
  </channel>
</rss>`;
}

describe('xml helpers', () => {
  it('decodes the entities podcast feeds use', () => {
    expect(decodeXmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2014; f')).toBe(
      'a & b <c> "d" \'e\' \u2014 f'
    );
  });

  it('strips markup, entities and CDATA into readable text', () => {
    expect(stripFeedMarkup('<![CDATA[<p>A &amp; B</p><br/>C]]>')).toBe('A & B C');
  });

  it('reads a tag and answers null when it is absent or empty', () => {
    expect(readFeedTagText('<channel><title>Hi</title></channel>', 'title')).toBe('Hi');
    expect(readFeedTagText('<channel></channel>', 'title')).toBeNull();
    expect(readFeedTagText('<channel><title>   </title></channel>', 'title')).toBeNull();
  });
});

describe('readFeedLanguage', () => {
  it('reduces an RSS language to its primary subtag', () => {
    expect(readFeedLanguage('<rss><channel><language>en-US</language></channel></rss>')).toBe('en');
  });

  it('reads the xml:lang an Atom feed declares', () => {
    expect(readFeedLanguage('<feed xml:lang="de-DE"><title>X</title></feed>')).toBe('de');
  });

  it('answers null when the feed says nothing usable', () => {
    expect(readFeedLanguage('<rss><channel><title>X</title></channel></rss>')).toBeNull();
    expect(
      readFeedLanguage('<rss><channel><language>not a language</language></channel></rss>')
    ).toBeNull();
  });
});

describe('readRssDurationSeconds', () => {
  it('reads seconds, minutes and hours', () => {
    expect(readRssDurationSeconds('3600')).toBe(3600);
    expect(readRssDurationSeconds('45:12')).toBe(2712);
    expect(readRssDurationSeconds('01:02:03')).toBe(3723);
    expect(readRssDurationSeconds('1800.4')).toBe(1800);
  });

  it('answers null for junk, empty and zero-length values', () => {
    expect(readRssDurationSeconds(null)).toBeNull();
    expect(readRssDurationSeconds('')).toBeNull();
    expect(readRssDurationSeconds('not a duration')).toBeNull();
    expect(readRssDurationSeconds('1:2:3:4')).toBeNull();
    expect(readRssDurationSeconds('0')).toBeNull();
    expect(readRssDurationSeconds('00:00')).toBeNull();
  });
});

describe('readEpisodeAudioUrl', () => {
  it('reads an RSS enclosure', () => {
    expect(readEpisodeAudioUrl('<enclosure url="https://example.com/a.mp3" length="1" />')).toBe(
      'https://example.com/a.mp3'
    );
  });

  it('reads an Atom enclosure link whatever order the attributes are in', () => {
    expect(readEpisodeAudioUrl('<link href="https://example.com/a.mp3" rel="enclosure" />')).toBe(
      'https://example.com/a.mp3'
    );
  });

  it('ignores non-enclosure links', () => {
    expect(
      readEpisodeAudioUrl('<link rel="alternate" href="https://example.com/page" />')
    ).toBeNull();
    expect(readEpisodeAudioUrl('<item><title>No audio</title></item>')).toBeNull();
  });
});

describe('parsePodcastFeed', () => {
  it('reads channel metadata and episodes, newest first', () => {
    const parsed = parsePodcastFeed(sampleFeed());
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.feed.title).toBe('Weekly Wipe');
    expect(parsed.feed.author).toBe('Drain Media');
    expect(parsed.feed.description).toBe('A weekly look at drains & pipes.');
    expect(parsed.feed.lastBuildDate?.toISOString()).toBe('2025-12-22T09:00:00.000Z');
    expect(parsed.feed.episodes.map((episode) => episode.title)).toEqual([
      'Episode 3',
      'Episode 2 & the pipe',
      'Episode 1',
    ]);
    expect(parsed.feed.episodes[0]?.durationSeconds).toBe(2712);
    expect(parsed.feed.episodes[1]?.audioUrl).toBe('https://example.com/2.mp3');
    expect(parsed.feed.episodes[0]?.audioUrl).toBeNull();
  });

  it('refuses an HTML page that came back with a 200', () => {
    const parsed = parsePodcastFeed('<!doctype html><html><body>Not found</body></html>');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('That URL returned a web page, not a feed.');
  });

  it('reads an Atom feed', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Cast</title>
      <subtitle>Talks about drains.</subtitle>
      <author><name>Drain Media</name></author>
      <entry>
        <title>Episode 1</title>
        <published>2025-12-15T09:00:00.000Z</published>
        <itunes:duration>1200</itunes:duration>
        <link href="https://example.com/1.mp3" rel="enclosure" />
      </entry>
    </feed>`;

    const parsed = parsePodcastFeed(atom);
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.feed.title).toBe('Atom Cast');
    expect(parsed.feed.description).toBe('Talks about drains.');
    expect(parsed.feed.episodes).toHaveLength(1);
    expect(parsed.feed.episodes[0]?.audioUrl).toBe('https://example.com/1.mp3');
  });

  it('keeps an episode with a broken date but drops the date', () => {
    const xml = `<rss><channel><title>X</title>${itemBlock({ title: 'No date', pubDate: 'not a date' })}</channel></rss>`;
    const parsed = parsePodcastFeed(xml);
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.feed.episodes[0]?.publishedAt).toBeNull();
  });

  it('caps how many episodes it reads from a long archive', () => {
    const items = new Array(FEED_MAX_ITEMS + 25)
      .fill(null)
      .map((_, index) =>
        itemBlock({ title: `Episode ${index}`, pubDate: 'Mon, 15 Dec 2025 09:00:00 GMT' })
      );
    const parsed = parsePodcastFeed(
      `<rss><channel><title>X</title>${items.join('')}</channel></rss>`
    );
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.feed.episodes).toHaveLength(FEED_MAX_ITEMS);
  });

  it('answers an empty episode list for a feed with no items', () => {
    const parsed = parsePodcastFeed('<rss><channel><title>Empty</title></channel></rss>');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.feed.title).toBe('Empty');
    expect(parsed.feed.episodes).toEqual([]);
  });
});

describe('listDatedEpisodeSamples', () => {
  it('keeps only episodes with a date', () => {
    const episodes: FeedEpisode[] = [
      {
        title: 'A',
        publishedAt: new Date('2025-12-01T00:00:00.000Z'),
        durationSeconds: 60,
        audioUrl: null,
      },
      { title: 'B', publishedAt: null, durationSeconds: 60, audioUrl: null },
    ];

    expect(listDatedEpisodeSamples(episodes)).toHaveLength(1);
  });
});

describe('isHttpFeedUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpFeedUrl('https://example.com/feed.xml')).toBe(true);
    expect(isHttpFeedUrl('http://example.com/feed.xml')).toBe(true);
    expect(isHttpFeedUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpFeedUrl('nonsense')).toBe(false);
  });
});

describe('fetchPodcastFeed', () => {
  it('fetches and parses a feed', async () => {
    const fetchImpl = vi.fn(async () => new Response(sampleFeed(), { status: 200 }));

    const result = await fetchPodcastFeed('https://example.com/feed.xml', { fetchImpl });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.feed.title).toBe('Weekly Wipe');
      expect(result.fetchedBytes).toBeGreaterThan(0);
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('refuses a non-http URL without calling the network', async () => {
    const fetchImpl = vi.fn();

    const result = await fetchPodcastFeed('file:///etc/passwd', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('That feed URL is not http or https.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports the status when the host refuses', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }));

    const result = await fetchPodcastFeed('https://example.com/feed.xml', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('The feed host answered 403.');
  });

  it('reports a timeout in plain words', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });

    const result = await fetchPodcastFeed('https://example.com/feed.xml', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('The feed host took too long to answer.');
  });

  it('reports an unreachable host', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    });

    const result = await fetchPodcastFeed('https://example.com/feed.xml', { fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Could not reach the feed host.');
  });

  it('stops reading at the byte cap', async () => {
    const body = sampleFeed();
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));

    const result = await fetchPodcastFeed('https://example.com/feed.xml', {
      fetchImpl,
      maxBytes: 40,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('That URL returned a web page, not a feed.');
  });
});
