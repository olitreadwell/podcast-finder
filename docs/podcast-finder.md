# Spec: Podcast Finder

Built by hand on three keyless directories — Apple's **iTunes Search**
(https://performance-partners.apple.com/search-api), fyyd, and the Internet
Archive. One request asks all three and answers one merged table.

## Objective

Search for shows about a topic, then find out which of them are actually still
publishing. Podcast directories repeat the schedule a publisher wrote into the
show notes when the show launched, so a page can promise "new episodes monthly"
for years after the last episode shipped. The listener only finds out after
subscribing and waiting.

The audience is one person with a topic in mind and no patience for dead feeds.
Success is that a search answers in a few seconds (the slowest directory sets
the wait), that every result carries a verdict measured from the show's own
feed, and that a show which has stopped publishing is labelled and hidden by
default rather than buried in a list of plausible-looking rows.

## Tech stack

Next.js 16 App Router, React 19, TypeScript, Tailwind 4, zod at every boundary,
Vitest with Testing Library. No new dependencies: the RSS reader is a small
targeted extractor, not a general XML parser.

APIs:

- `GET https://itunes.apple.com/search?term=&media=podcast&entity=podcast` —
  keyless, rate limited per IP, no useful CORS headers. Returns show metadata:
  title, publisher, `artistId`, `feedUrl`, genres, artwork, storefront,
  `trackCount`, and a `releaseDate` that loosely tracks the newest episode.
- `GET https://itunes.apple.com/lookup?id=&entity=podcast` — the same
  directory, keyed by the publisher's `artistId` rather than by words. Answers
  every show filed under one publisher, ahead of which Apple puts one row for
  the artist itself. That row carries no `trackId` and the parser drops it.
  It also takes a comma-separated id list, which is how one batched lookup fills
  the feeds in for a whole page of rows.
- `GET https://api.fyyd.de/0.2/search/podcast?term=&count=&page=0` — a second
  directory, run independently of Apple, with an open API and no key. Its rows
  carry the feed URL. It answers in anywhere between 1.5 s and 8.3 s depending
  on the term (measured 2026-09-30), so it is cut off at ten seconds: the merged
  search waits for every directory, and a cap below that cost the second
  directory on half the searches.
- `GET https://archive.org/advancedsearch.php` — audio in the Archive's
  podcasts collection. No feed, so nothing from here can be judged.
- Each show's own RSS or Atom feed, fetched server-side for episode `pubDate`s
  and `<itunes:duration>` values.

## Commands

```bash
pnpm dev                                        # http://localhost:3000
pnpm test                                       # vitest, fast loop
pnpm run check                                  # the repo gate
pnpm run smoke                       # boots the built server and curls every route
```

## Project structure

```
src/lib/podcast-finder/episode-cadence.ts        gaps, health verdict, formatting
src/lib/podcast-finder/cadence-claim.ts          the schedule a show claims vs the one it keeps
src/lib/podcast-finder/feed-analysis.ts          feed fetch, RSS/Atom extraction
src/lib/podcast-finder/feed-report.ts            one JSON-safe report per feed, batched
src/lib/podcast-finder/itunes-search.ts          Apple search URL, response parsing, wire shapes
src/lib/podcast-finder/show-tags.ts              tags, facts, sorting
src/lib/podcast-finder/publisher-shows.ts        grouping shows by publisher
src/lib/podcast-finder/search-query.ts           the search box's query language
src/lib/podcast-finder/directory-search.ts       one search across every directory, merged
src/lib/podcast-finder/directory-mix.ts          which directories answered, and how to say so
src/lib/podcast-finder/show-table.ts             one render-ready row per show, and column sorting
src/lib/podcast-finder/fyyd-search.ts            the second directory
src/lib/podcast-finder/archive-search.ts         the Internet Archive, listed but not judged
src/lib/podcast-finder/api-client.ts             the browser's calls
src/lib/podcast-finder/analysis-cache.ts         ten-minute TTL cache for feed reports
src/server/podcast-schemas.ts                    request and response schemas for every podcast route
src/app/api/podcast-search/route.ts              the merged search adapter
src/app/api/podcast-status/route.ts              feed status adapter (batched, cached, capped)
src/app/api/publisher-shows/route.ts             publisher catalogue adapter
src/app/page.tsx                                 the page (client component)
docs/podcast-finder.md                           this spec
```

Search and verdicts are two routes, so the table appears as soon as the
directories answer and the verdicts fill in behind it. Each route exists for a
reason the browser cannot cover: Apple sends no CORS headers worth relying on
and rate limits per IP, and feed hosts have to be read from somewhere that is
not the visitor's browser.

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

## Where the shows come from

Three directories answer one question each, all at once, and only the first two
become rows:

| Directory | What it answers | Where it lands |
| --- | --- | --- |
| Apple search | shows about a topic, with the richest metadata | thirty rows in the table, feeds and all |
| fyyd | shows about a topic, independently of Apple | twenty rows in the table, feeds and all |
| Internet Archive | audio items about a topic | extra reading below the table, never a row |

There is no Source select: the page asks one question and every directory
answers it. The route runs the three searches in parallel, merges Apple's and
fyyd's rows with Apple's first and duplicates removed on the feed URL (falling
back to title and publisher when a row has no feed), and answers the Archive's
items separately in `archiveItems`. A directory that fails does not fail the
search: its sentence comes back in `unavailable` and the page says so above the
table. Only when neither Apple nor fyyd answers is the search an error.

Every row is normalised to the same `PodcastShow`, which is what keeps one
table, one sort and one verdict machinery serving both directories. A row
carries its `source` and a `sourceKey` unique inside that directory; the source
key is what React keys on and what the verdict index is keyed by, so two
directories can never collide in one table.

The status route judges twenty feeds per request, and a page of fifty rows is
more than that, so the page walks the list twenty at a time and draws each
batch as it lands. Verdicts arrive in waves; the live region counts them out
loud rather than leaving the table looking half-finished. The sentence above the
table counts what each directory actually contributed after the merge, so the
numbers add up to the rows underneath them.

The Archive is the honest exception, and the reason it is not in the table. It
holds audio items rather than shows, with no feed, so nothing from there can be
checked and its titles are frequently unrelated to the words that found them.
Putting those in a table of measured shows would be padding. They are listed
under the table instead, as links, with a sentence saying what they are. The
Archive query is still built by reducing the visitor's term to letters, numbers,
spaces, apostrophes and hyphens, because the term is interpolated into a query
language and a visitor should not be able to edit the query we send.

## Following a publisher

Each row's publisher name is a button. The first click filters the rows already
on screen, which costs nothing, and says how many of them matched. The bar that
appears offers a second, explicit step: list everything that publisher has ever
filed with Apple, which is one more call to the lookup endpoint.

Grouping is by Apple's `artistId`, never by the publisher's name. One artist id
spells itself several ways across its own shows ("NPR" beside "NPR News"), and
two unrelated publishers can share a name, so matching on the string would split
one publisher and merge two. When Apple sends no `artistId` the name is the
fallback key.

The catalogue view runs the same feed analysis as a search, so a publisher's
dead shows are labelled the same way. Two limits are stated rather than hidden:
a small publisher has few shows, and some networks are filed under more than one
artist id, so the page reports the count it found instead of claiming to be
complete.

## Filtering the results

One box both searches and filters. The words go to the directories, and the same
parsed query narrows the rows that come back, so the box says one thing and the
table shows it. When the query removes rows the status line says how many of how
many matched; when nothing is removed there is nothing to explain.

Fields that name a fixed vocabulary rather than a topic (`verdict`,
`language`, `country`) are matched locally and never sent as search words, so
`science language:en` asks the directories about science and then keeps the rows
that declare English, instead of asking for shows about `science en`.

Nothing in the query fetches: every number it compares came from the feed
reports the page asked for anyway. A bare term is matched across the title,
publisher, genres, the feed's own description and its newest episode title,
because a directory matches more than the fields it hands back and a topic word
that only appears in the show notes should not be filtered out of a result the
directory rightly returned.

- `AND`, `OR` and `NOT`, with brackets. Two terms side by side mean `AND`, and
  precedence runs `NOT`, then `AND`, then `OR`.
- Quotes for a phrase, so `publisher:"Pipe Media"` is one value and a show
  titled `and` can still be found.
- Fields: `title`, `publisher`, `genre`, `country`, `language`, `verdict`. A
  term with no field searches the text named above.
- Numbers: `gap`, `last`, `episodes`, `length` and `releases`, compared with
  `>`, `<`, `>=`, `<=` or `=`, written `gap>30` or `gap:>30`. The values come
  from the median gap, the days since the newest episode, the count of dated
  episodes, the median episode length in minutes, and the releases across the
  feed's year of monthly bars, so `length>45` reads the way a listener thinks
  about a commute and `releases<2` finds the shows that barely publish.
- A `language:` term and a `length` number both need an answered feed, because
  the feed is what declares a language and what measures an episode. The
  language is reduced to its primary subtag (`en-GB` becomes `en`), which is
  the granularity a filter can actually use.
- `*` for any run of characters and `?` for one. Everything else is literal.

Raw regular expressions are deliberately not accepted. A pasted pattern can
backtrack forever on one line of a feed title, and there is nothing to gain:
wildcards cover the shapes people actually type. The parser and the matcher are
hand-written for the same reason the RSS reader is, which keeps the app at no
new dependency and lets an error name the field that was misspelled instead of
saying "syntax error".

A numeric term needs an answered feed, so a show whose report has not arrived
does not match `gap>30` rather than matching by accident. The box is not saved
with the other filters in `localStorage`: a query answers a question the visitor
asked at the time, and a restored one looks like a bug. The storefront, genre,
sort and hide-stale filter are saved.

## The results table

Rows are shows; columns are the things a listener compares. Every measured
column sorts by clicking its header, and the header says which way it is running
(`aria-sort`, plus an arrow). The columns are:

| Column | Sorts on | Comes from |
| --- | --- | --- |
| Show | title | the directory, with the publisher, genres and storefront beneath it |
| Verdict | best condition first | the feed: active, slowing, dormant or dead, plus its exception badges |
| Language | the declared language | the feed only; "not known" before one answers |
| Last episode | age of the newest episode | the feed, falling back to the directory's own date until it answers |
| Usual gap | median gap in days | the feed only; "not measured" before one answers |
| Episodes | count | the feed's dated episodes, or the directory's catalogue count, named with whose it is |
| Typical length | median episode length | the feed only |
| Releases a month | releases across the twelve bars | the feed's year of monthly counts |

An unmeasured cell sorts last whichever way the column runs, so flipping a sort
never floats the rows whose feeds have not answered to the top of a column they
have no number for. Each number carries a bar drawn against the largest value in
the same column, which makes a column readable as a shape; the number beside it
is what a screen reader gets.

Sorting is client-side over the rows already on screen: `sortPodcastTableRows`
never refetches, and a row's sort value is the same number the cell displays.
The sort column and direction are saved with the other filters.

Sorting and filtering are independent and compose: `length<30` narrows the rows
to short episodes while a click on Last episode still decides their order. Every
column that holds a measurement has both a sort and a way to filter it through
the box, which is the point of keeping one query language rather than a row of
per-column inputs.

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

- Unit (`src/lib/podcast-finder/*.test.ts`): the merge across every directory
  (order, deduplication, counting, a directory that fails), fyyd and Archive
  mapping (including a term that tries to edit the Archive query), query parsing
  and matching
  (precedence, quotes, fields, wildcards, numeric comparisons, unanswered
  feeds), cadence maths and verdict
  thresholds, claim reading and mismatch wording, RSS and Atom extraction
  (CDATA, entities, broken dates, 300-item cap), duration parsing in three
  formats, Apple response parsing with malformed rows, tag rules, table rows and
  every column sort (including rows with nothing to compare),
  TTL cache expiry with an injected clock, batch order, failure isolation,
  concurrency ceiling, and the API client's error wording.
- Component (`src/app/page.test.tsx`): heading and link home,
  example topics, a search that labels a dead show and quotes its broken
  promise, the default filter hiding dormant and dead shows while saying how
  many, unticking it bringing them back, sorting by a column header, filtering
  with a query in the same box, a query that cannot be parsed keeping the rows,
  a merged search naming where the rows came from and which directory did not
  answer, a failed search, a failed feed check falling back to the directories'
  numbers, and a show with no feed URL saying so.
- Live: `pnpm run smoke` locally, plus a manual search against production after
  the deploy.

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

- `https://podcast-finder-ruby.vercel.app` returns 200 and contains the text
  `Podcast Finder`.
- A search for a topic lists rows with a verdict, a last-episode age, a median
  gap, and a median episode length within a few seconds, drawn from every
  directory that answered.
- Clicking a column header sorts the table by that column and says so with
  `aria-sort`; a row with nothing measured stays last either way.
- A show that stopped publishing is tagged Dormant or Dead and hidden by
  default; the count of hidden shows is stated on screen.
- A show whose notes promise a cadence its dates do not support shows the
  mismatch sentence.
- One unreachable feed host does not stop the other results from getting
  verdicts.
- A publisher name on a row can be clicked to narrow the table, and the full
  catalogue behind it can be listed without leaving the page.
- The search box narrows the loaded rows as well as searching, and a query it cannot parse is
  explained rather than silently returning nothing.
- One search returns rows from Apple, fyyd and the Internet Archive, and the
  Archive's rows say plainly they cannot be checked.
- `pnpm run check` is green with the new files included.
- No new npm dependency.

## Open questions

- Should the page remember searches as well as filters? Starting answer: no.
  Filters persist in `localStorage`; a search is something the visitor is doing
  right now.
- Apple's `releaseDate` is not proof of the newest episode. Starting answer:
  label it as the directory's number until the feed answers, which the table already
  does.
- Full-text search inside transcripts would need a key and a different data
  source (Podcast Index, Listen Notes). Out of scope here; the cadence question
  is what was asked for.
