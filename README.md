# letsgetdown MCP

A TypeScript MCP server for upcoming LA shows from the live Postgres database behind [letsgetdown.io](https://letsgetdown.io). It uses the official MCP SDK, read-only `pg` queries, and a local 12-hour cache. Tool callers cannot supply SQL.

`shows_tonight` has been tested through MCP Inspector against the live database. The other show tools and email delivery still need end-to-end testing. The [live schema](docs/schema-report.md) has been inspected.

## Setup

Requires Node.js 20+.

```sh
npm install
cp .env.example .env
npm run build
```

Set `DATABASE_URL` in `.env` to the read-only Postgres connection string. `.env` is gitignored. `GEMINI_API_KEY` is optional for genre/neighborhood enrichment. For email delivery, set `RESEND_API_KEY` and `EMAIL_FROM` to a verified sender; email has not yet been tested.

The available tools are `shows_tonight`, `search_shows`, `get_show`, `set_my_email`, `send_show_to_me`, and `email_summary`. Results are capped at 20 and use Los Angeles time. The email recipient is registered once per machine, not passed to a send tool.

## Connect

Replace `<repo>` with this repository's absolute path:

```sh
codex mcp add letsgetdown -- node <repo>/dist/index.js
claude mcp add letsgetdown -- node <repo>/dist/index.js
```

For local Streamable HTTP instead, run `node dist/index.js --http` and use `http://127.0.0.1:3000/mcp`. Set `MCP_AUTH_TOKEN` for bearer-token protection.

## Test

```sh
npm run typecheck
npm test
npx @modelcontextprotocol/inspector --cli env DATABASE_SSL_NO_VERIFY=true node dist/index.js --method tools/call --tool-name shows_tonight
```

The last command passes the local-test SSL workaround into Inspector's server process. `DATABASE_SSL_NO_VERIFY=true` disables certificate verification; leave it off when a trusted certificate chain is available. The server also accepts `DATABASE_SSL_NO_VERIFY=true` in `.env`.
