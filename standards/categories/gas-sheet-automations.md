# Best Practices — GAS Sheet Automations

Distilled from: Admission Tracker, Apple Federation Migration Tracker, Daily Wear Tracker, Partial Leaves Tracker, Social Media Tracker.

"Automations" = Apps Script that watches or sweeps an existing sheet on a trigger and *acts* — notifies, reminds, escalates, enriches — without a generated artifact being the point. Small scripts, but the same disciplines apply.

## Triggers
- **Install triggers programmatically** and delete existing ones first to avoid duplicates (the classic "ten copies of the same trigger" bug). Offer it as a menu item.
- Make scheduled automation **opt-in** from the menu (enable/disable), not silently assumed. (Daily Wear)
- Know that time triggers are **approximate** (±15 min) — fine for digests, not for anything time-critical.

## Reminders & escalation
- Always give a reminder loop a **stop condition**: store a `reminderCount` per row and cap it / escalate after N. Infinite nagging is a bug. (Partial Leaves, Apple Migration's 7/14/21-day cadence + day-14 escalation.)
- Make cadence and thresholds **config**, not literals.
- Model the **real** workflow: e.g. a leave happens now but the paperwork lands later — track the gap and chase the obligation, don't pretend it's one step. (Partial Leaves)

## Notifications
- Route notifications to **the channel people already watch** — Google Chat cards, Calendar events, or email — and **route by audience** (different Chat spaces for different roles). (Admission Tracker)
- For Chat, keep a **webhook-per-audience map as data** (a tab/CSV) so adding a recipient is a config row.
- Log each send back to the row with status + acting user for accountability.

## AI in a scheduled job
- **Always wrap LLM calls in try/catch with a deterministic fallback** so the cron job still produces something on an API outage. (Social Media Tracker's `getFallbackIdeas`.)
- Keep a **prod/test split** — a separate test entry point and test webhook so you can dry-run safely.

## Failure handling *(added 2026-07 — see Estate-Wide Addendum)*
- **Retry with exponential backoff + jitter** on every external call before falling to the deterministic fallback; transient 5xx must never kill a scheduled job.
- Top-level try/catch on every trigger entry point posts function name + error to the admin **Ops Alerts** Chat space. Heartbeat catches *dead*; this catches *dying*.
- **Consolidate triggers:** prefer one scheduled sweep that dispatches to jobs over many per-feature timers — fewer quota surprises, one visible schedule.

## Config & schema
- **Idempotent `setupSheet()`** that builds tabs + headers + formatting from code; re-runnable safely. (Apple Migration)
- Centralise everything tunable in a `CONFIG` object or, better, a Config tab.
- **Pin `timeZone`** in `appsscript.json` and store dates as `yyyy-MM-dd` — date drift is a classic trigger-job bug. *(added 2026-07)*
- `setupSheet()` also sets the **visual layer**: frozen bold headers, column widths, validation dropdowns, and status colours as conditional-formatting rules (Pending amber · Done green · Error red · Stale grey). *(added 2026-07)*

## Security (the recurring failure here)
- **Never commit credentials.** Several scripts in this category have live Chat webhook URLs and a Gemini API key in source. Put secrets in **`PropertiesService` / Script Properties**, and rotate anything that's been committed.
- Prefer **header-name column lookup** over the positional column maps these scripts use — they break when a column is inserted.
