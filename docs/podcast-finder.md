# Spec: Podcast Finder

Built by hand on **iTunes Search** — https://performance-partners.apple.com/search-api
Catalogue id `itunes-search-affiliate.itunes.apple.com`, category Music/Video/Podcasts,
no auth, HTTPS, no key.

## Objective

Search for shows about a topic, then find out which of them are actually still
publishing. Podcast directories repeat the schedule a publisher wrote into the
show notes when the show launched, so a page can promise "new episodes monthly"
for years after the last episode shipped. The listener only finds out after
subscribing and waiting.

The audience is one person with a topic in mind and no patience for dead feeds.
Success is that a search answers in a couple of seconds, that every result
carries a verdict measured from the show's own feed, and that a show which has
stopped publishing is labelled and hidden by default rather than buried in a
list of plausible-looking cards.

## Tech stack

Next.js 16 App Router, React 19, TypeScript, Tailwind 4, zod at every boundary,
Vitest with Testing Library. No new dependencies: the RSS reader is a small
targeted extractor, not a general XML parser.

APIs:

- `GET https://itunes.apple.com/search?term=&media=podcast&entity=podcast` —
  keyless, rate limited per IP, no useful CORS headers. Returns show metadata:
  title, publisher, `feedUrl`, genres, artwork, storefront, `trackCount`, and a
  `releaseDate` that loosely tracks the newest episode.
- Each show's own RSS or Atom feed, fetched server-side for episode `pubDate`s
  and `<itunes:duration>` values.

## Commands

```bash
pnpm dev                                        # http://localhost:3000/podcast-finder
pnpm test                                       # vitest, fast loop
pnpm run check                                  # the repo gate
node scripts/smoke-live.mjs /podcast-finder "Podcast Finder"
```

## Project structure

```
src/lib/podcast-finder/episode-cadence.ts        gaps, health verdict, formatting
src/lib/podcast-finder/cadence-claim.ts          the schedule a show claims vs the one it keeps
src/lib/podcast-finder/feed-analysis.ts          feed fetch, RSS/Atom extraction
src/lib/podcast-finder/feed-report.ts            one JSON-safe report per feed, batched
src/lib/podcast-finder/itunes-search.ts          Apple search URL, response parsing, wire shapes
src/lib/podcast-finder/show-tags.ts              tags, facts, sorting
src/lib/podcast-finder/api-client.ts             the browser's two calls
src/lib/podcast-finder/analysis-cache.ts         ten-minute TTL cache for feed reports
src/app/podcast-finder/api/search/route.ts       search adapter
src/app/podcast-finder/api/status/route.ts       feed status adapter (batched, cached, capped)
src/app/podcast-finder/page.tsx                  the page (client component)
docs/specs/podcast-finder.md                     this spec
```

Two routes rather than one, so the list appears as soon as Apple answers and the
verdicts fill in behind it. Each route exists for a reason the browser cannot
cover: Apple sends no CORS headers worth relying on and rate limits per IP, and
feed hosts have to be read from somewhere that is not the visitor's browser.

## How a verdict is measured

For each feed: sort episode dates newest first, take the median gap between
them, then compare the days since the newest episode with that median.

| Verdict | Condition |
| --- | --- |
| Active | `daysSinceLast <= max(1.5 x medianGap, 14)` |
| Slowing | `daysSinceLast <= max(2.5 x medianGap, 30)` |
| Dormant | `daysSinceLast <= max(6 x medianGap, 180)` |
| Dead | anything later |
| Unknown | no usable dates in the feed |

Feeds are pulled four at a time with a twelve-second timeout each, and a batch
of twenty is allowed sixty seconds of function time. Those numbers come from
measurement: an 1.8 MB, 596-episode feed answered in 3.1 s on its own, so a
shorter timeout turned "slow" into "broken" once feeds shared the connection.

The floors matter: a daily show silent for three weeks is not "slowing", and a
monthly show five weeks after its last episode is not dead. Shows with a single
dated episode fall back to fixed windows (45 / 180 / 365 days) because there is
no rhythm to measure yet.

Alongside the verdict, the app reads the cadence a show claims in its own words
("every Monday", "monthly", "fortnightly") and reports the mismatch when the
measured gap is more than 1.75x the promise, or less than half of it. That
sentence is the app's reason to exist: `Says weekly, actually every ~400 days`.

The direction is kept as data rather than only wording, because the badge beside
the sentence has to say "Schedule promise broken" for a show that slowed down
and something else for one that always published more often than it claimed.

## Code style

```ts
/**
 * Judge whether a show is still publishing from its own rhythm: a monthly show
 * five weeks late is slowing, a daily show five weeks late is finished. Shows
 * with a single episode fall back to fixed windows because there is no rhythm
 * to measure yet.
 */
export function classifyShowHealth(summary: CadenceSummary): ShowHealth { ... }
```

Domain-prefixed names (`summariseEpisodeCadence`, `readClaimedCadence`,
`buildPodcastFeedReport`), JSDoc on every export, no `any`, comments above the
definitions they explain.

## Testing strategy

- Unit (`src/lib/podcast-finder/*.test.ts`): cadence maths and verdict
  thresholds, claim reading and mismatch wording, RSS and Atom extraction
  (CDATA, entities, broken dates, 300-item cap), duration parsing in three
  formats, Apple response parsing with malformed rows, tag and sort rules,
  TTL cache expiry with an injected clock, batch order, failure isolation,
  concurrency ceiling, and the API client's error wording.
- Component (`src/app/podcast-finder/page.test.tsx`): heading and link home,
  example topics, a search that labels a dead show and quotes its broken
  promise, the default filter hiding dormant and dead shows while saying how
  many, unticking it bringing them back, a failed search, a failed feed check
  falling back to Apple's numbers, and a show with no feed URL saying so.
- Live: `node scripts/smoke-live.mjs /podcast-finder "Podcast Finder"` against
  production after the deploy.

Coverage: `src/lib/podcast-finder/**/*.ts` is in the vitest coverage include
list, under the repo's 70% threshold.

## Boundaries

- Always: parse every upstream body with zod or an explicit guard, cap the batch
  at 20 feeds, pull at most 4 at once, cache reports for 10 minutes, name the
  app in the user agent, and answer a sentence for each failure instead of
  failing the batch.
- Ask first: adding a dependency (an XML parser would be one), a database, or
  anything that needs a key.
- Never: claim a show is dead without dates to prove it, fetch a non-http feed
  URL, send the visitor's browser to Apple or to a feed host, or render HTML
  from a feed.

## Success criteria

- `https://scratchpad-ashen.vercel.app/podcast-finder` returns 200 and contains
  the text `Podcast Finder`.
- A search for a topic lists shows with a verdict, a last-episode age, a median
  gap, and a median episode length within a few seconds.
- A show that stopped publishing is tagged Dormant or Dead and hidden by
  default; the count of hidden shows is stated on screen.
- A show whose notes promise a cadence its dates do not support shows the
  mismatch sentence.
- One unreachable feed host does not stop the other results from getting
  verdicts.
- `pnpm run check` is green with the new files included.
- No new npm dependency.

## Open questions

- Should the page remember searches as well as filters? Starting answer: no.
  Filters persist in `localStorage`; a search is something the visitor is doing
  right now.
- Apple's `releaseDate` is not proof of the newest episode. Starting answer:
  label it as Apple's number until the feed answers, which the card already
  does.
- Full-text search inside transcripts would need a key and a different data
  source (Podcast Index, Listen Notes). Out of scope here; the cadence question
  is what was asked for.
