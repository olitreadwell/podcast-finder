## Podcast Finder

Search shows about a topic and see which ones still publish, measured from their own feeds.

![Podcast Finder](/portfolio/podcast-finder.png)

- [Live](https://scratchpad-ashen.vercel.app/podcast-finder)
- Built on [iTunes Search](https://performance-partners.apple.com/search-api), no API key
- Tags: api, podcasts, rss, search
- Shipped: 2026-09-24

Directory pages repeat whatever the show notes claimed when the show launched, so a podcast can promise monthly episodes for years after it stopped. Apple's keyless search API answers what shows exist and hands over each feed URL; the app then pulls the feed, measures the median gap between publication dates, and tells a dormant show apart from a quiet week. Apple caps its own episode counts at 200 and dates its newest episode loosely, so only the feed settles whether a show is alive.

