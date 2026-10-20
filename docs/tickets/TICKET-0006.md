# TICKET-0006 — Remove the route-number column from the fuel report

**Ref:** `S-ED7B7C37` · **Project:** `projects/transport/` · **Size:** small
**RFC:** none — below threshold · **Raised by:** Lakshmanan · **Owner:** Stella Baby
**Supersedes:** TICKET-0002

## Correction to TICKET-0002

TICKET-0002 said "remove the route-number field from the fuel entry screen".
The agent checked and correctly reported that `FuelForm.html` has no such field
— and stopped rather than manufacture a diff. That was the right call.

**Dan has clarified: it is the fuel _report_ that carries a route-number column,
not the entry form.** That is `FuelReport.js`, which looks up the vehicle's route
via `routeOf` and prints it.

## Task

Remove the route-number column from the fuel report output.

## Acceptance criteria

1. The generated fuel report no longer contains a route-number column — not in
   the header row, not in the body, not in any totals or grouping.
2. The `routeOf` lookup is removed **if and only if** the fuel report is its
   only consumer. If anything else uses it, leave it and say so in the PR.
3. Column widths, alignment and any `setColFormat_`-style calls are adjusted so
   the report does not render with a gap or a misaligned header where the
   column used to be.
4. **`FuelForm.html` is not touched.** It has no route field; there is nothing
   to remove there. Do not add or remove anything in the entry form.
5. Route numbers on **vehicles, drivers, roster and attendance**
   (`VehicleAdmin.html`, `DriverAdmin.html`, `Attendance.js`,
   `AttendanceForm.html`, roster views in `Script.html`) are untouched. Those
   are legitimate and unrelated.
6. The `Fuel` sheet schema is unchanged — no columns added or removed from the
   sheet itself (non-negotiable #10).
7. Nothing outside `projects/transport/` is touched.

## Subagent sequence
`implementer` → `reviewer` → `docs-writer` → `verifier`

## Definition of done
Merged, deployed, Stella pulls a fuel report and confirms the route column is
gone and the rest of the report is intact and correctly aligned.
