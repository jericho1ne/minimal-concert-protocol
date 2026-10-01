# Story 1: Live schema and server scaffold

Status: Live schema inspected through the read-only `DATABASE_URL`; scaffold complete.

## Story

As the maintainer, I want the exact current show schema inspected before query design so the MCP server answers from upcoming live data.

## Acceptance Criteria

1. Connect to the Supabase database using the configured read-only `DATABASE_URL`.
2. Record the live columns, types, keys, and relationships for shows, venues, and artists (or confirm that artists is embedded in shows).
3. Verify the fixed discovery query against the live schema before declaring the discovery tools production-ready.
4. Scaffold a TypeScript server on the official MCP SDK; use a standard Postgres driver, never a vendor database SDK.
5. Commit `.env.example` with placeholder keys and ignore `.env` and local cache files.

## Tasks

- Use the configured read-only Postgres connection to inspect tables and foreign keys, and update the schema report.
- Configure TypeScript, npm scripts, environment loading, and tests.

## Notes

The live database contains `public.liveshows` and `public.venues`, with `artist` stored as text on `liveshows`. See [the live schema report](../schema-report.md).
