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
| `FuelReport.js` / `FuelForm.html` | Fuel entry and reporting |
| `MaintenanceForm.html` / `DocForm.html` / `TripForm.html` | Entry forms |
| `Analytics.js` / `Reports.js` / `Dashboard.html` | Dashboard and reporting — service-due status (`Reports.js`, `computeServiceDue_`) is date-driven, not km-driven; see Footguns |
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
- Since RFC-0002, fleet-wide service-due tracking is entirely date-driven via
  the `service_due_date` Settings row — the odometer/km basis was dropped. If
  the transport department never sets that date, or sets it once and lets it
  go stale, no vehicle will ever be flagged as due and the system will not
  complain; there is no automated backstop for a missing or stale date. This
  is a known accepted risk from RFC-0002, not a bug.
