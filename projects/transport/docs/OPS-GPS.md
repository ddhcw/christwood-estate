# Transport GPS — ops README (PRD R23, R25)

For the person who keeps the bus tracking running. No secret value appears in this file or anywhere in the repo; secrets are named here and live only where stated.

## Who and where

| Thing | Value |
|---|---|
| Worker URL | `TODO(human)` (the `https://` origin only; set as Script Property `GPS_WORKER_URL`) |
| Worker account owner | Dan (Cloudflare account) |
| Contact if broken | `TODO(human)` |
| Worker repo | `christwood-transport-gps` (separate repo; not part of this folder) |
| Sheet | the Transport workbook (see `PROJECT.md`) |

## Where each secret lives (names only)

| Place | Names |
|---|---|
| Worker secrets (`wrangler secret put`) | `OPS_ALERTS_WEBHOOK`, `READ_SECRET`, `CONFIG_SECRET`, `GAS_EVENT_HMAC_KEY` |
| Transport Script Properties (Apps Script editor, Project Settings) | `GPS_WORKER_URL`, `GPS_READ_SECRET`, `GPS_CONFIG_SECRET`, `GPS_EVENT_HMAC_KEY`, `OPS_ALERTS_WEBHOOK` |
| Feeder Script Properties (separate project, not built yet) | `TRANSPORT_WORKBOOK_ID`, `GCM_CONTROL_SHEET_ID`, `GCM_SHADOW_SPACE`, `OPS_ALERTS_WEBHOOK`, `FEED_LIVE_ALLOWED` |

Values come from the estate owner. The Script Property `GPS_READ_SECRET` must equal the Worker secret `READ_SECRET`, and `GPS_CONFIG_SECRET` the Worker's `CONFIG_SECRET`. `GPS_WATCHDOG_STATE` and `GPS_CONFIG_LAST_PUSH` are bookkeeping, not secrets. The transport script holds no GCM identifier.

## Re-authorise after this release

`appsscript.json` now includes the `script.external_request` scope (added in G-B, needed by the watchdog and daily pull too). The deploying account must open the script once and approve the new permission, or every Worker call fails until it does.

## Crons and triggers

| What | When | Where |
|---|---|---|
| Worker five-minute job (stale bus alerts, outbox retry) | every 5 min | Worker `wrangler.toml` (`*/5 * * * *`) |
| Worker daily rollup | daily 18:00 UTC | Worker `wrangler.toml` (`0 18 * * *`) |
| `gpsWatchdog` | every 15 min, acts only inside service windows (`gps_service_days`, trip windows plus `gps_window_grace_min`) | GAS trigger |
| `gpsDailyPull` (via `rebuildAnalytics`) | nightly about 01:00, pulls the last two days | existing nightly trigger |

Install the watchdog trigger once: **Fleet > Turn on GPS watchdog** (a manager only). Running it again leaves exactly one trigger. Nothing installs it automatically.

The watchdog and the nightly pull post nothing until Settings has `gps_alerts_enabled = Yes`. The nightly pull does nothing until `gps_enabled = Yes`.

## What the watchdog alerts on

One message per problem when it starts, one "recovered" message when it ends. A long outage is not one message per run. Alerts go to Ops Alerts; if Chat fails, the same text is emailed to the `alert_email` setting (the owner if blank). If both fail, the watchdog tries again on its next run.

- Worker `/v1/health` is failing.
- Worker cron silent for more than 15 minutes.
- Worker outbox has an item older than 15 minutes.
- `Parent_Notify_Log` has rows still `pending_feed` or `queued_gcm` after 15 minutes (only once the feeder exists).
- The Settings value `feeder_heartbeat` is more than 5 minutes old (only if that setting exists and holds a time; format `yyyy-MM-dd HH:mm` in Asia/Kolkata, or epoch milliseconds).

Fleet > **Check GPS now** runs the same check on demand, ignoring the window, and shows the findings. It only posts when `gps_alerts_enabled` is Yes.

## Day-to-day tasks

**Reissue a token.** Fleet > Issue / reissue device token, enter the device id. The URL and QR show once; the old token stops working at once. Only the last 4 characters are stored in `GPS_Devices`.

**Pause a bus.** Either set that device's `active_to` in `GPS_Devices` to a past date (or `status` to `revoked`), or use Fleet > Revoke device token. Then Fleet > Push GPS config. The Worker stops accepting pings from it.

**Add or remove a person on `GPS_Access`.** Only the workbook owner can edit the tab. Add a row (`email`, `name`, `role` = `view` or `manage`, `active` = Yes). To remove, set `active` to No; do not delete the row, so the history stays. A change takes effect within a minute.

**Pull a daily summary by hand.** Fleet > Pull GPS summary for a date. It is safe to repeat: one row per `service_date|vehicle_id|trip_code`.

**Notification mode switch.** `parent_notify_mode` on the Settings tab. It stays `shadow_local` (measured, nothing sent) until the live-mode RFC and Gate L are signed off.

**Pause the whole GPS project.** Set `gps_enabled = No` (views close, nightly pull stops) and `gps_alerts_enabled = No` (watchdog goes quiet). Then Fleet > Push GPS config.

## Not built yet

The feeder project, its trigger, `FEED_LIVE_ALLOWED`, the feed guard reset, the GCM project pause and the Phase 2 adapter switch belong to later tickets; this file gets a section for each when they ship.

## Checks

`cd projects/transport && node --test test/`. These use stubs; they prove the logic, not the Apps Script runtime or the live Worker.
