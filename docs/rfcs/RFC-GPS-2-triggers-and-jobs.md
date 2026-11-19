# RFC-GPS-2 — Triggers and jobs

**Status:** Draft
**Project:** `projects/transport/`
**PRD:** `projects/transport/docs/PRD.md` Revision 4
**Ticket:** G-A (`docs/tickets/gps/G-A.md`)
**Author:** Claude (Sonnet 5.5), for Dan to review
**Created:** 2026-11-19

---

## Why this needs an RFC

PRD §14: a new trigger (`gpsWatchdog`), new work inside the nightly `rebuildAnalytics`, a new public `doPost`, and Worker crons. New triggers are an RFC trigger under the repo rules.

## What exists today

`Triggers.js` installs the time-driven triggers behind **Fleet > Turn on automatic updates**. `rebuildAnalytics` runs nightly. The web app is `ANYONE_ANONYMOUS` and has no `doPost`.

## Decision (design only; none of it is built under G-A)

| Job | Where | Cadence | Manual twin |
|---|---|---|---|
| `gpsWatchdog` | new time-driven GAS trigger, installed by `installTriggers` | every 5 min, **only inside service windows** (`gps_service_days`, trip windows ± `gps_window_grace_min`) | Menu: "Run GPS watchdog now" |
| `gpsDailyPull` | inside `rebuildAnalytics` | nightly | Menu: "Pull GPS summary for a date" |
| ROSTER pre-check and GCM reconcile | inside `rebuildAnalytics` (feeder side, RFC-GPS-6) | nightly | Menu twin per PRD R39 |
| Worker crons | Worker repo | per its `wrangler.toml` | `/v1/admin/run-cron` |
| `doPost` (stop events) | GAS, public | on Worker delivery | n/a; HMAC, replay window and size limits reviewed at Gate 2 (T27) |

Constraints:

- Every job is idempotent: `gpsDailyPull` upserts `GPS_Daily` on `day_key`; running twice leaves one row (R22).
- Jobs are resumable and stay under the 6-minute limit; a failed job posts to Ops Alerts (RFC-GPS-3), never fails silently.
- Triggers are created only through `installTriggers`, which deletes and re-creates the triggers for its `HANDLERS` list. The new handler is added to that list so a re-run cannot stack duplicates. (Changing `installTriggers` is a later ticket, not G-A.)
- The watchdog reads Worker `/v1/health` with the config secret; the secret lives in Script Properties only.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| One-minute watchdog | Burns trigger quota for nothing; stale threshold is 5 min. |
| Push every ping to Sheets | Bursty writes do not belong in Sheets (non-negotiable 12); raw pings stay in D1. |

## Open points

`doPost` auth details (HMAC header names, replay window) belong to the T18 ticket and the Worker's DELIVERY-CONTRACT; this RFC only records that the endpoint exists and is a Gate 2 item.
