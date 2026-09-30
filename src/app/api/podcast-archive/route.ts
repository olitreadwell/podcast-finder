// Internet Archive search adapter.
//
// The Archive answers with items rather than feeds, so results from here can be
// listed but never judged by the cadence machinery. The card says so.

import { toSerialisedPodcastShow } from '@/lib/podcast-finder/itunes-search';
import { searchArchivePodcasts } from '@/lib/podcast-finder/archive-search';
import { podcastDirectorySearchQuerySchema } from '@/server/podcast-schemas';

// Reads the query string and calls the Archive live, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastDirectorySearchQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'Search needs at least two characters.' }, { status: 400 });
  }

  const result = await searchArchivePodcasts(parsed.data.term, parsed.data.limit);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });

  return Response.json({ shows: result.shows.map(toSerialisedPodcastShow) });
}
