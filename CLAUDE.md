# Christwood Estate — repo-level instructions

Private monorepo for Christwood School's Google Apps Script estate.
K-12 Google Workspace environment. Users are teachers, office staff and school
leadership — mostly on phones, mostly non-technical.

## Read these first

1. `standards/category-router.md` — routes the task to its category file
2. `standards/categories/<category>.md` — the matching best-practices file
3. `standards/estate-wide-best-practices.md` — applies to everything
4. `standards/project-shipping-standards.md` — how work ships and is maintained
5. `projects/<slug>/PROJECT.md` — what this project binds to

Do not restate these ad hoc. Read them.

## How work flows

suggestion → RFC (if non-trivial) → ticket → branch → PR → human review → deploy

- RFC required for: schema changes, new triggers, changes to who gets notified,
  anything touching more than one project. See `docs/PRD.md` §7.
- All implementation runs through the Sonnet-class subagents in `.claude/agents/`.
- One ticket per branch. Branch name: `agent/S-XXXXXXXX`.

## Hard rules for autonomous runs

- **Never push to `main`.** Open a PR.
- **Never `clasp push`.** There is no Google auth here and deployment is a human step.
- **Never edit outside the ticket's `projects/<slug>/`.**
- **Never invent a Spreadsheet ID, Drive folder ID, deployment ID or email address.**
  If you need one, write `TODO(human)` and say so in the PR.
- **Never add a secret.** Secrets live in Script Properties.
- You cannot execute Apps Script here. State plainly what you could not verify.

## Non-negotiables (full text in standards/)

1. Secrets in Script Properties, never in source
2. Locate columns by header name, never position
3. Batch I/O — read once, write once
4. Idempotent `setupSheets()`, including the visual layer
5. Config as editable sheet data, not code constants
6. Server-side auth on every endpoint
7. Retry → fallback → Ops Alerts. No silent failure
8. Idempotent re-runs
9. Honest state — errors and stale count as pending
10. Regeneration never destroys entered data
11. Timezone `Asia/Kolkata`; dates `yyyy-MM-dd`
12. Bursty concurrent writes don't belong in Sheets

## Visual identity

Primary blue `#1e3a5f`, gold `#d4a853`. Status vocabulary: Pending amber ·
Done green · Error red · Stale grey, colour always paired with icon or text.
Mobile-first ~360px, ≥44px targets. Never a blank page.

## What is and is not in this repo

This monorepo holds **only the projects that had no repository of their own**:
`purchase`, `transport`, `calllog`.

Everything else in the estate lives in **one repo per project**, named
`ddhcw/christwood-<project>`:

| Project | Repo |
|---|---|
| Projects Tracker | `ddhcw/christwood-projects-tracker` |
| Oasis IEP System | `ddhcw/christwood-oasis` |

**Do not add a project here that already has a repo.** The tracker was
mistakenly copied in on 2026-09-19 and removed on 2026-09-22; for three days
two sources of truth existed for one script, and a `clasp push` from the wrong
one would have reverted work that was already live.

Before onboarding any project, check the `GitHub Repo` column on the tracker's
main tab, and check for a `.git` directory in the project folder. Folder names
with spaces are easy to miss — `Projects Tracker/` was.
