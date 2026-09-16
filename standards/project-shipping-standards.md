# Project Shipping & Maintenance Standards

**Purpose:** Attach this file to any Claude conversation (new or existing) involving a project under any of Dan's working contexts. It defines how work moves from proof-of-concept to a shipped, maintained system, so Claude applies these defaults without needing to be re-briefed every time.

Applies across all contexts: **Christwood**, **Anita Methodist**, **Good Shepherd (both schools)**, and **Personal** projects.

---

## 0. Org variables

At the start of a conversation, Claude should establish (or ask, if unclear) which org this work is for, and use these variables accordingly:

| Variable | Value |
|---|---|
| `{ORG}` | Christwood / AnitaMethodist / GoodShepherd (school 1 or 2) / Personal |
| `{PROJECTS_ROOT}` | `~/Documents/Projects/<ORG>/<project-name>/` (via the symlinked PROJECTS folder) |
| `{CONTACT}` | The named person who notices/reports if this specific project breaks (see §7) — varies per project, not per org |

Everything below applies identically regardless of `{ORG}` — only paths and contact names change.

---

## 1. The core problem this file solves

Proof-of-concept work happens fast and cleanly. Implementation, feedback loops, and long-term maintenance are where things go raw — drift between what's live and what's documented, no one knows a job silently failed, fixes get made live and never make it back to the repo, and months later even Dan doesn't remember why a workaround exists.

Every rule below exists to close one of those specific gaps. When advising on a project, Claude should check new work against this list by default — not just answer the immediate question in isolation.

---

## 2. Repo is the single source of truth

- Every project that reaches "in use" status must be linked to a local repo under `{PROJECTS_ROOT}`.
- **For Google Apps Script:** clasp-linked, no editing in the online Apps Script editor once the repo exists. Any live patch made in-browser must be pulled back down (`clasp pull`) and reconciled before the next push, or it will be silently overwritten.
- **For React/Vercel projects:** no editing directly on the deployed/hosted version or through a web-based IDE once local repo + git is in place. All changes flow through the local repo → commit → deploy.
- Use `.claspignore` / `.gitignore` to keep non-source files (README, CLAUDE.md, .git) out of pushes where relevant.
- Workflow discipline: describe change → review diff → push/deploy → test → commit only once verified working.
- If a project has been "fixed live" more than once, that's a signal to Claude to flag it and propose re-syncing the repo before doing anything else.

## 3. Every project gets a CLAUDE.md

Each project folder should have a `CLAUDE.md` capturing:
- What the project is, which system/org it's for, and what it's bound to (Sheet ID, deployment URL, etc).
- A pointer back to this standards file and the best-practices file (relative path), so Claude Code auto-loads context without re-explaining.
- CONFIG-driven conventions (never hardcode names, folder IDs, column indices, env values — reference the Config source).
- Known footguns and *why* they exist — not just the fix, but the failure mode that caused it.
- Cross-system data rules (e.g. IMPORTRANGE sources are read-only; naming normalization must go through a mapping table; API keys never hardcoded).
- The standard workflow reminder (§2) so it's enforced per-project, not just remembered by Dan.

When Claude is asked to build or modify a project that doesn't have a CLAUDE.md yet, it should offer to draft one as part of the deliverable, not as an afterthought.

## 4. Git commits are the audit trail, not Dan's memory

- Commit after every verified working change, with a message that explains *why*, not just *what* ("guard B/E overwrite — nightly prepopulate was being clobbered by same-day edits," not "fix bug").
- `git log` on any project should be able to reconstruct its history without anyone needing to dig through old Claude conversations to remember why a fix exists.
- Claude should proactively suggest a commit message when a fix is confirmed working, rather than waiting to be asked.

## 5. Status is explicit, not a vibe

Every live or in-progress project should be trackable with at minimum:

| Field | Purpose |
|---|---|
| Project | Name |
| Org | Christwood / AnitaMethodist / GoodShepherd-1 / GoodShepherd-2 / Personal |
| Owner | Usually Dan, note co-owners if any |
| Repo path | Where the source of truth lives |
| Status | POC / Shipped / Maintained / Deprecated |
| Last touched | Date |
| Known issues | Open footguns, not yet fixed |
| Next review date | Forces a second look — this is the field that actually prevents rot |

A single tracker (e.g. one sheet, org as a column) is simpler than four separate trackers. When Claude helps ship something new, it should ask whether to log it here.

## 6. Every scheduled/automated job needs a manual on-demand twin

- Nightly triggers, webhooks, cron jobs, and background processes are invisible by default — no one notices when they silently fail.
- Every time-driven trigger function should have a companion manual utility function that runs the same logic on demand, so state can be sanity-checked without waiting for the next scheduled run.
- Example pattern already in use: a nightly populate job paired with manual on-demand validation-strip and cleanup utilities.
- When Claude builds a new triggered job, it should build the manual twin in the same pass, not as a follow-up request.

## 7. Feedback loops need a named human, not "staff in general"

- The person best placed to notice something's broken often isn't the person with visibility into whether an automation is silently failing.
- Every user-facing system should have a one-line "if something looks wrong, contact `{CONTACT}`" note somewhere visible (a Setup & Help tab/section is a good default pattern).
- Claude should ask "who notices if this breaks, and how do they reach you?" when finalizing a project meant for non-technical users, and record it as `{CONTACT}` for that project's CLAUDE.md.

## 8. Org-wide conventions belong in a shared skill, not Dan's head

- A shared Claude Skill (GAS conventions, React/Vercel conventions, etc.) should encode standards so they apply automatically across projects and orgs — not just when this file happens to be pasted in.
- Until that skill exists, this file plus the best-practices file are the stand-in.

## 9. Default behavior for Claude in these conversations

Unless told otherwise, when helping with any project under these orgs, Claude should:
1. Confirm/establish `{ORG}` if not obvious from context.
2. Check whether a repo/CLAUDE.md exists before assuming greenfield work.
3. Flag any live-editor/live-deploy drift risk before proposing changes.
4. Suggest a commit message once a change is verified.
5. For any new scheduled job, build the manual on-demand twin alongside it.
6. Ask about tracker status and named feedback-contact when a project is nearing "shipped."
7. Treat "it works" and "it's maintained" as two different bars — call out explicitly which one a piece of work has actually reached.

---

*Update this file directly as standards evolve — treat it the same way as a project's CLAUDE.md, and keep it in `_standards/` alongside the best-practices and writing-style files.*
