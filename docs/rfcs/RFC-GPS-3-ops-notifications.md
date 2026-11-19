# RFC-GPS-3 — Ops notifications

**Status:** Draft
**Project:** `projects/transport/`
**PRD:** `projects/transport/docs/PRD.md` Revision 4
**Ticket:** G-A (`docs/tickets/gps/G-A.md`)
**Author:** Claude (Sonnet 5.5), for Dan to review
**Created:** 2026-11-19

---

## Why this needs an RFC

PRD §14: new senders post to the shared Ops Alerts Chat space, and an email fallback is added. That changes who is notified about transport.

## What exists today

Transport mails `alert_email` (or the owner) for document expiry and digests. It has no Chat webhook of its own. The Worker side already posts stale-bus alerts through an Ops Alerts webhook secret.

## Decision (design only)

- GAS-side failures (watchdog, daily pull, config push, `doPost` rejection bursts) post one message to **Ops Alerts** through the webhook URL held in Script Properties (`OPS_ALERTS_WEBHOOK`, **TODO(human)**: value supplied by the estate owner; never in source or the Sheet).
- Retry with backoff, then **fall back to email** to `alert_email` (owner if blank). A failed Chat post is itself logged and mailed.
- One message per condition per state change, with the same dedupe idea as the Worker's `alert_state`, so a long outage is not one message per run.
- Messages carry bus and trip identifiers, never coordinates, admission numbers or names.
- Gated by `gps_alerts_enabled` (default No) so nothing posts before the pilot is switched on.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Email only | Phones and Chat are where this team looks; email stays as fallback. |
| Include last position in the alert | Puts location data into a wider-audience space than GPS_Access allows (R41). |

## Open points

The webhook value and the space are owned by the estate (RFC-GPS-4). Nothing in G-A sends a message.
