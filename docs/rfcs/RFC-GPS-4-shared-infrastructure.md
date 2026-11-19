# RFC-GPS-4 — Shared infrastructure: the second Worker

**Status:** Draft
**Project:** `projects/transport/`
**PRD:** `projects/transport/docs/PRD.md` Revision 4
**Ticket:** G-A (`docs/tickets/gps/G-A.md`)
**Author:** Claude (Sonnet 5.5), for Dan to review
**Created:** 2026-11-19

---

## Why this needs an RFC

PRD §14: a second Cloudflare Worker beside the EMIS relay, the shared Ops Alerts webhook, and non-GAS `.mjs` code that sits outside the Apps Script project.

## What exists today

The Worker is **built** in the separate repo `christwood-transport-gps` (Worker `christwood-transport-gps`, D1, crons). Its README, `docs/DELIVERY-CONTRACT.md`, `src/readapi.mjs` and `src/auth.mjs` define the endpoints and headers GAS calls. The EMIS relay is the precedent for a Worker in the same Cloudflare account.

## Decision

- The Worker lives in its **own repo and its own Cloudflare Worker**, not in `projects/transport/`. This supersedes the PRD's `gps-worker/` folder idea; `.claspignore` still excludes `gps-worker/**` so that folder can never be pushed to Apps Script if one is ever added.
- `.claspignore` also excludes `docs/**`, `test/**` and `tickets/**`. The existing `**/**` plus `!*.js`/`!*.html` rules already left subfolders out; the explicit lines are the safety net and a statement of intent.
- GAS holds the Worker URL and secrets (read-API secret, config secret) in **Script Properties only**. **TODO(human):** the real Worker URL, D1 ID and secrets are supplied at deployment; none appears in any file.
- The Ops Alerts webhook is shared with the Worker and is a Script/Worker secret, never in source.
- One reviewer outside the author signs the sharing lists at Gate 2 (T27).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Put `.mjs` Worker code in `projects/transport/` | `clasp` and the repo's per-project folder rule assume Apps Script only. |
| Extend the EMIS relay Worker | Different failure domain and blast radius; a GPS bug must not take the relay down. |

## Open points

Cloudflare account ownership, billing and who rotates the secrets (PRD Q-list) are for Dan.
