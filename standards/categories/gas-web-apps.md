# Best Practices — GAS Web Apps

Distilled from: AMS Procurement Hub, Fees Management, Anita Methodist Attendance, AMS Leadership Dashboard, Student Fiesta (operational + Christwood academic).

These are HtmlService apps served by `doGet`, backed by Sheets, used by many people at once. The patterns below are what the strongest examples here already do — start every new web app from this checklist.

## Entry point & routing
- **Thin `doGet`.** Resolve a `?page=` parameter and serve a single templated `Index`; route to views client-side or by template flag. (student-attendance2)
- **One bootstrap call.** Return *all* initial data the client needs in a single `getInitialData()` / `bootstrap` payload injected into the template — don't make the page chat back with five `google.script.run` calls on load. This is the single biggest perceived-speed win.
- **`include()` helper** to compose HTML from partials (`Index`, view, scripts, styles) — keeps the front-end modular.

## Auth & access — trust the server, not the client
- Resolve identity server-side from `Session.getActiveUser().getEmail()`; **never let the client assert its own role.**
- Enforce access on **every** public endpoint, not just at page load.
- Prefer **per-resource access lists** (e.g. "Viewer Emails" per tracker) over a global admin flag; support **Google Groups** in those lists so membership is managed centrally. (school-dashboard)
- Deploy "Execute as: Me, Access: Anyone in domain" and rely on the email check for authorisation.

## Performance & scale
- **Snapshot pattern for read-heavy dashboards:** a timer rebuilds a JSON snapshot in Drive; the web app loads the snapshot in ~1s instead of reading many sheets live. Add a manual "Refresh now" button. (school-dashboard, student-fiesta)
- For large fleets, make the snapshot **chunked, resumable, and incremental** so it survives the 6-minute execution limit and doesn't re-read everything each run. (Christwood)
- **Batch** sheet reads/writes; cache config via `CacheService` (5-min TTL is a sane default). (ams-procurement, fees)
- Keep heavy/pure logic in functions that take values in and return values out, so they're **testable off-platform in Node**. (Christwood parsers)

## Data & config
- **Code-owned, idempotent tab setup** — a `Run Full Setup` that (re)builds every tab from code, with a confirm guard before anything destructive.
- **Locate columns by header name, not position** (see MMS v2's anti-pattern list).
- Config lives in a sheet tab the office can edit; read it through a cached accessor.

## Visual & UX *(added 2026-07 — see Estate-Wide Addendum)*
- **Never show a blank page:** render an instant shell from the injected bootstrap payload; skeletons for anything still loading; long operations disable the button and stream progress ("3 of 56…").
- **Mobile-first:** test at ~360 px, tap targets ≥ 44 px, no hover-only affordances — staff use phones.
- Pull colours/fonts from the shared **brand kit** (`brand.json` / `Brand.html` CSS variables), and use the estate status vocabulary: Pending amber · Done green · Error red · Stale grey, always paired with icon/text.
- Snapshot-fed views show **"Data as of HH:MM"** beside the refresh control; empty states say why and what to do next.

## Operational hygiene
- An **Audit Log tab** for every state mutation.
- A "Help" menu item and a setup README so a non-developer can stand it up.
- Define states honestly: on the dashboards, formula errors / unchecked boxes / flagged issues count as **pending**, so broken automations surface instead of hiding.

## Robustness *(added 2026-07)*
- **Versioned deployments for user-facing apps** — HEAD dev-mode is for the library-fleet case only. A mid-day bad save must not take production down.
- **Retry with backoff** (2–3 attempts, jitter, `muteHttpExceptions`) on every `UrlFetchApp`/external call.
- Wrap `doGet` and every public endpoint in a top-level try/catch that posts failures to the admin **Ops Alerts** Chat space — no silent 500s.

## When to leave Sheets
If the live transactional path involves bursty concurrent writes (e.g. 100 people in 15 minutes), Sheets + `LockService` will serialise and time out. Move the transactional store off Sheets (Firestore) and demote Sheets to a scheduled reporting layer. (See the One Way architecture in Websites.)
