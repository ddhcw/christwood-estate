# Best Practices — Hybrid Systems (GAS + Bridge)

Distilled from: Christwood Biometric Attendance (Python LAN bridge → Sheet), Student Database & Verification (Sheets + GAS web app + offline Python analysis).

These span a boundary Apps Script can't cross alone — local hardware, heavy data work, or sensitive bulk mutation. A local/offline component does what GAS can't; the Sheet stays the shared surface.

## The bridge pattern
- **When the cloud script can't reach something** (a LAN device on `10.x`, a local DB), put a small **local agent** beside it that reads the source and pushes to the Sheet via a **service account** (shared as Editor on the target sheet). (Christwood)
- **Authenticate to the true data source, not a stale cache.** Christwood v3 read eTimeTrackLite's `.mdb`, which only updated on a manual "Download" click → every sync said "no new records." v4 reads the **devices directly**. Lesson: confirm your source actually updates on its own before building a sync on it.

## Idempotency & resilience
- **Dedupe against the destination, not a local timestamp.** Give each record a deterministic content-hash ID (`device|user|time|type`), read the IDs already in the Sheet, and skip them. Now re-runs, overlapping windows, power cuts, and date-range backfills are all safe. (Christwood)
- **Overlap window** on each sync so a brief outage never drops records.
- **Heartbeat + silence alerting:** the bridge writes "last run / newest record per source / status"; the Sheet alerts if it goes quiet. The system tells you when the local agent dies.
- **CLI flags** for ops: normal run, `--auto` (silent, for the scheduler), `--test` (connectivity only, writes nothing), `--from DATE` (dupe-safe backfill).
- Automate unattended runs via **Task Scheduler** (Windows) with a documented install/uninstall script.

## Sensitive bulk data (Student DB)
- **Profile and simulate offline before mutating live.** Use a Python `_analysis/` toolkit over an *export* to design/dry-run normalisation, then apply to the live master. Never iterate normalisation logic against a 2,000-row master of minors' PII.
- **Hub-and-spoke:** one canonical master DB; other systems consume it via IMPORTRANGE. Keep one source of truth.
- **Locate columns by header name** — the Student DB doc shows column drift (a "photo" column now holds an email); positional access is a latent bug.
- **Write-back through review:** parent/user corrections should land in a review queue ("Change Catcher"), not directly overwrite the master.

## Backups & failure routing *(added 2026-07 — see Estate-Wide Addendum)*
- **Nightly dated Drive backup of every master** the bridge or web app feeds (student DB, attendance), ~30-day retention — these sheets are production databases.
- **Retry pushes with exponential backoff** before giving up a sync cycle; route bridge errors *and* heartbeat silences to the admin **Ops Alerts** Chat space so both *dying* and *dead* are announced.
- Pin the bridge's Python deps (`requirements.txt`) and give it the ops-README treatment: host machine, schedule, secrets location, re-install steps.

## Security
- A **`service_account.json` is a credential** — never commit or share it; the local agent's host is a single point of failure (mitigate with heartbeat alerting).
- Sensitive PII (Aadhaar, DOB, addresses, minors' contacts) demands strict sheet sharing and that no offline export leaks. Document schema, not data.

## Timezone & parsing
- Sheets cells can return a real `Date`, a serial number, or text for the same value — **parse all three defensively** using wall-clock components so results don't depend on the script timezone. (Christwood `_ymd`/time helpers.)
