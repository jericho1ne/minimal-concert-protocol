# Story 5: Transports, setup, and verification

Status: Implemented; Inspector discovery and failure paths passed, live DB-backed calls pending.

## Story

As an integrator, I want the same tools in Claude Code and Codex over stdio or localhost HTTP.

## Acceptance Criteria

1. Serve stdio and Streamable HTTP at `/mcp` from one tool registration factory.
2. Bind HTTP to localhost by default; support optional `MCP_AUTH_TOKEN` bearer checking and reject unexpected origins/hosts.
3. README shows setup, `.env` population, Claude Code/Codex commands, the read-only DB role requirement, and how to run MCP Inspector.
4. Run typecheck, unit tests, and Inspector tool calls; identify any live checks blocked by missing credentials.

## Tasks

- Wire official SDK transports and environment loading.
- Exercise every tool using Inspector once a live DB connection is available.
