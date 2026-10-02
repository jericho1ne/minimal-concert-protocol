# letsgetdown MCP

An MCP server for upcoming shows from [letsgetdown.io](https://letsgetdown.io). See the [architecture](docs/mcp-architecture.md).

## Setup

Requires Node.js 20+.

```sh
npm install
cp .env.example .env
npm run build
```

In `.env`, set:
- `DATABASE_URL` (read-only Postgres connection string).

## Connect

```sh
npm run add-claude-mcp
```

This registers the built server with Claude Code. It includes `DATABASE_SSL_NO_VERIFY=true`, a local Supabase certificate workaround

## Tools

| Tool | Inputs | What it does |
| --- | --- | --- |
| `shows_tonight` | Optional: `neighborhood` | Lists up to 20 upcoming shows tonight (LA time). |
| `search_shows` | Required: `start_date`, `end_date`. Optional: `genre`, `neighborhood`, `max_price` | Finds up to 20 upcoming shows in a date range of up to 31 days. |
| `get_show` | Required: `show_id` | Gets details for one show. |
| `weekend_neighborhoods` | None | Ranks neighborhoods by upcoming shows this Friday–Sunday (LA time). Requires `MAPBOX_ACCESS_TOKEN`. |
| `set_my_email` | Required: `email` | Registers the email address used by the email tools. |
| `send_show_to_me` | Required: `show_id`. Optional: `note` | Emails one show with its ticket URL. |
| `email_summary` | Required: `show_ids` (1–20) | Emails a summary of selected shows with ticket URLs. |

## Implementation details

The fallback uses [Mapbox Search Box](https://docs.mapbox.com/api/search/search-box/) and reads `properties.context.neighborhood.name`. [Mapbox Places address properties](https://docs.mapbox.com/api/search/places/#address-properties) document the analogous `address.neighborhood` field, but this server does not call Places Details.
