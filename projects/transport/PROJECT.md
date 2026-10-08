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
| `Analytics.js` / `Reports.js` / `Dashboard.html` | Dashboard and reporting |
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

## Other files in this folder

None of these are pushed to Apps Script (see `.claspignore`).

| Path | What it is |
|---|---|
| `docs/fleet-data-project-note.md` | Original Phase 1 scoping note (from the transport-in-charge's list, June 2026). |
| `docs/expansion/` | Phase 2 plan: parent-facing live tracking. Plan, leadership one-pager, `make-pdf.sh`. |
| `reference/` | Office source material: fuel process PDFs. The attendance CSV is student/driver data and is gitignored. Don't commit it. |
| `archive/src-2026-07-30/` | Code snapshot from 30 July, before attendance and the fuel report were added. Read-only. |

Merged here 2026-10-08 from the old local `Christwood/transport*` folders.
