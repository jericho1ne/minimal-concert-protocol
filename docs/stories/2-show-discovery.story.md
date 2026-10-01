# Story 2: Read-only show discovery

Status: `shows_tonight` and `search_shows` verified through MCP Inspector against live Postgres; `get_show` still pending.

## Story

As a showgoer, I want to search upcoming LA shows and inspect one show so I can decide what to attend.

## Acceptance Criteria

1. Expose `search_shows(start_date, end_date, neighborhood?, genre?, max_price?)`, `shows_tonight(neighborhood?)`, and `get_show(show_id)` as MCP tools.
2. Use fixed, parameterized SQL against a read-only `DATABASE_URL`; no model-generated SQL and no Supabase/Neon client SDK.
3. Treat dates and “tonight” in `America/Los_Angeles`; omit past shows and cap lists at 20.
4. Emit compact lines such as `Fri 10/2, 9pm, Artist @ Venue, Echo Park, $20, https://...`, plus a `show_id` for follow-up tools; mark missing values unknown rather than inventing them.
5. Support Supabase transaction-pooler URLs without named prepared statements.

## Tasks

- Implement database access and query validation.
- Cover timezone boundaries, empty results, invalid input, and SQL injection attempts in tests.
