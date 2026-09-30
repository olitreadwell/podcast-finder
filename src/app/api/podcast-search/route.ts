// Search adapter over Apple's iTunes Search API.
//
// The browser never calls Apple directly: the API sends no CORS headers worth
// relying on and rate limits per IP, so one visitor searching repeatedly would
// burn the same budget for everyone behind that IP. The server makes one call
// per search instead, and the response is a plain JSON shape the page can use.

import { searchItunesPodcasts, toSerialisedPodcastShow } from '@/lib/podcast-finder/itunes-search';
import { podcastSearchQuerySchema } from '@/server/podcast-schemas';

// Reads the query string, so it must never be prerendered or cached per build.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastSearchQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'Search needs at least two characters.' }, { status: 400 });
  }

  const result = await searchItunesPodcasts(parsed.data);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });

  return Response.json({ shows: result.shows.map(toSerialisedPodcastShow) });
}
