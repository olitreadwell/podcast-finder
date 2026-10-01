// Search adapter over every directory the app knows.
//
// The browser never calls a directory directly: Apple sends no CORS headers
// worth relying on and rate limits per IP, so one visitor searching repeatedly
// would burn the same budget for everyone behind that IP. The server makes the
// calls instead, all at once, and answers one merged list.
//
// A directory that fails is a sentence in the response rather than a failed
// search, because one source being down is not worth an empty page.

import { searchEveryDirectory } from '@/lib/podcast-finder/directory-search';
import {
  directorySearchCache,
  readDirectorySearchCacheControl,
  readDirectorySearchCacheKey,
} from '@/lib/podcast-finder/directory-search-cache';
import { toSerialisedPodcastShow } from '@/lib/podcast-finder/itunes-search';
import { podcastSearchQuerySchema } from '@/server/podcast-schemas';

// The merged search waits for every directory, and fyyd can take ten seconds,
// so the route asks for the same headroom the status route does.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = podcastSearchQuerySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: 'Search needs at least two characters.' }, { status: 400 });
  }

  const cacheKey = readDirectorySearchCacheKey(parsed.data);
  const cached = directorySearchCache.get(cacheKey);
  const result = cached ?? (await searchEveryDirectory(parsed.data));
  if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });
  if (cached === undefined) directorySearchCache.set(cacheKey, result);

  return Response.json(
    {
      shows: result.shows.map(toSerialisedPodcastShow),
      counts: result.counts,
      archiveItems: result.archiveItems.map(toSerialisedPodcastShow),
      unavailable: result.unavailable,
    },
    { headers: { 'Cache-Control': readDirectorySearchCacheControl(result.unavailable) } }
  );
}
