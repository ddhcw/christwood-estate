# Best Practices — GAS Sheet Creations (Generators)

Distilled from: Marks Management v1, Marks Management v2 (MMS), Timetable Manager & Substitution, Gratitude Monitor.

"Creations" = Apps Script whose job is to **generate an artifact** from config + data: a formatted marksheet, a timetable grid, a PDF report card, a designed image. The defining risk is doing too much per-cell work and reading stale config. MMS v2's README is the canonical anti-pattern checklist — read it before building any generator.

## Generation must be batched
- **Never write cell-by-cell.** MMS v1 made ~2,000 per-cell API calls per marksheet; v2 does ~25 batched calls. Build the whole 2-D array, then one `setValues()`. Same for formatting where possible.
- Prefer **conditional-formatting rules** over `onEdit` triggers for colouring — rules survive file duplication; onEdit triggers don't.

## Config correctness
- **Snapshot the config that produced an artifact, with the artifact.** Store the generation-time config in `DeveloperMetadata` on the generated tab so a later report reflects what it was built from, not whatever the live Config tab says now. (MMS v2's fix for the stale-data bug.)
- **Locate source columns by header name**, configurable in settings — never by hardcoded position. (Both marks systems were burned by this.)
- Model domain rules as **editable data, not code**: subject→group mappings, group ordering, and language mutual-exclusion all belong in a sheet tab office staff can edit (MMS "Exclusion Rules"), not a hardcoded matrix.

## Non-destructive regeneration
- Regenerating must **never destroy entered data.** Rename the old tab to a hidden backup; preserve dropdowns and the cell a report link lives in. (MMS v1 deleted marks on regen — v2 fixed it.)

## Long-running / batch jobs
- Expect the **6-minute execution limit.** Make batch generation **resumable**: process in chunks, write progress, and let a re-run continue. Drive it from a sidebar with live progress for batch report runs. Fetch shared images (logos, photos) **once per batch**, not per item.

## Artifact rendering
- **HTML template → PDF** for branded documents (report cards); host logo/photo/signature images in Drive.
- **Google Slides as a render engine** for designed images: template a deck, export slides as JPG/PNG — zero external dependencies. (Gratitude Monitor)
- Sanitise filenames; set `@page` size on PDFs; trash orphaned old outputs rather than leaving them.
- **Style from the shared brand kit** (`brand.json` palette) instead of restyling per project; add `page-break-inside: avoid` on per-student/record blocks; always test an actual A4 print/PDF export, not just the screen. *(added 2026-07 — see Estate-Wide Addendum)*

## Efficiency & recovery *(added 2026-07)*
- **Read once per run:** one `getDataRange().getValues()` into memory, operate there, write once — never `getValue()` in a loop. Profile with `console.time()` before optimising anything else.
- Generated masters deserve **nightly dated Drive backups** (~30-day retention) alongside the rename-to-hidden-backup rule — Sheets is the database here; treat it like one.

## Validation & ergonomics
- Validate at **data-entry time** with an installable `onEdit` (cheap checks only) so conflicts surface as the user types. (Timetable conflict checks.)
- Provide a **dry-run mode** that logs intended actions without mutating Drive/Sheets. (Gratitude `DRY_RUN`.)
- Project one dataset into **multiple output views** (class-wise + teacher-wise) rather than maintaining parallel sources.

## Fleet management
- If you generate the same artifact across many files (e.g. 56 classes), centralise logic in a **library + thin shim**, centralise data in **one central sheet**, and drive copy creation from a **sheet-based Deployment tab** (idempotent, resumable, writes status/link back). (MMS v2.)
