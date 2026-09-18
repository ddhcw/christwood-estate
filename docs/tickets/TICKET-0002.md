# TICKET-0002 — Remove route numbers from the fuel entry screen

**Ref:** `S-ED7B7C37` · **Project:** `projects/transport/` · **Size:** small
**RFC:** none — below the RFC threshold (UI only, no schema or notification change)
**Raised by:** Lakshmanan · **Owner:** Stella Baby

## Task

Route numbers do not belong on the fuel entry screen. Fuel is recorded against a
vehicle, not a route. Remove the route-number field from that form.

## Acceptance criteria

1. The route-number input no longer appears on the fuel entry form (`FuelForm.html`).
2. Any client-side validation or required-field check on it is removed too — the
   form must still submit cleanly with no orphaned validation.
3. The server-side write path no longer expects route number for fuel entries.
4. **Existing fuel rows are not modified or deleted.** If the Fuel sheet has a
   route-number column, leave the column and its historical values alone;
   new rows simply leave it blank. Non-negotiable #10.
5. Route numbers elsewhere (trips, attendance, maintenance) are untouched.
6. Nothing outside `projects/transport/` is touched.

## Subagent sequence
`implementer` → `reviewer` → `docs-writer` → `verifier`

## Definition of done
Merged, `clasp push`ed, and Stella confirms a fuel entry saves correctly without
the field and that historical fuel reports still render.
