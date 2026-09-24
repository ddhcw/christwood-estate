# Transport Management System

**Slug:** `transport` · **Org:** Christwood · **Category:** GAS Web Apps
**Status:** Launched · **Owner:** Stella Baby · **Contact if broken:** Stella Baby

Web app + Google Sheet for managing vehicles, drivers, trips, fuel, attendance
and maintenance records, with admin-level access.

## Bindings

| Thing | Value |
|---|---|
| Script ID | `1PheLLKl1u_ONZROMQsgTg9P3y7nziXt-0cinIG3xBnMJ8yCqcSLb5okG` |
| Spreadsheet | `1RATX-5OGVEvfEXd1xzsJOtFDpGxkU_2Xg7wOPcaCF8k` |
| Web app | see the Projects Tracker row for the current `/exec` URL |

## Source of truth

This directory. Baseline pulled from the deployed script 2026-09-18 and
confirmed identical to the local working copy. Per shipping standards §2:
**no editing in the Apps Script editor.**

## Structure

| File | Role |
|---|---|
| `Code.js` | `doGet`, routing, entry points |
| `Data.js` | Sheet reads/writes |
| `Admin.js` / `AdminLogin.html` / `*Admin.html` | Admin surfaces |
| `Attendance.js` / `AttendanceForm.html` | Driver attendance |
| `FuelReport.js` / `FuelForm.html` | Fuel entry and reporting, incl. read-only duplicate-entry detection (`duplicateFuelGroups_()`). Since TICKET-0006 the generated report has no route-number column. |
| `MaintenanceForm.html` / `DocForm.html` / `TripForm.html` | Entry forms |
| `Analytics.js` / `Reports.js` / `Dashboard.html` | Dashboard and reporting — `getDashboardData()` also returns `duplicateFuel` groups, rendered as a dashboard card in `Script.html` |
| `Setup.js` | Idempotent sheet setup |
| `Triggers.js` | Time-driven triggers |
| `Index/Script/Styles.html` | Shared web app shell |

## Footguns

- Fuel, trip, attendance and maintenance entries are all separate sheets with
  their own shapes. A change described as applying to "all entered data" must
  name the sheets it touches — do not assume one shared schema.
- `FixEntries.html` exists to repair bad rows. If a change can create bad rows,
  it needs a matching repair path, per shipping standards §6 (every automated
  job needs a manual on-demand twin).
- Duplicate fuel detection (`duplicateFuelGroups_()`) excludes voided rows
  (`isVoided_(r)`), matching the convention already used by `findDuplicate_`
  elsewhere: a voided row is treated as already human-resolved, so re-flagging
  it would be misleading. This is read-only — it flags, it never merges or
  deletes. If one side of a flagged pair later gets voided via Fix Entries,
  the cluster disappears from the dashboard on the next load; that's expected
  self-resolution, not a bug.
- The fuel report PDF (`FuelReport.js`) has **no route-number column**
  (removed by TICKET-0006, which supersedes TICKET-0002). This was deliberate,
  not a regression: the `routeOf` lookup, the `route_no` field on report rows,
  the `'Route No'` header, and its entry in the `widths` array were all removed
  together so the table stays aligned. Route numbers on vehicles, drivers,
  roster and attendance (`VehicleAdmin.html`, `DriverAdmin.html`,
  `Attendance.js`, `AttendanceForm.html`, roster views in `Script.html`) are a
  separate, unrelated lookup and were untouched — do not conflate the two if a
  future ticket asks about "route numbers" again.
