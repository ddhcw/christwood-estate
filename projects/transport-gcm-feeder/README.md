# Transport GCM feeder

**Slug:** `transport-gcm-feeder` · **Category:** GAS Messaging & Posting (cross-system feed)
**Status:** Built, never run. No Apps Script runtime was available; nothing here has touched Google.
**Spec:** `projects/transport/docs/PRD.md` rev 4 §6.2, R37, R39, R42, R43. **RFC:** `docs/rfcs/RFC-GPS-6-parent-bus-events-feed-gcm.md` (Draft).

## What it is

A separate Apps Script project with **no web app, no `doGet`, no `doPost`** (R42). It is the only thing that writes to the GCM control sheet for bus messages. The public transport app only writes `Parent_Notify_Log`; this project re-checks every row (the feed guard, R43) and appends rows to GCM's `📤 OUTBOX` for the project `cw-bus-notify`. School events only (`bus_reached_school`, `bus_left_school`). Stop-level events have no template here on purpose (Gate L).

## Who runs it

The feeder's own account (not the account that executes the transport web app). That account needs:
- **edit** on the transport workbook (writes statuses back) and
- **edit** on the GCM control sheet (appends OUTBOX rows; this also lets it read 📥 REPLIES, an access decision for the GCM owner, PRD Q10b).

The transport web app's account must have no access to the control sheet (R42, Q17). A person checks the sharing list at Gate 3a.

## Bindings

| Item | Value |
|---|---|
| Script ID | `TODO(human)`: create the project, then `clasp clone`. There is no `.clasp.json` in the repo on purpose |
| Transport workbook ID | Script Property `TRANSPORT_WORKBOOK_ID` (`TODO(human)`) |
| GCM control sheet ID | Script Property `GCM_CONTROL_SHEET_ID` (`TODO(human)`) |
| Shadow space | Script Property `GCM_SHADOW_SPACE`, form `spaces/…` (`TODO(human)`) |
| Ops Alerts webhook | Script Property `OPS_ALERTS_WEBHOOK` (`TODO(human)`). Falls back to email to the account that installed the triggers |
| Live switch | Script Property `FEED_LIVE_ALLOWED` (`Yes` to allow live; anything else blocks it) |

State the feeder keeps itself (Script Properties, do not edit by hand): `FEED_GUARD_TRIPPED`, `FEED_SHADOW_SEQ`, `FEED_ALERT_STATE`, `FEED_ALERTED_RUNS`, `FEED_LAST_NIGHTLY`.

## Setup (a person does this; nothing here deploys)

1. Create the project under the feeder account. Copy these files in (no `clasp push` from here). Set the manifest as in `appsscript.json` (no web app).
2. Set the Script Properties above.
3. Run `menuInstallTriggers` from the editor (Run menu). It installs `feederRun` every minute and `feederNightly` daily at about 21:00. A standalone project has no sheet menu, so the "menu items" below are functions you run from the editor; `onOpen` adds a real menu only if the project is ever bound to a sheet.
4. Run `menuFeederStatus`.

## The menu functions

| Function | What it does |
|---|---|
| `menuInstallTriggers` | Idempotent. Replaces the feeder's two triggers |
| `menuFeedNow` | Same code as the every-minute run ("Feed now") |
| `menuRosterCheckNow` | Same code as the nightly job: ROSTER pre-check and MESSAGE LOG reconcile |
| `menuResetFeedGuard` | Clears a tripped feed guard. Check `Parent_Notify_Log` first |
| `menuFeederStatus` | Guard state, triggers, last nightly run |

## What each run does

1. Marks `pending_feed` rows past `expires_at` as `expired`. Never sent late.
2. If `parent_notify_mode` is `shadow_gcm` or `live` and the guard is not tripped: checks every `pending_feed` row (R43), then appends all rows for the run to OUTBOX in **one** `setValues` under the script lock. It never edits an existing OUTBOX row.
   - `shadow_local`, `off` or anything unknown: nothing is queued.
   - `shadow_gcm`: `Recipient` = `GCM_SHADOW_SPACE`; each row has a unique `Shadow Ref` (counter and event ID, never an admission number).
   - `live`: `Recipient` = admission number. Needs **both** `parent_notify_mode = live` in the workbook **and** `FEED_LIVE_ALLOWED = Yes` here.
3. Copies back the status of rows queued earlier (OUTBOX `SENT`/`SKIPPED`/`ERROR` → `sent`/`skipped`/`failed`, `gcm_sent_at`, `latency_s`). One Ops Alert per trip run for a skip or failure.
4. Writes `feeder_heartbeat` (ISO time, +05:30) to the transport `Settings` tab.

Nightly (about 21:00): ROSTER pre-check writes `gcm_reachable` (Yes/No) into `Student_Trip_Stops`; MESSAGE LOG gives the true send time and status.

## The feed guard (R43)

A row is queued only if all hold: project is the constant `cw-bus-notify`; type enabled in `parent_notify_types` and has a template; dedupe key and event ID match the columns; run is today's, for an active known trip with the trip's own session; mode unchanged since the row was written; an active `notify = Yes` student row exists (and, in live, `gcm_reachable = Yes`); every placeholder from an allow-list (no free text, no URL); not past `expires_at`; inside GCM's `SEND_WINDOW`; one row per `dedupe_key`.

Two caps: students on the trip × enabled types per trip run, and `gcm_feed_daily_cap` a day. **A run that would break a cap queues nothing, sets `FEED_GUARD_TRIPPED`, and posts one Ops Alert. It stays tripped until someone runs `menuResetFeedGuard`.**

Rows that can never pass become `suppressed` with `suppressed_reason = feed_guard:<reason>`. Rows that may pass later (outside the window, switch off, no shadow space) stay `pending_feed`; the transport watchdog alerts on any row still pending after 15 minutes.

## When something is wrong

| Sign | Likely cause | What to do |
|---|---|---|
| Ops Alert "Feed guard TRIPPED" | A cap broke: a forged or runaway log | Read `Parent_Notify_Log`; fix the cause; run `menuResetFeedGuard` |
| Alert "GCM OUTBOX headers changed" | The GCM library changed its OUTBOX layout | Stop. Tell the GCM maintainer. Do not edit the feeder to match without review |
| Alert "no usable SEND_WINDOW" | The GCM SETTINGS key is blank or malformed | Fix `SEND_WINDOW` in GCM (`HH:mm-HH:mm`) |
| Watchdog: heartbeat old | Trigger lost or feeder error | Run `menuFeederStatus`, then `menuInstallTriggers` |
| Rows `queued_gcm` for long | GCM project is `PAUSED`, or the sweeper is not running | See GCM; the sweeper holds rows while the project is PAUSED |
| Row `failed` with `gcm_status = MISSING` | The OUTBOX row vanished | Tell the GCM maintainer |

## Could not verify

No Apps Script runtime: triggers, `LockService`, `SpreadsheetApp.openById` across two spreadsheets, `getDisplayValues` on GCM SETTINGS, the Ops Alerts webhook and the sweeper's reading of a feeder-written row have not been run. The tests use stubs and a copy of the library's `fill_` and `tidyBody_`. The feeder account's access to both sheets is a human check.

## Tests

`cd projects/transport-gcm-feeder && node --test test/`
