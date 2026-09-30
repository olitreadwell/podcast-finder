// Request and response schemas for the two podcast routes.
//
// The routes validate with these and the OpenAPI document is generated from
// them, so /docs cannot describe a shape the server does not answer.

import { z } from 'zod';

import { MAX_FEEDS_PER_REQUEST } from '@/lib/podcast-finder/feed-report';
import { ITUNES_MAX_LIMIT } from '@/lib/podcast-finder/itunes-search';

/** Query string the Apple search adapter accepts. */
export const podcastSearchQuerySchema = z.object({
  term: z.string().trim().min(2, 'Search needs at least two characters.').max(120),
  country: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  genreId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(ITUNES_MAX_LIMIT).optional(),
});

/** One show as the search route serialises it. */
export const podcastShowSchema = z.object({
  appleId: z.number().int(),
  title: z.string(),
  publisher: z.string(),
  artistId: z.number().int().nullable(),
  feedUrl: z.string().nullable(),
  genres: z.array(z.string()),
  country: z.string(),
  artworkUrl: z.string().nullable(),
  appleUrl: z.string(),
  episodeCount: z.number().int().nullable(),
  latestReleaseAt: z.string().nullable(),
  explicit: z.boolean(),
});

/** Body of a successful GET /api/podcast-search response. */
export const podcastSearchResponseSchema = z.object({ shows: z.array(podcastShowSchema) });

/** Query string the publisher lookup route accepts. */
export const podcastPublisherQuerySchema = z.object({
  artistId: z.coerce.number().int().positive(),
  country: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
});

/** Body of a successful GET /api/publisher-shows response. */
export const podcastPublisherResponseSchema = z.object({ shows: z.array(podcastShowSchema) });

/** Body of a POST /api/podcast-status request. */
export const podcastStatusBodySchema = z.object({
  feeds: z.array(z.string().min(1).max(2048)).min(1).max(MAX_FEEDS_PER_REQUEST),
});

/** Verdict on whether a show still publishes. */
export const podcastHealthSchema = z.enum(['active', 'slowing', 'dormant', 'dead', 'unknown']);

/** Cadence numbers as the status route serialises them. */
export const podcastCadenceSchema = z.object({
  datedEpisodeCount: z.number().int(),
  lastEpisodeAt: z.string().nullable(),
  daysSinceLastEpisode: z.number().nullable(),
  medianGapDays: z.number().nullable(),
  gapSpreadDays: z.number().nullable(),
  episodesInLast30Days: z.number().int(),
  episodesInLast90Days: z.number().int(),
  episodesInLast365Days: z.number().int(),
  medianDurationSeconds: z.number().nullable(),
  monthlyReleaseCounts: z.array(z.number().int()),
});

/** The schedule a show claims in its own show notes. */
export const podcastCadenceClaimSchema = z.object({
  label: z.string(),
  expectedGapDays: z.number(),
  phrase: z.string(),
});

/** A promise the feed contradicts, and which way it leans. */
export const podcastCadenceMismatchSchema = z.object({
  direction: z.enum(['slower', 'faster']),
  sentence: z.string(),
});

/** What the status route proves about one feed. */
export const podcastFeedReportSchema = z.object({
  feedUrl: z.string(),
  ok: z.boolean(),
  reason: z.string().nullable(),
  feedTitle: z.string().nullable(),
  description: z.string().nullable(),
  latestEpisodeTitle: z.string().nullable(),
  health: podcastHealthSchema.nullable(),
  claim: podcastCadenceClaimSchema.nullable(),
  claimMismatch: podcastCadenceMismatchSchema.nullable(),
  cadence: podcastCadenceSchema.nullable(),
});

/** Body of a successful POST /api/podcast-status response. */
export const podcastStatusResponseSchema = z.object({ reports: z.array(podcastFeedReportSchema) });
