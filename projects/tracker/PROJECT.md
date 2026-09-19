# Christwood Projects Tracker

**Slug:** `tracker` · **Org:** Christwood · **Category:** GAS Web Apps
**Status:** Launched · **Owner:** Dan · **Contact if broken:** Dan

The master tracker. Holds every project, the Suggestions queue, Staff, Config,
Webhooks and the Audit Log; syncs suggestions down into each project's own
Suggestions tab and pulls their edits back up; posts Ops alerts and the weekly
digest to Google Chat.

## Bindings

| Thing | Value |
|---|---|
| Script ID | `1OQDXpm9Ft8aMJGySK0_lmvRKxk12tyjAI8W0wTj128BlnkYpAV9mKoe3` |
| Spreadsheet | `1FzRZe0REaQdnNEJIMC-JcsqBXGa3UE7y50lJt6UHWJ0` |

## ⚠️ The local copy was a decoy

`~/Public/PROJECTS/Christwood/projects-tracker/script/Code.js` is 184 lines and
contains none of this. The deployed script is ~4,900 lines across 15 files and
was pulled into this directory on 2026-09-19. **That old folder is not a source
of truth and should be deleted or clearly marked dead** before anyone edits it
by mistake.

## Structure

| File | Role |
|---|---|
| `src/Sync.js` | The nightly two-way sync. The big one (812 lines) |
| `src/Schema.js` | Column definitions and status vocabulary |
| `src/Config.js` | Settings/Webhooks access, cached 5 min |
| `src/Notify.js` | Chat alerts, digests, `guarded_`, `audit_` |
| `src/Setup.js` | Idempotent sheet setup |
| `src/Install.js` | Installs Suggestions tabs into project files |
| `src/Migrate.js` | One-off migrations |
| `src/Admin.js` | Menu, triggers |
| `src/Util.js` | `readTable_`, fingerprints, retry, locks |
| `src/WebApp.js` | `doGet` and the web app |
| `src/Github.js` | **New** — the bridge to the estate repo |
| `Index.html`, `ui/*` | Web app shell |

## Footguns

- **`normalizeStatus_()` returns an object**, not a string, and its `/queued/`
  branch maps onto `CONFIG.STATUS.ACCEPTED`. So `"Queued for agent"` normalises
  to `Accepted` and is indistinguishable from an ordinary accepted row.
  `Github.js` therefore compares the **raw** Status string, not the normalised
  one. Anything gating on a new status value must do the same or it will match
  every Accepted row.
- Settings are cached for 5 minutes (`CONFIG.CACHE.SETTINGS_TTL`). After
  editing Config, call `clearSettingsCache_()` or wait, or you will debug a
  value that has already changed.
- `guarded_()` wraps entry points: it alerts to Ops, writes an Audit row, then
  rethrows. Use it for anything trigger-driven, or failures go silent.
- The Audit Log is append-only and swallows its own errors by design — it must
  never break the thing it is auditing.

## The GitHub bridge

See `docs/SHEET-TO-GITHUB.md` in the repo root for setup and operation.
