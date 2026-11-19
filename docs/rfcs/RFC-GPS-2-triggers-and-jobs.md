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
| `gpsWatchdog` | new time-driven GAS trigger, installed by its own menu item `installGpsTriggers` (G-C; `installTriggers` is untouched) | every 15 min (PRD R12), **only inside service windows** (`gps_service_days`, trip windows ± `gps_window_grace_min`) | Menu: "Check GPS now" |
| `gpsDailyPull` | inside `rebuildAnalytics` | nightly | Menu: "Pull GPS summary for a date" |
| ROSTER pre-check and GCM reconcile | inside `rebuildAnalytics` (feeder side, RFC-GPS-6) | nightly | Menu twin per PRD R39 |
| Worker crons | Worker repo | per its `wrangler.toml` | `/v1/admin/run-cron` |
| `doPost` (stop events) | GAS, public (`GpsEvents.js`, G-D) | on Worker delivery | n/a; HMAC, replay window and size limits reviewed at Gate 2 (T27) |

Constraints:

- Every job is idempotent: `gpsDailyPull` upserts `GPS_Daily` on `day_key`; running twice leaves one row (R22).
- Jobs are resumable and stay under the 6-minute limit; a failed job posts to Ops Alerts (RFC-GPS-3), never fails silently.
- G-C amendment: the watchdog trigger is created only by `installGpsTriggers` (Fleet > Turn on GPS watchdog), which deletes any existing `gpsWatchdog` trigger before creating the single 15-minute one, so a re-run cannot stack duplicates. It never runs automatically. `installTriggers` is not changed, so re-running it cannot remove the watchdog.
- G-C amendment: the Worker's `/v1/health` is a read endpoint, so the watchdog uses `GPS_READ_SECRET` (not the config secret). Secrets live in Script Properties only.

## G-D amendment: the public `doPost` (stop events)

`GpsEvents.js` adds the project's first `doPost`. The app is `ANYONE_ANONYMOUS`, so the endpoint is reachable by anyone who has the URL; the only thing that lets a request in is a valid signature.

- **Auth.** `ts` and `sig` come from query params (`doPost` cannot read headers). `sig` is lower-case hex HMAC-SHA256 of `${ts}.${body}` with Script Property `GPS_EVENT_HMAC_KEY`, compared in constant time. `ts` must be 10-16 digits and within 5 minutes of GAS's clock either side. Body is capped at 100,000 characters before any HMAC work.
- **Schema.** Strict: `v` = 1, `events` 1-50, only the contract's fields (any other key, or any key containing "admission", rejects the whole batch), event types limited to the four, ids limited to `[A-Za-z0-9._-]` and starting with a letter or digit (so nothing written to a sheet can start a formula), `event_key` must equal `trip_run_id|stop_id|event_type`, `expires_at` within 60 minutes of `event_ts`.
- **Response.** `{"ok":true,...counts}` only after the rows are written and flushed. Every failure, including a busy lock or missing tab, is `{"ok":false}` with no detail, so the Worker keeps the batch and retries until it expires. Request content is never logged; only a short reason code or internal error message is.
- **Idempotency.** A cache of verified signatures (10 minutes, set only after a durable write) makes an identical replay a no-op; a re-send with a fresh signature is a no-op through the `dedupe_key` check inside the lock.
- **Fan-out and modes** follow PRD R35 and R37; see `projects/transport/PROJECT.md` (G-D). Mode `off` drops batches with a count. An unknown or blank `parent_notify_mode` is treated as `shadow_local`, so a typo can never send anything.
- **Limits that cannot be removed here.** Apps Script cannot return HTTP 401 or read headers; the Worker contract's "401" therefore arrives as a 200 with `{"ok":false}`, which the Worker also treats as failure. Anyone with the URL can make GAS do the HMAC work for a body up to the cap; quota is the exposure, reviewed at Gate 2 (T27). Rotating `GPS_EVENT_HMAC_KEY` needs the Worker secret changed at the same time.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| One-minute watchdog | Burns trigger quota for nothing; stale threshold is 5 min. |
| Push every ping to Sheets | Bursty writes do not belong in Sheets (non-negotiable 12); raw pings stay in D1. |

## Open points

`doPost` auth details (HMAC header names, replay window) belong to the T18 ticket and the Worker's DELIVERY-CONTRACT; this RFC only records that the endpoint exists and is a Gate 2 item.
