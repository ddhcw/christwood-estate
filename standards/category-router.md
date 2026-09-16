# Category Router

Use this to pick which single `categories/*.md` file to read for a given task. Don't load all of them — just the one that matches. Applies across all orgs (Christwood, Anita Methodist, Good Shepherd ×2, Personal); most reference examples below are drawn from the Anita Methodist / AG Schools estate but the patterns generalise.

## The estate (context)

K-12 school environment on Google Workspace. Most tools are Google Apps Script over Sheets; plus standalone Python for heavy computation, Next.js/Vercel websites, and Python LAN bridges for hardware. Users are teachers, office staff and school leadership — mostly on phones, mostly non-technical.

## Route by task type

| Building… | Read |
|---|---|
| GAS web app (HtmlService UI) | `categories/gas-web-apps.md` |
| Artifact generator (marksheets, timetables, PDFs, designed images) | `categories/gas-sheet-creations.md` |
| Trigger-driven watcher/reminder/notifier | `categories/gas-sheet-automations.md` |
| Chat DMs, space broadcasts, social posting | `categories/gas-messaging-posting.md` |
| Admin SDK user/group tooling | `categories/gas-workspace-admin.md` |
| Local hardware / heavy data ↔ Sheets | `categories/hybrid-systems.md` |
| Standalone Python (optimisation, data work) | `categories/python-tools.md` |
| Website / PWA | `categories/websites.md` |
| Infra docs, curriculum content, reports/decks | `categories/reference-infra-content.md` |
| Everything, regardless of category | `estate-wide-best-practices.md` |
| Process — shipping, git, tracking, maintenance | `project-shipping-standards.md` |
| Writing tone/voice | `writing-style-skill.md` |

**Reference implementations worth knowing by name** (cited inside the category files): MMS v2 (fleet architecture: library + shim, central sheet, sheet-driven deployment), student-attendance2 (secure fast web app skeleton), school-dashboard (config-as-data + snapshot), chat-dm (packaging/publishing standard), Christwood bridge (idempotent sync + heartbeat).

## Non-negotiables (short form — full detail in estate-wide-best-practices.md)

1. Secrets in Script Properties / env — never in source. Rotate anything committed.
2. Locate columns by header name, never position.
3. Batch I/O: read all values once, write once; no per-cell calls in loops.
4. Idempotent code-owned `setupSheets()` — including the visual layer.
5. Config as editable sheet data, not code constants; cache reads (5-min TTL).
6. Server-side auth on every endpoint; the client never asserts its own role.
7. Retry external calls with backoff → deterministic fallback; failures post to Ops Alerts. No silent failure.
8. Idempotent re-runs: content-hash dedupe, sent-flags, resumable chunked jobs (6-min limit).
9. Honest state: errors/stale/flags count as pending; show "Data as of HH:MM".
10. Regeneration never destroys entered data; masters get nightly dated backups.
11. Timezone pinned (set per org); dates stored `yyyy-MM-dd`.
12. Bursty concurrent writes don't belong in Sheets → Firestore, Sheets as reporting layer.

## Visual identity

Brand palette source: `brand.json` (per org — see that org's project folder). Status vocabulary everywhere: Pending amber · Done green · Error red · Stale grey, colour always paired with icon/text. Mobile-first (~360 px, ≥44 px targets). Never a blank page — bootstrap shell + progress. Every project ships with a minimal ops README.
