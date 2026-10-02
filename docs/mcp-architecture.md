# Let's Get Down MCP — Architecture

```mermaid
flowchart TB
    USER["You"] --> CLIENT["Claude / Codex<br/>MCP client"]
    CLIENT -->|stdio by default| ENTRY
    CLIENT -.->|optional Streamable HTTP /mcp| ENTRY

    subgraph SERVER["letsgetdown MCP server"]
        ENTRY["Tool interface"]
        READ["Read tools<br/>shows_tonight · search_shows · get_show"]
        EMAIL["Email tools<br/>set_my_email · send_show_to_me · email_summary"]
        SHOWS["ShowService<br/>fixed, parameterized SQL"]
        CACHE[("Local SQLite<br/>show cache + one email per machine")]
        NOTIFIER["Notifier interface<br/>Resend or console"]

        ENTRY --> READ --> SHOWS
        ENTRY --> EMAIL
        EMAIL -->|selected shows re-queried| SHOWS
        EMAIL --> CACHE
        EMAIL --> NOTIFIER
        SHOWS <--> CACHE
    end

    SHOWS -->|read-only DATABASE_URL| PG[("Postgres<br/>Supabase currently; provider-agnostic")]
    WEB["letsgetdown.io"] --> PG
    SHOWS -->|optional genre / neighborhood| GEMINI["Gemini"]
    SHOWS -->|optional uncached neighborhood lookup| MAPBOX["Mapbox Search Box"]
    SHOWS -->|price metadata, when available| TICKETS["Ticket site"]
    NOTIFIER -->|email with full ticket URLs| RESEND["Resend API"]
    RESEND --> INBOX["Saved email inbox"]
```

The normal local transport is stdio. Streamable HTTP is optional; it binds to localhost by default, and `MCP_AUTH_TOKEN` can require a bearer token. A non-local bind requires that token.

The `--http-public` mode registers only the three show-discovery tools. Personal/email tools remain available over local stdio or localhost HTTP, but non-local HTTP cannot run with those tools. Hosted user identity and private per-user storage are still Story 7 work; this diagram shows the current local email flow.

The SQLite cache defaults to a 12-hour TTL. Mapbox Search Box results are used only in responses, not persisted in the cache. Notification backends are selected with `NOTIFY_BACKENDS`; the implemented adapters are `resend` and `console`. SMS, Klaviyo, and ntfy are not part of the current server.
