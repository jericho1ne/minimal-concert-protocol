# Story 6: SMS as a later delivery option

Status: Backlog — not part of email-first v1.

## Story

As a showgoer, I may want a short text summary if email is unavailable or less convenient.

## Acceptance Criteria

1. Add `sms_summary` with at most three linked shows and full purchase URLs.
2. Store one phone number per machine, never switch within the same session, and collect explicit SMS consent.
3. Add Klaviyo “Show Alert” event delivery with artist, venue, time, price, and ticket URL; handle Klaviyo's subscription/confirmation requirements.
4. Keep SMS adapters behind the existing Notifier interface and out of the email-first default.
