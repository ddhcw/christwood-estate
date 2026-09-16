# Best Practices — GAS Workspace Admin

Distilled from: Password Reset System, Google Groups Manager.

These drive the **Admin SDK (Directory)** from a Sheet to manage users and groups domain-wide. They're high-privilege: a typo can reset accounts or delete groups. Treat them accordingly.

## Admin SDK access
- Use the **Admin SDK API advanced service** (`AdminDirectory`) — no separate Cloud Console project needed for basic Directory operations.
- Requires **Super Admin or delegated admin**; document that prerequisite.
- **Page correctly:** loop on `pageToken`, cap `maxResults` (200), `orderBy` for stable output. (Groups Manager)
- Scope OAuth with **`@OnlyCurrentDoc`** where the script only needs the bound sheet plus the API.

## The house UX pattern: keyword-action console
Both tools turn a sheet into an admin console: pull current state into a tab, the admin types an **ACTION keyword** (+ a VALUE) per row, then a **Process** menu item walks the queue and applies changes via the API.
- Keep **Pull (read)** and **Process (write)** as separate explicit steps — nothing destructive happens implicitly.
- The **"type `BATCH PROCESS` in A1"** trick makes the console usable from a phone/iPad — nice for admins on the move.
- Support a **preview/generate step** before the committing action (password tool's `GENERATE` previews without applying, so it can be shared first).

## Safety rails (non-negotiable for privileged tools)
- **Audit log every action** with timestamp + result. (The password tool does; Groups Manager doesn't — add it.)
- **Confirm or dry-run destructive actions** (delete group, reset). A keyword typo should not nuke a group silently.
- **Lock sheet sharing to admins only** — anyone with edit access can run privileged actions.
- **Don't leave secrets in cells.** Generated passwords land in plaintext in the sheet and logs — clear them after delivery, or avoid storing them at all.
- Verify generated-password entropy is cryptographically reasonable.
- **Snapshot state before bulk mutation:** copy the pulled tab (or export it) before `Process` runs, so any batch can be reversed from a known-good copy. *(added 2026-07)*
- **Retry with backoff on Admin SDK 5xx/rate-limits**, and post failed batches to the admin **Ops Alerts** Chat space — a half-applied batch must be visible immediately. *(added 2026-07)*
- Console tabs get the standard visual layer: frozen bold headers and status colours as conditional-formatting rules (Pending amber · Done green · Error red). *(added 2026-07)*

## Reusable takeaway
The keyword-action console is a genuinely good idiom for admin tooling — low friction, mobile-friendly, auditable. Just pair it with logging, confirms on destructive ops, and tight sharing every time.
