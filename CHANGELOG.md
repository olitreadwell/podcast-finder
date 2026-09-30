# Changelog

All notable changes documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Podcast Finder carved out of the scratchpad monorepo: Apple directory
  search, per-feed cadence analysis, verdicts, and the two API routes, now
  served from the app root in its own repo.
- Starter template skeleton: Next.js, TS strict, Tailwind 4, Vitest,
  Playwright, ESLint 9, Prettier, husky, Docker, CI.

### Changed

- Imports use extensionless specifiers and satisfy
  `noUncheckedIndexedAccess`, matching the template's TypeScript settings.
