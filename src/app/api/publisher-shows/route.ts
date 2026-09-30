// Publisher adapter over Apple's lookup endpoint.
//
// The browser never calls Apple directly, for the same reason the search route
// exists: no usable CORS headers, and a per-IP rate limit that one visitor
// could spend for everybody behind that IP. So the page asks this route for a
// publisher's catalogue instead.
//
// Apple files a publisher under a numeric artist id, and one id can spell
// itself several ways across its own shows, so the id is the only thing this
// route accepts. The name shown on the page is never the query.

import {
  lookupItunesPublisherShows,
  toSerialisedPodcastShow,
} from '@/lib/podcast-finder/itunes-search';
import { podcastPublisherQuerySchema } from '@/server/podcast-schemas';

// Reads the query string, so it must never be prerendered or cached per build.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastPublisherQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'A publisher lookup needs an Apple artistId.' }, { status: 400 });
  }

  const result = await lookupItunesPublisherShows(parsed.data.artistId, {
    country: parsed.data.country,
  });
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });

  return Response.json({ shows: result.shows.map(toSerialisedPodcastShow) });
}
