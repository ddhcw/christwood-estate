# TICKET-0004 — Service period: time-based rather than km-based

**Ref:** `S-A433C6E9` · **Project:** `projects/transport/` · **Size:** medium
**RFC:** [RFC-0002](../rfcs/RFC-0002-service-period-time-based.md) — **Accepted**
**Raised by:** Lakshmanan · **Owner:** Stella Baby

## Task

Implement the decision in RFC-0002. Replace the km-based service-due
calculation with a fleet-wide date held in Settings. Nothing beyond it.

## Acceptance criteria

1. `Setup.js` seeds two Settings rows idempotently, with plain-English
   descriptions in the style of the existing rows:
   - `service_due_date` — blank by default
   - `service_interval_months` — default `12`
2. `service_interval_km` and `service_warn_km` are **removed from the service-due
   calculation**. Leave the Settings rows themselves in place — deleting rows
   from a live sheet destroys entered values (non-negotiable #10). They simply
   stop being read by `computeServiceDue_`.
3. `computeServiceDue_` flags a vehicle as **Service due** only when all hold:
   `service_due_date` is set; today ≥ `service_due_date`; and the vehicle has no
   `Scheduled` maintenance record dated on or after
   `service_due_date` − `service_interval_months`.
4. **No warning window.** There is no "approaching service" state. A vehicle is
   due or it is not.
5. A vehicle with **no maintenance records at all** is reported as **Unknown**,
   never as due. The section shows a count of Unknown vehicles alongside the due
   list — visible, but not alarming.
6. `service_due_date` blank → the section says no service date is set and lists
   nothing. It must never render as "all vehicles fine".
7. The existing dead-odometer special case (`eraFrom`, "serviced on the old
   meter") is **removed** if and only if it exists solely to work around the km
   basis. If it carries other meaning, leave it and say so in the PR.
8. Dates compared as calendar dates in `Asia/Kolkata`. No time-of-day drift.
9. Batched I/O. Config read by label, never by row index.
10. The daily digest section renders correctly for: nothing due, some due, all
    due, and no date set.
11. Nothing outside `projects/transport/` is touched.

## Subagent sequence
`implementer` → `reviewer` → `docs-writer` → `verifier`

## Definition of done

Merged, `clasp push`ed, and Stella confirms: with `service_due_date` blank the
digest says so; with it set to a past date the right vehicles appear; and a
vehicle with no maintenance history shows as Unknown rather than overdue.
