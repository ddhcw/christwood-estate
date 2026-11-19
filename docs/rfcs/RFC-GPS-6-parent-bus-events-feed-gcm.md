# RFC-GPS-6: Parent bus events feed GCM

**Status:** Draft
**Project:** `projects/transport/` and `projects/transport-gcm-feeder/`, plus the GCM control sheet (`Christwood-GC-mega-project/`, mirroring its RFC-010)
**PRD:** `projects/transport/docs/PRD.md` Revision 4, §6, §14, R37, R39, R42, R43, T20
**Ticket:** G-E (`docs/tickets/gps/G-E.md`)
**Author:** Claude (Sonnet 5.5), for Dan, the GCM owner and the safeguarding lead to review
**Created:** 2026-11-19

---

## Why this needs an RFC

PRD §14 requires it. This change **changes who is notified** (families, on their children's accounts) and **touches more than one project** (the transport workbook, a new feeder project, and the GCM control sheet). It also asks the GCM owner for an exception: transport would be the first system to send to families **without a person pressing LIVE**, which is an exception to GCM v1's rule that every send is a person pressing LIVE (`GCM-REFERENCE-CW.md` §7). No unattended path has ever sent to families in production anywhere in the estate.

Scope: school events only (`bus_reached_school`, `bus_left_school`). Stop-level events stay behind Gate L and are not covered here.

## What exists today

### Transport side (built, G-D)

- The Worker POSTs signed stop-event batches to the transport web app's `doPost`. `doPost` fans events out into `Parent_Notify_Log` with status `pending_feed` (modes `shadow_gcm` and `live`), `local_only` (`shadow_local`) or `suppressed`. It never touches GCM.
- `Parent_Notify_Log` carries `expires_at` (event time plus the Worker's TTL, at most 20 minutes).

### GCM side (read on 2026-11-19, library 1.10.0)

These are facts from the library source and the Christwood files, not from the PRD. Where they differ from the PRD, the difference is marked **(differs from PRD)**.

- **OUTBOX** headers are exactly `Queued At · Project ID · Recipient · Template ID · Values (JSON) · Send After · Status · Result · Hash` (`01_Constants.gs` `TABS.OUTBOX`). The tab name is `📤 OUTBOX`. The library's own `enqueue()` writes by position in that order (`08_Outbox.gs`), so the feeder appends in that order and refuses to write if row 1 differs.
- **OUTBOX status values are `READY`, `SENT`, `ERROR`, `SKIPPED`, `CANCELLED`** (`ENUMS.OUTBOX_STATUS`). There is no `FAILED` in OUTBOX; `FAILED` exists only in 📨 MESSAGE LOG. **(differs from PRD, which says OUTBOX `FAILED`.)** The feeder maps OUTBOX `ERROR` to `failed`, and MESSAGE LOG `FAILED` to `failed`.
- **OUTBOX has no row ID and the sweeper only fills `Hash` for rows it processes.** A fresh row has `Hash` blank. The feeder therefore ties a log row to its OUTBOX row by `Recipient + Template ID + Values (JSON)`, stored as a short reference in `gcm_result`. Shadow rows are unique by their `Shadow Ref`; live rows by admission number, template, date and session. **(not in PRD.)**
- **The sweeper's dedupe hash is `MD5(project | recipient key | core body)`, where the core body excludes the footer** (`06_Template.gs` `composeItem_`, `messageHash_`). The PRD said "project, recipient and body". The practical effect is the same, and it confirms that a unique last line is enough to make shadow rows distinct.
- **A blank optional placeholder line is dropped.** `{{Name?}}` becomes empty and `tidyBody_` strips trailing blank lines (`06_Template.gs`), so `{{Shadow Ref?}}` on its own last line disappears in `live`. Confirmed in the feeder's tests with a copy of `fill_` and `tidyBody_`; **not confirmed against a real sweeper run.** (PRD §6.4 asked T20 to confirm this.)
- **A literal `spaces/…` recipient resolves in any Recipient Mode** (`05_Resolve.gs` top of `resolveRecipient_`), as the PRD says.
- **`ADMISSION_NO` strict mode skips an admission number that is not on ROSTER or is marked `LEFT`.** It does not test for `ACTIVE`, although the SETTINGS note for `ROSTER_STRICT` says "not ACTIVE". A blank Status therefore passes. The feeder's ROSTER pre-check copies the code's test (on ROSTER and not LEFT). **(small difference from the SETTINGS text.)** The pre-check does not read 🚫 SUPPRESSION (the feeder opens only SETTINGS, ROSTER, OUTBOX and MESSAGE LOG), so a suppressed student shows reachable and is skipped by GCM with a stated reason.
- **`SEND_WINDOW` is compared as `HH:mm` strings, inclusive at both ends, and a blank or unparseable value never blocks** (`07_Engine.gs` `withinSendWindow_`). The feeder excludes the end minute and treats a blank or unparseable value as an error that blocks feeding. Both are stricter than the library.
- **The sweeper reads the whole OUTBOX region and writes it back at the end.** Appending below the region it read is safe; editing a row inside it would race. The feeder never edits an OUTBOX row.
- **A project that is not `ACTIVE` holds its rows without changing their status** (`08_Outbox.gs` `sweepOne_`), so a `PAUSED` project leaves rows `READY` and they send, however old, when it goes ACTIVE. **The PRD's "PAUSED until go-live" would stop `shadow_gcm` too.** **(differs from PRD's implication that shadow works while PAUSED.)** The project must be ACTIVE for shadow; the redirect to the shadow space is what keeps shadow away from families.
- **No expiry.** OUTBOX rows have no `Expires At` and GCM cannot expire them. A row appended just before the window closes, or sitting while the project is PAUSED, is delivered the next morning. This is why stop-level events wait for Gate L.
- **Precedent for another system writing the control sheet by ID:** the Calendar feed (`Christwood/Calendar/src/29_GcmFeedLogic.gs`, `30_GcmFeed.gs`, RFC-010/011). It matches tab names exactly with the emoji as `\u` escapes, finds headers by name, refuses with an Ops alert if a tab or header is missing, alerts once per distinct problem, writes in one batch, and never edits a row it does not own. The feeder follows the same pattern; the Calendar writes to SETTINGS and 📅 CALENDAR, the feeder only appends to 📤 OUTBOX.

## Decision

### 1. A separate feeder project and account (R42)

`projects/transport-gcm-feeder/` is its own Apps Script project: no `doGet`, no `doPost`, no web app in the manifest, no `.clasp.json` in the repo. It runs on time triggers under an account on GCM's access list. That account also has edit access to the transport workbook, to write statuses back. The account that executes the anonymous transport web app (`USER_DEPLOYING`) has **no access of any kind** to the GCM control sheet. If it has access today, that is an existing exposure and is removed before Gate 3a (PRD Q17); a person checks the sharing list.

The feeder reads SETTINGS (`SEND_WINDOW`), ROSTER, OUTBOX and MESSAGE LOG, and appends to OUTBOX. It touches no other tab and edits no existing row.

### 2. The feed guard (R43)

`Parent_Notify_Log` is written by the public app, so the feeder trusts nothing in it. It re-checks every row; the rules and their reasons are in the feeder README. In short: constant project ID; enabled type with a template; dedupe key and event ID consistent with the columns; run is today's for an active known trip with the trip's own session; mode unchanged; an active `notify = Yes` student row (and `gcm_reachable = Yes` for live); every placeholder from an allow-list with no free text and no URL; not past `expires_at`; inside `SEND_WINDOW`; one row per dedupe key.

Two caps: students on the trip times enabled types per trip run, and `gcm_feed_daily_cap` a day (default 300). A run that would break a cap queues nothing, sets a tripped flag, and raises an Ops Alert. It stays tripped until a person resets it from the feeder.

Rows that can never pass become `suppressed` with a reason. Rows that may pass later stay `pending_feed`, and the transport watchdog alerts on any row still pending after 15 minutes (R12, R39).

What the guard does not stop: a person who can edit the transport workbook can add students to `Student_Trip_Stops` and cause a real template to reach them, up to the daily cap. The wording is fixed, so the worst case is a wrong bus message, never arbitrary text. The workbook's sharing list is checked at Gate 2 (T27).

### 3. The OUTBOX feed, school events only

- `Project ID = cw-bus-notify` (a constant in the feeder, never read from a sheet), `Template ID` `cw-bus-reached-school` or `cw-bus-left-school`, `Values (JSON)` with `Bus`, `Session`, `Time`, `Date` (and `Shadow Ref` in shadow), `Send After` blank, `Status = READY`, `Result` and `Hash` blank.
- All rows of a run are appended in one `setValues` under the feeder's script lock.
- **Order of writes:** the feeder marks log rows `queued_gcm` first, then appends to OUTBOX; if the append fails it puts the rows back to `pending_feed` and alerts. A crash between the two leaves a row `queued_gcm` with no OUTBOX row; reconcile reports it `failed` (`gcm_status = MISSING`) after 10 minutes. The other order would risk a duplicate family message after a crash, which is worse.
- The two templates and the `cw-bus-notify` PROJECTS row are drafted in `docs/gcm-requests/` for the GCM maintainer to apply. **The feeder does not write them.**

### 4. Shadow through a redirect space

In `shadow_gcm` the recipient is the shadow space (Script Property `GCM_SHADOW_SPACE`), a staff space containing the in-charge and `askus@`. It is a redirect, not GCM's TEST space (D8). Each row has a unique `Shadow Ref` (a persistent counter and the event ID, never an admission number) so GCM's hash dedupe does not collapse 40 rows into one send. The project must be `ACTIVE` for shadow (see above).

### 5. Two switches for live

`live` needs both `parent_notify_mode = live` in the transport Settings and `FEED_LIVE_ALLOWED = Yes` in the feeder's Script Properties, held by two different accounts. Editing the workbook alone cannot turn live sends on. A row created in one mode is not fed under another (`mode_changed`).

### 6. Reconcile and failure (R39)

Every run copies GCM's status back (`SENT`, `SKIPPED`, `CANCELLED`, `ERROR`) into `Parent_Notify_Log`; nightly, MESSAGE LOG supplies the true send time and has the final say on status. One Ops Alert per trip run for any skip or failure, with counts only and no student data. Rows past `expires_at` are never queued and become `expired`. The feeder writes `feeder_heartbeat` to the transport Settings on every run.

### 7. Language (Q15), safeguarding, volume, replies

- **Language:** drafted English only (Christwood Q8). A bilingual variant is noted in `TEMPLATES-rows.md`. Only the Body would change. The school decides; this RFC does not.
- **Safeguarding:** the wording describes the bus, never the child, names no stop, and gives no future times. The safeguarding lead reviews the wording before any family receives one (PRD §6.3d). 🚫 SUPPRESSION and `notify = No` are honoured.
- **Volume:** about 80 messages a day for a 40-student pilot bus. Fleet-wide with school events only is about 2,000, close to `DAILY_SEND_CEILING` 2500 once the school's own sends are added. Raise `LOG_SCAN_ROWS` before the ceiling.
- **Replies** to a bus message go to the class teacher (📇 REPLY ROUTING). Per-project reply routing is a library change and is not requested.

## Rejected alternatives

- **Giving the web app's account edit access to the control sheet** (PRD rev 3). That app is public and the control sheet can message every family from `askus@`. Only convention would have kept transport to its own rows.
- **An intake sheet that a GCM-side job pulls from.** Still open if the GCM maintainer prefers that no outside project writes to the control sheet at all. The feed guard applies either way.
- **Calling the GCM library from transport** (`enqueue()`). Christwood's rule D3/D4 is that only the maintainer and the owner may open the library.
- **A bound script on the transport workbook.** Anyone who can edit the workbook can open and edit a bound script, which would defeat the isolation.

## Risks and what we could not verify

- **No Apps Script runtime was available.** Triggers, `LockService`, opening two spreadsheets by ID, the Ops Alerts webhook, and above all the real sweeper reading a feeder-written row have not been run. Tests use stubs and a copy of two library functions.
- **A standalone project has no sheet menu.** The PRD's "menu items" are functions run from the editor. If a real menu is wanted, bind a small control sheet owned by the feeder account (`TODO(human)`).
- **Stale delivery:** a row appended in the last minutes of `SEND_WINDOW`, or while the project is PAUSED, can reach families the next morning. GCM cannot expire it.
- **Latency:** about 6 minutes typical, 12 worst case on a quiet day, unbounded during a whole-school send (PRD §6.3a). The school events tolerate 5 to 10 minutes inside the window only.
- **The feeder's account access** to both spreadsheets, and the absence of the web app's account from the control sheet, are human checks.

## Open points

| # | Question | Who |
|---|---|---|
| Q10b | May the feeder's account have edit access to the control sheet (which also exposes 📥 REPLIES), or does the maintainer prefer an intake sheet? | GCM owner |
| Q15 | English only, bilingual, or a per-family preference? | School, safeguarding lead |
| Q16 | Safeguarding review of the wording and of the first unattended send | Safeguarding lead |
| Q17 | Which account executes the web app, and does it have control-sheet access today? | Dan |
| New | `Bus` is `Vehicle_Master.vehicle_id`. Should it be the registration number or the route instead? | School |
| New | Project `ACTIVE` is needed for shadow, not only for live. Acceptable? | GCM owner |
| New | The PRD says OUTBOX `FAILED`; the library uses `ERROR`. Update the PRD wording | Dan |
| New | The feeder's heartbeat and tripped state: should the watchdog also read a `feeder_guard` setting? Today it alerts only on the heartbeat and stuck rows; the tripped guard alerts directly from the feeder | Dan |

## What this RFC does not do

It applies no GCM row, edits no library file, deploys nothing, and sends nothing. Gate L stop-level templates are out of scope.
