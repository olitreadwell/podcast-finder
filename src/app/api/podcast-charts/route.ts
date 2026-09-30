// Charts adapter over Apple's marketing feed.
//
// This is the second Apple surface the app uses: the ranked list of what a
// storefront is listening to right now, which answers a different question from
// "search for a topic". The chart carries no feed URL, so the module behind
// this route follows it with one batched lookup.

import { fetchAppleChartShows } from '@/lib/podcast-finder/apple-charts';
import { toSerialisedPodcastShow } from '@/lib/podcast-finder/itunes-search';
import { podcastChartsQuerySchema } from '@/server/podcast-schemas';

// Reads the query string and calls Apple live, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastChartsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'A chart needs a two-letter storefront.' }, { status: 400 });
  }

  const result = await fetchAppleChartShows(parsed.data.country, parsed.data.limit);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });

  return Response.json({ shows: result.shows.map(toSerialisedPodcastShow) });
}
