# Podcast Finder

[![CI](https://github.com/olitreadwell/podcast-finder/actions/workflows/ci.yml/badge.svg)](https://github.com/olitreadwell/podcast-finder/actions/workflows/ci.yml)

Find shows about a topic, then see whether they still publish. Search comes
from Apple's keyless iTunes Search API; every verdict comes from the show's own
RSS or Atom feed, so a page promising monthly episodes since 2019 is labelled
for what it is.

- **A verdict per show** — active, slowing, dormant or dead, measured from the
  median gap between real publication dates rather than the schedule the show
  claims.
- **The numbers behind it** — median gap, median episode length, episodes in
  the last 90 days, and a year of monthly release counts.
- **Broken promises** — when a show says "weekly" and its own dates say every
  28 days, the card says so.
- **A filter that explains itself** — `AND`, `OR`, `NOT`, brackets, quotes,
  fields (`title:`, `verdict:`) and numbers (`gap>30`), with a sentence when a
  query cannot be parsed.
- **Honest failures** — a feed that cannot be read becomes a sentence on that
  one card, never a failed batch.

Stale shows are hidden by default, with the count kept on screen.

## How it works

Two routes, so the list renders as soon as Apple answers and verdicts fill in
behind it:

- `GET /api/podcast-search` proxies Apple. The search API is keyless and rate
  limits per IP, and its CORS headers are not usable, so the browser never
  calls Apple directly.
- `POST /api/podcast-status` pulls up to 20 feeds, four at a time, with a 12 s
  timeout each, and caches reports in-process for 10 minutes.

The spec of record is [docs/podcast-finder.md](docs/podcast-finder.md).

## Quick start

```bash
pnpm install
pnpm run dev        # http://localhost:3000
```

Built on the [olitreadwell/template](https://github.com/olitreadwell/template)
baseline: quality gates, automation, and docs wired in from day one.

## Commands

| Command | Purpose | CI gate |
| --- | --- | --- |
| `pnpm run dev` | Dev server | |
| `pnpm run build` | Production build | Blocking |
| `pnpm run typecheck` | `tsc --noEmit` | Blocking |
| `pnpm run lint` | ESLint | Blocking |
| `pnpm run format:check` | Prettier check | Blocking |
| `pnpm test` | Vitest unit/component | Blocking |
| `pnpm run test:coverage` | Coverage gate | Blocking |
| `pnpm run test:e2e` | Playwright | Blocking |
| `pnpm run test:a11y` | axe route audit (WCAG 2.2 A/AA) | Blocking (in e2e) |
| `pnpm run perf` | Lighthouse budgets (local) | Blocking |
| `pnpm run smoke` | Boot + curl routes | Blocking |
| `pnpm run check:links` | Internal link integrity | Blocking |
| **`pnpm run check`** | All of the above | Mirrored 1:1 |
| `pnpm run audit` | Dependency audit | Advisory |

## Quality gates (CI)

- **CI** — `pnpm run check` mirrored 1:1 (format, lint, typecheck,
  coverage, setup, build, smoke, e2e incl. axe, links).
- **Code review** — `alibaba/open-code-review` on every PR (deterministic
  rules; LLM-assisted when `LLM_API_KEY` is set). See
  [docs/audits.md](docs/audits.md).
- **Security** — blocking `pnpm audit` (high/critical) + committed-secret
  scan. See [docs/contributing/06-security.md](docs/contributing/06-security.md).
- **Quality** — Lighthouse budgets (a11y ≥ 0.95, perf/SEO ≥ 0.90,
  best-practices ≥ 0.95, FCP/LCP/TBT/CLS budgets) via
  `treosh/lighthouse-ci-action`.
- **Accessibility** — axe on every route (A/AA + best practice) in e2e,
  plus a documented manual AAA pass in [docs/a11y.md](docs/a11y.md).
- **Cost & speed** — path-aware triggers, `[skip ci]` token, in-flight
  cancellation, Docker layer caching, sharded e2e, 3-day artifact
  retention, local pre-push audit. See
  [docs/ci-optimization.md](docs/ci-optimization.md).

## Contact, feedback, help

- [Help center / FAQ](/help) — answers, plus how to reach a human
- [Contact](/contact) — validated, rate-limited form to the project inbox
- [Report feedback](/feedback) — files a labelled GitHub issue with full
  context (browser, page, repro steps)

Abuse protection (proof of work + per-IP rate limit + honeypot) is on by
default. The contract is documented in [docs/contact.md](docs/contact.md)
and published machine-readably at `/.well-known/feedback.json`.

## API

- OpenAPI 3.1 spec: `/api/openapi.json` (generated from the zod schemas)
- Swagger UI: `/docs`
- A contract test keeps the spec and the running server in agreement; see
  [docs/api.md](docs/api.md)

## Tech stack

- Next.js App Router, React 19, TypeScript strict
- Tailwind CSS 4 + Radix UI primitives in `src/components/ui`
- Passwordless auth: Better Auth email OTP (`/login`, SQLite + Drizzle)
- Vitest + Testing Library + vitest-axe; Playwright e2e
- pnpm (lockfile committed, frozen installs in CI); ESLint 9 flat config +
  Prettier; husky pre-commit/pre-push
- Zod validation at the boundary, pino structured logs, centralized errors
- OpenAPI 3.1 + Swagger UI at `/docs`, contract-tested; type-fest types
- Multi-stage Dockerfile with `HEALTHCHECK` on `/health`
- PWA manifest + production-only service worker, `llms.txt` for AI
  crawlers, hreflang (`en`/`x-default`) declared in the root layout

## Documentation

- [Podcast Finder spec](docs/podcast-finder.md)
- [Onboarding](docs/onboarding.md)
- [Engineering standards](docs/engineering.md)
- [Style guide](docs/style-guide.md)
- [LLM-agent-optimized writing](docs/llm-agent-optimization.md)
- [Testing guide](docs/testing.md)
- [Deployment](docs/deploy.md)
- [Philosophy](docs/philosophy.md)
- [FAQ](docs/faq.md)
- [Contact & feedback mechanisms](docs/contact.md)
- [API contract](docs/api.md)
- [Accessibility policy](docs/a11y.md)
- [Passwordless auth](docs/auth.md)
- [Audit gates](docs/audits.md)
- [CI cost & speed](docs/ci-optimization.md)
- [Contributing guide](docs/contributing/00-index.md)

## Agent-first repo

`AGENTS.md` + `CLAUDE.md` tell AI agents exactly how this repo works, what
the quality bar is, and how to verify changes. See
[docs/llm-agent-optimization.md](docs/llm-agent-optimization.md) for why the
repo is written the way it is.
