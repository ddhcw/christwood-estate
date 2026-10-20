# Transport Management System

**Slug:** `transport`
**Org:** Christwood
**Category:** GAS Web App
**Status:** Launched
**Owner:** Stella Baby
**Contact if broken:** Stella Baby
**Tracker link:** Projects Tracker web app, `?project=Transport%20Management%20System`
**Repo:** `projects/transport` in `ddhcw/christwood-estate`
**Doc status:** Draft — not yet checked by a person

## What it is

Transport Management System keeps the school's fleet records in one Google Sheet. It covers vehicles, drivers, fuel, trips, maintenance, odometer readings, vehicle documents and driver attendance. A Google Apps Script web app sits on top of the Sheet, and the Sheet holds the data.

## Who uses it

Drivers and office staff use the web app without signing in. They log fuel, trips, maintenance, odometer faults and vehicles going off road. Each bus has a QR sticker that opens the app with that vehicle already chosen (`?v=<vehicle>`).

The admin unlocks the app with a shared PIN. The admin manages vehicles, drivers, documents, the attendance roster and attendance, fixes entries and runs reports.

How often each group uses it, and on which devices, cannot be read from code. See Could not verify.

## What it does

- Records fuel, trip and maintenance entries (`addFuel`, `addTrip`, `addMaintenance`). Fuel entries are checked against the last odometer reading and exact duplicates are skipped. Only Diesel and Petrol count towards km per litre.
- Records odometer faults and off-road status for each vehicle. A vehicle is off road when its status is "Under maintenance".
- Admin only: adds, edits and retires vehicles, drivers and vehicle documents. Maintains the attendance roster and marks attendance by day.
- Admin only: edits and voids fuel, maintenance and trip entries. Voiding keeps the row on record but leaves it out of the figures.
- Admin only: a dashboard with a watch list, document expiries, service due and cost per km. The dashboard and the monthly summary are rebuilt every night.
- Admin only: builds the monthly Fuel Process PDF. It is saved to Drive, logged in `Fuel_Reports`, and each fuel row it covers is stamped with that report.
- Admin only: attendance grid, with CSV and PDF export.
- Automatic jobs: nightly dashboard rebuild, nightly backup, morning check email, Monday digest and monthly report. See Triggers.

## Bindings

| Binding field | Value |
|---|---|
| Script ID | `1PheLLKl1u_ONZROMQsgTg9P3y7nziXt-0cinIG3xBnMJ8yCqcSLb5okG` |
| Spreadsheet(s) | `1RATX-5OGVEvfEXd1xzsJOtFDpGxkU_2Xg7wOPcaCF8k` |
| Drive folders by name | `Fleet Tracker Backups`, `Fleet Fuel Reports`, `Fleet Attendance` |
| Runs as | `automations@christwood.edu.in` — the account every app must run as; the deploy job refuses any other |
| Execute as | Deploying user (`USER_DEPLOYING` in the manifest) |
| Web app access | Anyone, without sign-in (`ANYONE_ANONYMOUS`) |
| Live deployment | `AKfycbxoDz…IOpWFmPYqOVJUv` |
| Live version | `12` (last read; see Could not verify) |

## Data it touches

Columns are listed in the order and spelling of `HEADERS` in `Setup.js`. The code reads and writes by position in that list, so see the footguns below before changing a tab.

| Tab | Columns by header name | Who writes them |
|---|---|---|
| `Vehicle_Master` | `vehicle_id`, `reg_no`, `make_model`, `type`, `seating`, `year`, `in_service_date`, `status`, `gps_device_id`, `access_card_id`, `edited_by`, `edited_at`, `off_road_since`, `off_road_entry_id`, `odo_working`, `odo_broken_since`, `route_no` | Admin (add, update, retire). The app, without the PIN, for `status` and the `off_road_*` and `odo_*` fields. |
| `Driver_Master` | `driver_id`, `name`, `licence_no`, `licence_expiry`, `phone`, `assigned_vehicle`, `status`, `edited_by`, `edited_at`, `sort_order` | Admin (add, update, retire). `setupWorkbook` backfills blank `status` and `sort_order`. |
| `Staff` | `name`, `role`, `active` | No code writes this tab. It is kept by hand in the Sheet. |
| `Fuel_Log` | `timestamp`, `date`, `vehicle_id`, `odometer`, `litres`, `amount`, `filled_to_full`, `station`, `paid_by`, `driver_id`, `entered_by`, `entry_id`, `voided`, `edited_by`, `edited_at`, `bill_no`, `product`, `reported_in` | The app, without the PIN (`addFuel`). Admin for edits and voids. The fuel report sets `reported_in`. Setup backfills `entry_id` and `product`. |
| `Maintenance_Log` | `timestamp`, `date`, `vehicle_id`, `odometer`, `category`, `description`, `parts`, `labour`, `vendor`, `approval_ref`, `downtime_days`, `entered_by`, `entry_id`, `voided`, `edited_by`, `edited_at` | The app, without the PIN (`addMaintenance`). Admin for edits and voids. |
| `Trip_Log` | `timestamp`, `date`, `vehicle_id`, `driver_id`, `purpose`, `open_odo`, `close_odo`, `distance`, `start_time`, `end_time`, `entered_by`, `entry_id`, `voided`, `edited_by`, `edited_at` | The app, without the PIN (`addTrip`). Admin for edits and voids. |
| `Document_Register` | `vehicle_id`, `doc_type`, `number`, `issue_date`, `expiry_date` | Admin (`addDocument`). |
| `Odometer_Events` | `timestamp`, `date`, `vehicle_id`, `event`, `reading`, `was_reset`, `note`, `entered_by` | The app, without the PIN (`markOdometerBroken`, `markOdometerWorking`). Admin when a vehicle is added. |
| `Attendance_Roster` | `roster_id`, `label`, `route_no`, `sort_order`, `status`, `edited_by`, `edited_at` | Admin (add, update, retire). |
| `Attendance_Log` | `timestamp`, `date`, `day_key`, `member_id`, `name`, `route_no`, `code`, `note`, `entered_by`, `edited_by`, `edited_at` | Admin (`markAttendanceDay`). One row per person per day, upserted by `day_key`. |
| `Fuel_Reports` | `report_id`, `generated_at`, `from_date`, `to_date`, `rows`, `total_amount`, `generated_by`, `file_url` | The fuel report job, one row per PDF. |
| `Monthly_Summary` | `month`, `vehicle_id`, `reg_no`, `km`, `fuel_cost`, `fuel_cost_per_km`, `efficiency_kmpl`, `maint_cost`, `maint_cost_per_km`, `total_cost_per_km`, `cumulative_maint`, `downtime_days`, `notes` | The nightly rebuild. It clears and rewrites the data rows. Do not type here. |
| `Dashboard` | Drawn by code, not a fixed header row | The nightly rebuild and the dashboard view. Do not type here. |
| `Settings` | `setting`, `value`, `notes` | Setup seeds missing keys only. The owner edits values by hand. |

## Triggers

| Function | Schedule | Owning account | Manual twin |
|---|---|---|---|
| `rebuildAnalytics` | Daily, hour 01 (Asia/Kolkata) | owner not verifiable from code | Fleet menu: Rebuild dashboard now |
| `nightlyBackup` | Daily, hour 02 | owner not verifiable from code | Fleet menu: Back up now |
| `morningChecks` | Daily, hour 07 | owner not verifiable from code | Fleet menu: Run morning checks now |
| `weeklyDigest` | Mondays, hour 08 | owner not verifiable from code | Fleet menu: Send weekly digest now |
| `monthlyReport` | 1st of each month, hour 06 | owner not verifiable from code | Fleet menu: Send monthly report now |

`installTriggers` creates the five triggers above. It is not scheduled itself. It runs from the Fleet menu item "Turn on automatic updates". It first deletes any existing copies of those five, so running it again is safe. `checkDocumentExpiry` is an old name for `morningChecks`, kept so that any older trigger still works. It is not a trigger in the code.

## Config and secrets

Secrets live in Script Properties, never in source. The Fleet menu sets them.

- `ADMIN_PIN_HASH`: the salted hash of the admin PIN.
- `ADMIN_PIN_SALT`: the salt for that hash.

Settings tab keys (values live in the Sheet): `app_title`, `currency_symbol`, `distance_unit`, `volume_unit`, `alert_email`, `doc_expiry_warning_days`, `replace_window_months`, `replace_maint_costkm_rise_pct`, `replace_efficiency_drop_pct`, `replace_downtime_rise_days`, `replace_require_all_three`, `low_efficiency_kmpl`, `fuel_price_per_litre`, `fuel_price_tolerance_pct`, `service_interval_km`, `service_warn_km`, `silent_vehicle_days`, `odo_jump_km`, `off_road_reminder_days`, `odo_broken_reminder_days`, `licence_warning_days`, `weekly_digest`, `monthly_report`, `backup_keep`, `school_name`, `fuel_report_title`, `fuel_report_rows_per_page`, `fuel_report_station`, `report_prepared_by`, `report_prepared_title`, `report_verified_by`, `report_verified_title`, `report_approved_by`, `report_approved_title`, `attendance_week_off`, `attendance_reminder`.

The manifest sets the time zone to `Asia/Kolkata`. The Sheet's time zone is pinned to match during setup.

## How to operate

First-time setup, in this order:

1. Open the Sheet and run Fleet → Set up workbook. It is safe to run again. It adds missing tabs, headers and settings, and never deletes data.
2. Run Fleet → Set / change admin PIN. Use 4 to 8 digits.
3. Run Fleet → Turn on automatic updates.
4. Deploy the script as a web app, then run Fleet → Show web app link to get the URL.

After a code change: push the code with clasp, then deploy a new web app version. Push before running Set up workbook, so that setup runs the new code. Never edit the code in the Apps Script editor. This repo is the source of truth.

Checks after a change: run Run morning checks now, Rebuild dashboard now and Back up now from the Fleet menu.

Admin sessions: the admin unlocks with the PIN. The session locks after 30 minutes with no admin action.

Fixing bad entries: use Fix Entries in the app. Void a mistaken entry rather than deleting it.

Where errors go: the Apps Script execution log, and exceptions to Stackdriver logging (`exceptionLogging` is `STACKDRIVER`). The morning check, the digest and the monthly report email `alert_email`, or the effective user if it is blank. The code does not post to the Ops Alerts Chat space.

Backups: a dated copy of the Sheet goes to Drive in `Fleet Tracker Backups` each night. The newest `backup_keep` copies are kept (default 30). Older copies go to the Drive bin.

Fuel reports go to `Fleet Fuel Reports`. Attendance PDFs go to `Fleet Attendance`.

## Known footguns

- The fuel, trip, maintenance, odometer and off-road writes need no PIN. Anyone with the web app link can make them, and the entry records only the name typed. The Fleet menu also runs without the PIN. Access to the Sheet is the only gate on the menu. Admin-only actions are checked on the server, but these ones are not.
- The code reads and writes each tab by position in `HEADERS` (`Setup.js`), not by the header text in the Sheet. The only safe change is to append a new column at the end, then run Set up workbook. Moving or inserting columns by hand puts values in the wrong fields. Setup rewrites row 1 on every run, so a renamed header is put back.
- Setup backfills blank cells on old rows. A fuel row with no `product` is read as Diesel, and a vehicle with no `odo_working` value is read as working. Check old data before relying on either.
- Fuel, maintenance and trip entries are separate sheets with their own shapes. A change described as applying to "all entered data" must name the sheets it touches. Do not assume one shared schema.
- `FixEntries.html` exists to repair bad rows. If a change can create bad rows, it needs a matching repair path, per shipping standards §6 (every automated job needs a manual on-demand twin).
- Duplicate fuel detection (`duplicateFuelGroups_()`) excludes voided rows (`isVoided_(r)`), matching the convention already used by `findDuplicate_` elsewhere: a voided row is treated as already human-resolved, so re-flagging it would be misleading. This is read-only. It flags, it never merges or deletes. If one side of a flagged pair later gets voided via Fix Entries, the cluster disappears from the dashboard on the next load. That is expected self-resolution, not a bug.
- The fuel report PDF (`FuelReport.js`) has no route-number column. It was removed by TICKET-0006, which supersedes TICKET-0002. This was deliberate, not a regression. The `routeOf` lookup, the `route_no` field on report rows, the `'Route No'` header, and its entry in the `widths` array were all removed together so the table stays aligned. Route numbers on vehicles, drivers, roster and attendance (`VehicleAdmin.html`, `DriverAdmin.html`, `Attendance.js`, `AttendanceForm.html`, roster views in `Script.html`) are a separate, unrelated lookup and were untouched. Do not conflate the two if a future ticket asks about "route numbers" again.
- When a vehicle's odometer is out of action, its fuel and maintenance are still logged, but km, cost per km and km per litre pause for it. Every day it stays broken is a month with no cost per km figure. The `odo_broken_reminder_days` setting reminds the admin about this.
- The admin PIN is a sensible lock for a school office, not a bank-grade secret. Only the salted hash is stored. Setting a new PIN from the Fleet menu does not ask for the old one.

## Change history

2026-10-20 · T-508a · First draft written from the code

## Could not verify

- Trigger owners. Which account owns each of the five time triggers, whether `installTriggers` has been run in production, and when.
- Live header names and column order in each tab, against `HEADERS` in `Setup.js`.
- Who can open the Sheet, who holds edit rights, and who knows the admin PIN.
- Live deployment settings: access, execute-as and version. Version 12 was the last read. The version live now is not known.
- Contact email for Stella Baby. The repo records a name only.
- The Projects Tracker web app `/exec` URL. It is not in this repo. The Tracker link above gives only the query part.
- Who uses the app, how often, and on which devices.
- Whether `alert_email` and the other Settings values are set in production.
- Whether the three Drive folders exist, and how many backup copies are actually kept.
- Whether the broad `spreadsheets` OAuth scope is still needed beside `spreadsheets.currentonly`. The manifest requests both.
- Whether any errors reach the Ops Alerts Chat space. The code has no call to it.
