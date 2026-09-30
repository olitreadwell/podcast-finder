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

// A chart, then one lookup for its feeds. Apple's chart host measured between
// 1.5 s and 7.7 s on its own, so this route needs more room than the default.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastChartsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'A chart needs a two-letter storefront.' }, { status: 400 });
  }

  const result = await fetchAppleChartShows(parsed.data.country, parsed.data.limit);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });

  // Apple's chart host is the least reliable call in the app, and a chart moves
  // slowly. Letting Vercel's edge hold it for ten minutes means one visitor
  // meets a slow or failed chart rather than every visitor for the next ten.
  return Response.json(
    { shows: result.shows.map(toSerialisedPodcastShow) },
    { headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
  );
}
