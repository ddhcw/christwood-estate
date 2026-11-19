# RFC-GPS-1 — GPS, trip and stop schema

**Status:** Draft
**Project:** `projects/transport/`
**PRD:** `projects/transport/docs/PRD.md` Revision 4
**Ticket:** G-A (`docs/tickets/gps/G-A.md`)
**Author:** Claude (Sonnet 5.5), for Dan to review
**Created:** 2026-11-19

---

## Why this needs an RFC

PRD §7 and §14: ten new tabs, 21 new Settings keys, and a data model (session-keyed trips, stops, per-student stops) that the Worker, the feeder and every later GAS ticket read by header name. A column renamed after data exists is a migration.

## What exists today

The workbook has no stop, location, student or pickup data (PRD §7.1). `Setup.js` owns `HEADERS`, `setupWorkbook()` and the Settings seed. Existing code locates columns **by position** (see the NOTE above `HEADERS`); the GPS code does not.

## Decision

A new file, `GpsSetup.js`, owns the GPS schema. `setupWorkbook()` calls `setupGpsTabs_(ss)` once, after the existing tabs are built. It does not change any existing tab. `setupGpsTabs()` is also runnable alone.

| Tab | Columns | Source |
|---|---|---|
| GPS_Devices | per PRD §7.2 | PRD |
| Transport_Trips | `trip_code`, `session`, `route_no`, `vehicle_id`, `window_start`, `window_end`, `active`, `edited_by`, `edited_at` | PRD R26 |
| Transport_Stops | `stop_id` … `edited_at` (13 columns) | PRD R27 |
| Trip_Stops | `trip_code`, `sequence`, `stop_id`, `scheduled_time` | PRD R28 |
| Student_Trip_Stops | `admission_no` … `edited_at` (9 columns, no names, no contacts) | PRD R29 |
| Parent_Notify_Log | 20 columns per PRD §7.2 | PRD |
| Notify_Strings | `key`, `en`, `ta`, `ta-Latn`, `notes` | PRD |
| GPS_Daily | `day_key`, `service_date`, `vehicle_id`, `pings`, `late_pings`, `first_fix_at`, `last_fix_at`, `summary`, then the six PRD additions | PRD + Worker `trip_daily` |
| GPS_Access_Log | `timestamp`, `view`, `viewer_email` | PRD R18 |
| GPS_Access | `email`, `name`, `role`, `active`, `added_by`, `added_on`, `notes` | PRD R41 |

Rules the setup follows:

- **Idempotent, additive.** A blank header row is written whole. A row that already has headers only gets missing columns **appended at the end**; existing columns are never moved or renamed, so data stays under its header.
- **Header-name access.** Every read and every validation/format range is found from the live header row.
- **Visual layer is code-owned.** Frozen header row; dropdowns for `session`, `kind`, `source_protocol`, `store_outside_window`, `coord_source`, `notify`, `active` and `role` (list-only, no free text); status colours (Error red, Pending amber, Stale grey, Live/Done green, always with the word in the cell); inactive rows grey; an unverified stop's `verified_on` amber; a student stop that is not in the trip's `Trip_Stops` red (R29). Conditional-format rules on these tabs are rebuilt on each run, so a re-run cannot stack duplicates.
- **Settings.** Missing keys are appended; a value someone has edited is never overwritten. Defaults named in PRD §7.2 are used as given. `gps_enabled`, `gps_alerts_enabled`, `gps_purge_enabled` and `gate_l_passed` default to **No**, `parent_notify_trips` to blank, and `gps_service_days` to `Mon,Tue,Wed,Thu,Fri,Sat` (the PRD names the key but not its value).
- **Validation (R26–R29), pure functions.** `gpsValidateSetup_()` flags: duplicate sequence within a trip; a trip with no school row; a stop more than 30 km from the school; a student stop not in that trip's `Trip_Stops`; plus an unknown `stop_id` in `Trip_Stops` and unverified stops (a note, R27). Inactive rows are skipped. Menu: **Fleet > Validate GPS setup**.
- **Timezone and dates.** Asia/Kolkata, `yyyy-MM-dd`. D1 holds UTC epoch milliseconds, per the PRD.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Add the columns to `HEADERS` in `Setup.js` | That map is read by position; mixing in tabs that are read by name invites the wrong habit and edits a file every other ticket touches. |
| Repurpose `Vehicle_Master.route_no` as the trip key | A bus does not keep one route number across sessions (R26). |

## Open points (need a human)

1. The PRD gives GPS_Daily and GPS_Access_Log as "Unchanged, plus …" with no base columns. The base set above is an assumption; confirm before G-C writes rows.
2. Defaults for `gps_service_days` and the four No switches are assumptions.
3. The school's named-location sheet headers are still unknown (Q12); the import is not part of this RFC.

## Not in scope

D1 schema (done in the Worker repo), the config push (G-B), the watchdog and daily pull (G-C).
