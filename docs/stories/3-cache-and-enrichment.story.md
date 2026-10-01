# Story 3: Cache and enrich discovery

Status: Implemented locally; live enrichment quality and cache behavior pending verification.

## Story

As the maintainer, I want a live first lookup and reusable local results so similar questions do not repeatedly hit Postgres or enrichment services.

## Acceptance Criteria

1. The first call for a unique key reads live Postgres; subsequent equivalent calls reuse a persistent SQLite entry for 12 hours by default.
2. Keys include tool name and canonicalized filters; `shows_tonight` includes the LA calendar date. Do not merge overlapping but nonidentical date ranges.
3. Strip already-past shows when reading cached results, even before TTL expires; never cache notification sends.
4. Where fields are absent, optionally enrich genre/neighborhood using Gemini Flash and price from a public ticket page when a reliable explicit amount is present. Unknown stays unknown.
5. Provide `CACHE_TTL_HOURS` and `CACHE_DB_PATH` configuration.

## Tasks

- Build the canonical cache-key and SQLite adapter.
- Bound network fetches and test normalization, expiry, midnight rollover, and unknown-price behavior.
