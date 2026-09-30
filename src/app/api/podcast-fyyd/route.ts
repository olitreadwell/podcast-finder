// fyyd search adapter: the app's second directory.
//
// fyyd is called from the server for the same reason Apple is, and its rows
// carry a feed URL directly, so its results are judged exactly like Apple's.

import { toSerialisedPodcastShow } from '@/lib/podcast-finder/itunes-search';
import { searchFyydPodcasts } from '@/lib/podcast-finder/fyyd-search';
import { podcastDirectorySearchQuerySchema } from '@/server/podcast-schemas';

// Reads the query string and calls fyyd live, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastDirectorySearchQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'Search needs at least two characters.' }, { status: 400 });
  }

  const result = await searchFyydPodcasts(parsed.data.term, parsed.data.limit);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });

  return Response.json({ shows: result.shows.map(toSerialisedPodcastShow) });
}
