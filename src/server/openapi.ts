import { createDocument } from 'zod-openapi';
import { z } from 'zod';
import type { Simplify } from 'type-fest';
import { helloQuerySchema } from '@/server/hello-schema';
import { contactFormSchema } from '@/server/contact-schema';
import { feedbackFormSchema } from '@/server/feedback-schema';
import {
  podcastPublisherQuerySchema,
  podcastPublisherResponseSchema,
  podcastSearchQuerySchema,
  podcastSearchResponseSchema,
  podcastStatusBodySchema,
  podcastStatusResponseSchema,
} from '@/server/podcast-schemas';

/**
 * Error envelope shared by every API route. The variants cover the shapes
 * produced by src/lib/errors.ts (validation details) and the route-level
 * guards (rate limit, proof-of-work, honeypot).
 */
export const errorResponseSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
  detail: z.string().optional(),
  challenge: z.string().optional(),
  retryAfter: z.number().optional(),
});

/** Body of a successful GET /api/hello response. */
export const helloResponseSchema = z.object({ message: z.string() });

/** Body of a successful GET /api/challenge response. */
export const challengeResponseSchema = z.object({
  challengeId: z.string(),
  noncePrefix: z.string(),
  difficulty: z.number().int(),
  expiresAt: z.number().int(),
});

/** Body of a successful POST /api/contact response. */
export const contactResponseSchema = z.object({
  ok: z.literal(true),
  delivered: z.enum(['smtp', 'fallback']),
  mailtoUrl: z.string().nullable(),
});

/** Body of a successful POST /api/feedback response. */
export const feedbackResponseSchema = z.object({
  ok: z.literal(true),
  url: z.string().optional(),
  disabled: z.boolean().optional(),
  message: z.string().optional(),
});

/** Body of a successful GET /health response. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
});

const jsonContent = (schema: z.ZodType) => ({
  content: { 'application/json': { schema } },
});

/**
 * OpenAPI 3.1 document for the app's own API routes. Generated from the
 * same zod schemas the routes validate against, so the spec cannot drift
 * from the server. Served at /api/openapi.json and rendered by Swagger UI
 * at /docs. Better Auth's /api/auth/* surface is framework-managed and
 * documented in docs/auth.md instead.
 */
export const openApiDocument: Simplify<ReturnType<typeof createDocument>> = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'Podcast Finder API',
    version: '0.1.0',
    description:
      'Public API of Podcast Finder: search Apple\u2019s podcast directory, then measure what each show\u2019s own feed proves about its publishing rhythm. Form submissions are gated by proof of work, per-IP rate limiting, and a honeypot (see docs/contact.md).',
  },
  servers: [{ url: '/' }],
  paths: {
    '/health': {
      get: {
        summary: 'Liveness check',
        description: 'Load balancers and orchestrators poll this endpoint.',
        responses: {
          '200': { description: 'Service is healthy', ...jsonContent(healthResponseSchema) },
        },
      },
    },
    '/api/hello': {
      get: {
        summary: 'Greet a name',
        description:
          'Demonstrates zod validation at the boundary: bad input never reaches business logic.',
        requestParams: { query: helloQuerySchema },
        responses: {
          '200': { description: 'Greeting', ...jsonContent(helloResponseSchema) },
          '400': { description: 'Invalid query', ...jsonContent(errorResponseSchema) },
        },
      },
    },
    '/api/podcast-search': {
      get: {
        summary: 'Search every podcast directory at once',
        description:
          'Asks Apple\u2019s keyless search, fyyd and the Internet Archive in parallel. The table\u2019s rows are Apple\u2019s first then fyyd\u2019s, with duplicates removed: they carry feeds, so they share the twenty-feed budget the status route can judge. The Archive answers in `archiveItems` instead, because its audio items have no feed to check and belong beside the table rather than in it. A directory that fails is a sentence in `unavailable` rather than a failed search, and the search fails only when neither Apple nor fyyd answers.',
        requestParams: { query: podcastSearchQuerySchema },
        responses: {
          '200': {
            description: 'Shows matching the term, merged from every directory',
            ...jsonContent(podcastSearchResponseSchema),
          },
          '400': { description: 'Missing or invalid term', ...jsonContent(errorResponseSchema) },
          '502': {
            description: 'No directory answered',
            ...jsonContent(errorResponseSchema),
          },
        },
      },
    },
    '/api/publisher-shows': {
      get: {
        summary: 'List every show from one publisher',
        description:
          'Proxies the keyless iTunes lookup endpoint, which answers with every show filed under one publisher\u2019s Apple artist id. The id is the query key rather than the publisher name, because one id can be spelled several ways across its own shows and two publishers can share a name. The response includes one row for the artist itself, which carries no track id and is dropped.',
        requestParams: { query: podcastPublisherQuerySchema },
        responses: {
          '200': {
            description: 'Shows filed under that publisher',
            ...jsonContent(podcastPublisherResponseSchema),
          },
          '400': {
            description: 'Missing or invalid artistId',
            ...jsonContent(errorResponseSchema),
          },
          '502': { description: 'Apple refused or failed', ...jsonContent(errorResponseSchema) },
        },
      },
    },
    '/api/podcast-status': {
      post: {
        summary: 'Measure a batch of podcast feeds',
        description:
          'Pulls up to 20 feeds, four at a time, and answers what each one proves: the verdict (active, slowing, dormant, dead), the median gap between real publication dates, the median episode length, and where the schedule a show claims in its own notes disagrees with the one its dates show. A feed that cannot be read becomes a sentence on that one report rather than a failed batch. Reports are cached in-process for ten minutes.',
        requestBody: {
          content: { 'application/json': { schema: podcastStatusBodySchema } },
        },
        responses: {
          '200': {
            description: 'One report per feed, in request order',
            ...jsonContent(podcastStatusResponseSchema),
          },
          '400': {
            description: 'Body was not JSON, or asked for too many feeds',
            ...jsonContent(errorResponseSchema),
          },
        },
      },
    },
    '/api/challenge': {
      get: {
        summary: 'Issue a proof-of-work challenge',
        description:
          'Clients solve the challenge (sha256(noncePrefix + nonce) with difficulty leading zero hex digits) before submitting contact or feedback. Challenges expire after 5 minutes and are single-use.',
        responses: {
          '200': { description: 'Challenge to solve', ...jsonContent(challengeResponseSchema) },
        },
      },
    },
    '/api/contact': {
      post: {
        summary: 'Submit a contact message',
        description:
          'Validates the form, gates abuse (proof of work + rate limit + honeypot), then delivers by SMTP or answers with a mailto fallback. See docs/contact.md for the full contract.',
        requestBody: {
          content: { 'application/json': { schema: contactFormSchema } },
        },
        responses: {
          '200': { description: 'Message accepted', ...jsonContent(contactResponseSchema) },
          '400': {
            description: 'Validation, honeypot, or proof-of-work failure',
            ...jsonContent(errorResponseSchema),
          },
          '429': { description: 'Rate limited', ...jsonContent(errorResponseSchema) },
        },
      },
    },
    '/api/feedback': {
      post: {
        summary: 'Submit feedback',
        description:
          'Validates the form, gates abuse, then files a labelled GitHub issue when GH_TOKEN/GH_REPO are configured; otherwise answers disabled. See docs/contact.md for the full contract.',
        requestBody: {
          content: { 'application/json': { schema: feedbackFormSchema } },
        },
        responses: {
          '200': { description: 'Feedback accepted', ...jsonContent(feedbackResponseSchema) },
          '400': {
            description: 'Validation, honeypot, or proof-of-work failure',
            ...jsonContent(errorResponseSchema),
          },
          '429': { description: 'Rate limited', ...jsonContent(errorResponseSchema) },
        },
      },
    },
  },
});
