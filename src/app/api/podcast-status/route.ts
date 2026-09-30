// Status adapter: pulls a batch of podcast feeds and answers what each one
// proves about its show.
//
// This is the slow half of the app, because every feed is a third-party host
// that never agreed to serve us. So the batch is capped, pulled a few at a
// time, and cached for ten minutes, and every failure comes back as a sentence
// on one show rather than an error for the whole request.

import { createTtlCache } from '@/lib/podcast-finder/analysis-cache';
import {
  MAX_FEEDS_PER_REQUEST,
  analysePodcastFeeds,
  type PodcastFeedReport,
} from '@/lib/podcast-finder/feed-report';
import { podcastStatusBodySchema } from '@/server/podcast-schemas';

// Posts a body and reads live feeds, so nothing here may be cached or prerendered.
export const dynamic = 'force-dynamic';

// Twenty feeds at four at a time, each allowed twelve seconds, needs more than
// the default invocation budget when a few hosts are slow.
export const maxDuration = 60;

// Reused across requests in one server process, so a popular show costs one
// upstream pull per ten minutes rather than one per visitor.
const reportCache = createTtlCache<PodcastFeedReport>();

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Expected a JSON body with a feeds array.' }, { status: 400 });
  }

  const parsed = podcastStatusBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: `Send between 1 and ${MAX_FEEDS_PER_REQUEST} feed URLs.` },
      { status: 400 }
    );
  }

  const reports = await analysePodcastFeeds(parsed.data.feeds, { cache: reportCache });
  return Response.json({ reports });
}
