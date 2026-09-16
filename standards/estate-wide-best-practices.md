# Estate-Wide Best Practices — Visual, Efficiency & Robustness

(Originally "Estate-Wide Addendum". Technical/implementation layer — companion to `project-shipping-standards.md`, which covers process/workflow. This file covers *how to build things well*; that one covers *how to ship and maintain them well*.)

Applies across all category files in `categories/`. Those stay authoritative for category specifics; this layer cuts across all of them. Items marked ★ are newer recommendations (adopted July 2026).

---

## Visual — outputs people see

1. **★ One brand kit, defined once.** Palette lives in code (`create_pptx.py`: primary blue `#1e3a5f`, gold `#d4a853`, light gold, dark blue) but each project restyles from scratch. Create a single `brand.json` + a shared `Stylesheet.html`/`Brand.html` partial exposing CSS variables. Web apps, PDF report cards, Chat cards, decks and websites all pull from it — rebranding becomes a one-file change.

2. **Mobile-first, always.** Staff run these tools on phones. Test every UI at ~360 px width; tap targets ≥ 44 px; no hover-only affordances.

3. **★ Never show a blank page.** Render an instant shell: inject the bootstrap payload into the template, show skeletons/spinners for anything still loading, and during long operations disable the button and show live progress ("Generating 3 of 56…").

4. **★ One status vocabulary estate-wide.** Pending = amber, Done = green, Error = red, Stale = grey — same words, same colours, everywhere. Always pair colour with an icon or text. Implement in sheets as conditional-formatting *rules*, never manual paint.

5. **★ Sheets are a UI too.** `setupSheets()` should also set the visual layer: frozen + bold header row, sensible column widths, data-validation dropdowns, protected formula ranges, hidden helper tabs.

6. **★ Show data freshness and real empty states.** Every snapshot-fed view displays "Data as of HH:MM" next to the refresh control. An empty table says *why* it's empty and what to do.

7. **PDF & print polish.** Explicit `@page` size (A4), `page-break-inside: avoid` on per-record blocks ★, images fetched once per batch, sanitised filenames, orphaned outputs trashed. Always test an actual print/PDF export.

8. **★ One Chat card template.** Header with system name + emoji, key-value sections, one button deep-linking to the exact row/app view — so messages are recognisable and actionable at a glance.

9. **Author once, export many.** Markdown → DOCX/PDF/HTML for reports; brand-themed deck generator for decks; Slides-as-render-engine for designed images.

## Efficiency — fast to run, cheap to keep

1. **Batch, don't loop.** Build the full 2-D array, one `setValues()`; conditional-formatting rules over `onEdit` colouring.

2. **★ Read once per run.** One `getDataRange().getValues()` into memory, operate there, write once. Never `getValue()`/`setValue()` inside a loop — the #1 slowness source.

3. **Layered caching.** `CacheService` (5-min TTL) for config; Drive-JSON snapshot for read-heavy dashboards; chunked + resumable + incremental snapshots at fleet scale.

4. **One bootstrap call** per web-app load — never several `google.script.run` calls on page load.

5. **★ Consolidate triggers.** One scheduled sweep that dispatches to jobs beats many per-feature timers. Keep the install-time dedupe (delete existing before creating).

6. **★ Know the quota ceilings.** UrlFetch ~20k/day, email ~1,500/day, total trigger runtime 90 min/day (varies by tier). Rate-limit bulk sends; log usage near a ceiling.

7. **★ Profile before optimising.** Wrap suspects in `console.time()`. The answer is almost always per-cell I/O or re-opening files — measure, fix that, stop.

8. **Keep heavy logic pure** (values in → values out) so it's testable and portable. Truly heavy computation leaves GAS entirely → Python.

## Robustness — survives real life

1. **Secrets out of source.** Script Properties / env vars only; rotate anything already committed.

2. **Header-name column lookup, never positions.** The single most repeated bug source.

3. **Idempotency everywhere.** Re-runnable `setupSheets()`; content-hash dedupe against the destination; sent-flags per target so retries never double-post.

4. **★ Retry with backoff on every external call.** 2–3 attempts with exponential backoff + jitter and `muteHttpExceptions: true`, then a deterministic fallback. Transient 5xx should never fail a scheduled job.

5. **★ Central error handler + Ops Alerts space.** Wrap every entry point (trigger, menu, endpoint) in a top-level try/catch that posts function name, message and a link to an admin "Ops Alerts" Chat space. Heartbeat catches *dead*, this catches *dying*.

6. **Honest state.** Formula errors, unchecked boxes and flags count as *pending*; stale sources surface, never hide.

7. **★ Deployment discipline.** HEAD dev-mode is for the library-fleet case only. User-facing web apps get **versioned deployments** so a mid-day bad save can't take production down.

8. **★ Nightly backups of masters.** A tiny scheduled script copies critical sheets to a dated Drive folder, ~30-day retention. Pair with rename-to-hidden-backup on regeneration.

9. **Locks with feedback, and know the ceiling.** `LockService` with a timeout and a user-visible "busy, retrying…" message. Bursty concurrent writes → Firestore, Sheets demoted to reporting.

10. **★ Timezone & date hygiene.** Pin `timeZone` in every `appsscript.json`; parse cell dates defensively (real `Date` / serial / text); store dates as `yyyy-MM-dd` strings, never `toString()`.

11. **Server-side authz on every endpoint**; privileged tools additionally get audit logs, confirm/dry-run on destructive actions, admin-only sharing.

12. **★ A minimal ops README in every project.** What it is, where it's deployed, what triggers exist, where secrets live, how to re-run setup. No tool should be un-handover-able.
