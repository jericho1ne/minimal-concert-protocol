# Story 4: User-requested email notifications

Status: Both `send_show_to_me` and `email_summary` verified end-to-end through MCP Inspector, Resend, and the recipient inbox, including full ticket links. The summary email HTML was subsequently simplified to show one visible ticket URL per show; that display change is covered by local tests.

## Story

As a showgoer, I want to email myself one exciting show or a selected summary containing full ticket links.

## Acceptance Criteria

1. `send_show_to_me(show_id, note?)` sends exactly one show; `email_summary(show_ids)` sends selected shows (maximum 20), each with its full ticket URL.
2. One recipient email is registered per machine and persists across stdio/localhost HTTP processes. Sending tools never accept a recipient argument or silently switch recipients.
3. A generic Notifier interface supports console and Resend adapters, selected through `NOTIFY_BACKENDS`; Resend uses `RESEND_API_KEY` and `EMAIL_FROM`.
4. Email requires a user-initiated request and explicit recipient registration; no mailing-list subscription or Klaviyo double-opt-in flow is required for v1.
5. Handle missing recipient, missing ticket link, provider failure, and duplicate show IDs clearly. Never cache sends.

## Tasks

- Add recipient registration and SQLite persistence.
- Build text/HTML messages with safe escaping, then test console and mocked Resend delivery.
