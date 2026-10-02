# letsgetdown MCP

A TypeScript MCP server for upcoming shows from the Postgres database behind [letsgetdown.io](https://letsgetdown.io). It uses the official MCP SDK, read-only `pg` queries, and a local cache with a 12-hour default TTL. Tool callers cannot supply SQL.

`shows_tonight` and `search_shows` have been tested through MCP Inspector against the live database. Both email tools have been verified through inbox delivery. See the inspected [database schema](docs/schema-report.md) and [current architecture](docs/mcp-architecture.md).

## Setup

Requires Node.js 20+.

```sh
npm install
cp .env.example .env
npm run build
```

Set `DATABASE_URL` in `.env` to the read-only Postgres connection string. `.env` is gitignored. `GEMINI_API_KEY` is optional for genre/neighborhood enrichment; `MAPBOX_ACCESS_TOKEN` enables an uncached venue-neighborhood fallback in `shows_tonight` and `search_shows`. For email delivery, set `RESEND_API_KEY` and `EMAIL_FROM` to a verified sender.

The fallback uses [Mapbox Search Box](https://docs.mapbox.com/api/search/search-box/) and reads `properties.context.neighborhood.name`. [Mapbox Places address properties](https://docs.mapbox.com/api/search/places/#address-properties) document the analogous `address.neighborhood` field, but this server does not call Places Details.

The available tools are `shows_tonight`, `search_shows`, `get_show`, `set_my_email`, `send_show_to_me`, and `email_summary`. Show lists are capped at 20 and use Los Angeles time. `search_shows` accepts date endpoints at most 31 days apart. It searches the site's show data, which can include venues outside Los Angeles; there is no city boundary filter. The database query fetches at most 100 candidates before neighborhood, genre, and price filtering.

Show data is queried from Postgres on a cache miss, then may be up to 12 hours old by default. Show lists filter out already-started shows at response time. Email sends re-query each selected show before delivery. The email recipient is registered once per machine in local SQLite, not passed to a send tool.

If an `example.com` placeholder was accidentally registered, run `npm run recipient:correct` in a local terminal to replace it once. This repair is not an MCP tool.

## Connect

Replace `<repo>` with this repository's absolute path. Use the same Node binary that installed the dependencies (important for the native SQLite module):

```sh
NODE_BIN="$(command -v node)"
codex mcp add letsgetdown --env DATABASE_SSL_NO_VERIFY=true -- "$NODE_BIN" <repo>/dist/index.js
claude mcp add --scope user letsgetdown -- env DATABASE_SSL_NO_VERIFY=true "$NODE_BIN" <repo>/dist/index.js
```

Run `codex mcp list` or `claude mcp list` to confirm registration, then ask either client: “What shows are playing in Hollywood tonight?” The SSL setting is the local Supabase certificate workaround; remove it once certificate verification works normally.

For local Streamable HTTP instead, run `node dist/index.js --http` and use `http://127.0.0.1:3000/mcp`. Set `MCP_AUTH_TOKEN` for bearer-token protection.

## Test

```sh
npm run typecheck
npm test
npx @modelcontextprotocol/inspector --cli env DATABASE_SSL_NO_VERIFY=true node dist/index.js --method tools/call --tool-name shows_tonight
```

The last command passes the local-test SSL workaround into Inspector's server process. `DATABASE_SSL_NO_VERIFY=true` disables certificate verification; leave it off when a trusted certificate chain is available. The server also accepts `DATABASE_SSL_NO_VERIFY=true` in `.env`.

## Available Tools

| Tool | Inputs | What it does |
| --- | --- | --- |
| `shows_tonight` | Optional: `neighborhood` (string) | Lists up to 20 upcoming shows on the current Los Angeles calendar date. |
| `search_shows` | Required: `start_date`, `end_date` (strings). Optional: `genre`, `neighborhood` (strings); `max_price` (number). | Finds up to 20 upcoming shows in the site's data within an inclusive date range. Shows with unknown prices remain included when `max_price` is set. |
| `get_show` | Required: `show_id` (UUID string) | Gets details for one show. |
| `set_my_email` | Required: `email` (string) | Registers one email address on this machine for the email tools. Does not send mail. |
| `send_show_to_me` | Required: `show_id` (string). Optional: `note` (string). | Emails one upcoming show with its full ticket-purchase URL. Requires `set_my_email` first. |
| `email_summary` | Required: `show_ids` (array of 1–20 strings). | Emails a summary of selected upcoming shows, each with a full ticket-purchase URL. Requires `set_my_email` first. |
