# Story 7: Hosted MCP with isolated user data

Status: In progress — discovery-only HTTP mode implemented and unit-tested; no hosted deployment, OAuth, or database changes yet.

## Story

As a showgoer using a shared hosted MCP endpoint, I want my saved email, future phone number, and notification preferences kept separate from everyone else's, so another user cannot overwrite them or send messages as me.

## Acceptance Criteria

1. Offer a public HTTPS MCP endpoint for read-only show discovery. Personal-data and send tools require a verified, per-user identity; the current single `MCP_AUTH_TOKEN` is not sufficient for those tools on a shared server.
2. Use an MCP-compatible authorization flow for hosted clients. Derive the stable user ID from a validated credential on **each request**, never from a tool argument, an unverified header, or an MCP transport session ID. Reject unauthenticated personal-tool calls before they reach a handler.
3. Store personal settings under that user ID, potentially in the existing Supabase Postgres database. If we preserve “one recipient per machine,” use a separate installation identity *owned by* the authenticated user; do not use one global `settings.email` row. A caller must not be able to choose or spoof another user's installation ID.
4. Give personal-data writes a separate, least-privileged database role; keep the existing show-reader `DATABASE_URL` read-only. Scope every personal-data query to the verified owner and add database-level protections where practical. Never expose database credentials or provider API keys to MCP clients.
5. Keep shared show-result caching separate from private settings. Never cache a send operation or return another user's email, phone, notes, or delivery history.
6. Test two users concurrently: each can register a different recipient, restart/reconnect, and send only to their own recipient. Verify cross-user reads/writes, spoofed identifiers, and anonymous sends fail. Include rate limits and safe audit logging before public launch.

## Tasks

- Choose the hosted identity provider and verify client support for its authorization flow.
- Design the per-user (and, if needed, per-installation) persistence schema and migration in Supabase Postgres.
- Keep the implemented `--http-public` discovery-only mode free of personal tools. Next, separate authenticated notification handlers while preserving the current local-only behavior.
- Add isolation/security tests, then deploy and document the hosted HTTPS endpoint.

## Note

This is account isolation, not reliance on a long-lived MCP protocol session. Current MCP guidance describes a stateless core and authorization on each protected HTTP request: [2026 specification overview](https://blog.modelcontextprotocol.io/posts/2026-07-28/) and [authorization guidance](https://apps.extensions.modelcontextprotocol.io/api/documents/authorization.html).
