# TICKET-0003 — Flag duplicate fuel entries on the dashboard

**Ref:** `S-C7944928` · **Project:** `projects/transport/` · **Size:** small
**RFC:** none — read-only surfacing, no schema change, no destructive action
**Raised by:** Lakshmanan · **Owner:** Stella Baby

## Task

Surface likely double-entered fuel records on the dashboard so they can be
spotted and corrected.

**Duplicate is defined, by Dan, as: same vehicle + same date + same fuel amount.**
All three must match. Use exactly this rule — do not widen it, do not invent
a fuzzy match, and do not apply it to trips, attendance or maintenance.

## Acceptance criteria

1. The dashboard shows fuel rows matching the three-field rule, grouped so the
   members of each duplicate set are visible together.
2. **Read-only. Nothing is auto-deleted, auto-merged or auto-corrected.** The
   feature points at suspicious rows; a human decides.
3. Zero duplicates → a clear "none found" state, not a blank panel
   (non-negotiable: never a blank page).
4. Status colours follow the estate vocabulary and pair colour with text or an
   icon, never colour alone.
5. Comparison is robust to formatting: dates compared as calendar dates in
   `Asia/Kolkata`, amounts compared numerically, not as display strings.
6. Batched I/O — one read of the fuel sheet, no per-row `getValue()`.
7. Nothing outside `projects/transport/` is touched.

## Subagent sequence
`implementer` → `reviewer` → `docs-writer` → `verifier`

## Definition of done
Merged, deployed, and Stella confirms a deliberately double-entered fuel record
appears in the panel and a legitimate same-day refuel of a *different* amount
does not.
