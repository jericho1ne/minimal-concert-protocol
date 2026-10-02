# Let's Get Down MCP — Architecture

```mermaid
flowchart TB
    CLIENT["Claude / Codex"] -->|stdio, or HTTP /mcp| TOOLS

    subgraph SERVER["letsgetdown MCP server"]
        TOOLS["7 tools<br/>4 read · 3 email"]
        SHOWS["ShowService<br/>+ SQLite cache"]
        NOTIFY["Notifier<br/>Resend or console"]
        TOOLS --> SHOWS --> NOTIFY
    end

    SHOWS -->|read-only| PG[("Postgres<br/>Supabase")]
    SHOWS -.->|optional| APIS["Mapbox SearchBox<br/>Places API"]
    NOTIFY --> INBOX["Resend →<br/>your inbox"]
```

- **Transport:** stdio by default. HTTP binds to localhost; a non-local bind requires `MCP_AUTH_TOKEN`.
- **`--http-public`:** only the 4 read tools. Email tools stay local-only until Story 7 adds per-user identity.
- **SQLite:** show cache (12-hour TTL) plus the one saved email per machine.
- **Mapbox SearchBox Places API:** venue neighborhoods for `weekend_neighborhoods`, never cached.
- **Not built yet:** SMS, Klaviyo, ntfy.
