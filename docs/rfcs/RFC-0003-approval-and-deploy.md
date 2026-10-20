# RFC-0003 — Automated Runs tab, approval, and gated deploy

**Status:** ✅ **Accepted** (2026-09-22, Dan answered all three)
**Project:** `projects/tracker/` (plus a new deploy path into every project)
**Author:** Dan + Claude · **Created:** 2026-09-22

---

## What Dan asked for

1. An **Automated Runs** tab in the dashboard listing every action the agent
   took: date, project, ticket, actions taken.
2. **Only Dan can approve.** Others may look.
3. Approval causes the reviewed code to be **pushed**, by a second routine
   running hourly Tuesdays and Thursdays, 09:00–17:00.
4. That routine pushes **only already-written, already-reviewed code** —
   nothing else.
5. All of it tracked in the tracker Sheet.

## Two constraints that decide the architecture

### The dashboard cannot know who is looking

`projects/tracker/appsscript.json` deploys the web app as
`executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`, and `WebApp.js:6`
states the consequence plainly: *"Session.getActiveUser() is empty and the page
cannot know who is looking."*

An Approve button in that web app is therefore unauthenticated. Anyone holding
the link could press it. Changing the app to `DOMAIN` + `USER_ACCESSING` would
fix identity but forces every current user through a Google sign-in and breaks
the anonymous link staff already use.

**Decision: approval does not live in the web app.** The Automated Runs tab is a
read-only view for everyone. Approval is a **checkbox in a protected column of
the Sheet**, editable only by the Leads the tracker already protects tabs for.

That protection is enforced by Google, not by our code — which makes it stronger
than any button we could write, and it satisfies non-negotiable #6 without
inventing a new auth model. If the checkbox is ticked, a Lead ticked it.

### A Claude routine cannot deploy Apps Script

Cloud sandboxes have no Google auth, deliberately. The deploy half cannot be a
Claude routine.

**Decision: the deploy job is Apps Script in the tracker**, using the Apps
Script API (`script.projects.updateContent`) — the same API `clasp` uses. It
runs on Google's infrastructure as Dan, on a normal time-driven trigger. No
laptop, no sandbox, no extra credentials beyond a scope.

## Architecture

```
Thu 20:00 – Sat 08:00      Claude routine writes code, opens PRs
                                      │
Sat 08:00                  GAS pulls PR state into the Sheet
                                      │
                           ┌──────────▼───────────┐
                           │  Automated Runs tab  │  everyone can read
                           │  ▢ Approve           │  only Leads can tick
                           └──────────┬───────────┘
                                      │
Tue & Thu, 09–17 hourly    GAS deploy job:
                             1. read ticked rows
                             2. verify the PR is MERGED
                             3. fetch file contents at the merge SHA
                             4. Apps Script API → target project HEAD
                             5. write result back to the Sheet
```

## The Automated Runs tab

| Column | Owner | Meaning |
|---|---|---|
| Run date | sync | When the agent did the work |
| Project | sync | Which project |
| Ref | sync | `S-XXXXXXXX`, links to the Suggestions row |
| Ticket | sync | `TICKET-NNNN` |
| Issue | sync | GitHub issue number |
| PR | sync | Link |
| Actions taken | sync | The agent's own summary |
| Could not verify | sync | The agent's honesty section, verbatim |
| Files | sync | Which files the PR touches |
| PR state | sync | Open / Merged / Closed |
| **Approve** | **Lead only** | Checkbox. **The only human input.** |
| Approved by | deploy | Stamped from the protection-enforced editor |
| Approved on | deploy | Timestamp |
| Deploy state | deploy | Not ready / Ready / Pushed to HEAD / Live / Failed |
| Deployed on | deploy | Timestamp |
| Deploy note | deploy | What happened, or why it refused |

"Could not verify" gets its own column on purpose. It is the agent's own account
of what it did not test, and it is the single most useful thing on the row.
Burying it inside a summary would defeat it.

## What "push only reviewed code" means mechanically

The deploy job refuses unless **all** of these hold:

1. The Approve checkbox is ticked, in a column only Leads can edit.
2. The PR is **merged**. Not open, not closed-without-merge.
3. The merge commit SHA recorded at approval time still matches the PR's merge
   SHA. If anything has been pushed since Dan looked, the row is refused and
   flagged, not deployed.
4. Every file to be written sits under that project's directory in the repo.
5. The target script ID comes from the repo's committed `.clasp.json`, never
   from the Sheet — so editing a Sheet cell cannot redirect a deploy at another
   script.
6. `Deploy state` is not already `Pushed` or `Live` — idempotent re-runs
   (non-negotiable #8).

Content is fetched **from GitHub at the merge SHA**, never from a working copy.
The bytes deployed are the bytes reviewed.

## One-stage deploy (as decided)

**Approve → merge the PR → push → new version → live deployment repointed.**

The section below records the two-stage design that was *rejected*, because the
reasoning still governs the rollback and SHA requirements above.

### Rejected: two-stage

Apps Script separates HEAD from versioned deployments. `clasp push` updates HEAD;
the live `/exec` URL keeps serving its pinned version until someone promotes it.
That separation is what makes `/dev` testing possible, and it is already the
documented weekly loop in `docs/WEEKLY-SPRINT.md`.

So:

- **Approve** (checkbox) → pushed to HEAD → `Deploy state: Pushed to HEAD`.
  Dan tests on `/dev`.
- **Promote** (a second checkbox) → new version, live deployment repointed →
  `Deploy state: Live`.

Dan's request said "approve → push", which this satisfies — the code is pushed
and testable within the hour. What it does not do is put unrun code in front of
staff on a single click. These are school systems handling purchase approvals,
transport records and call logs; the agent states in every PR that it executed
nothing.

⚠️ **This is open question 1.** A single-stage "approve = live" is buildable if
Dan wants it. It would mean code that has never been executed reaching staff
without anyone running it once.

## Time-driven triggers execute HEAD

A sharp edge worth stating, because it already bit us. Pushing to HEAD is not
fully inert: **time-driven triggers run HEAD code, not the deployed version.**
Transport has five (`rebuildAnalytics` 01:00, `nightlyBackup` 02:00,
`morningChecks` 07:00, weekly digest, monthly report).

So a HEAD push on Tuesday afternoon means Wednesday's 01:00 analytics rebuild
runs the new code against live data.

Mitigation: the deploy job records which trigger functions a project has and
puts them in `Deploy note`, so the row says *"⚠️ 5 time-driven triggers run HEAD
— next fires 01:00"* rather than leaving it implicit. Suppressing it properly
needs a guard inside each project's trigger entry points, which is its own
ticket.

## Failure behaviour

Per non-negotiables #7 and #9:

- Apps Script API 5xx/429 → three attempts with backoff, then `Failed` plus an
  Ops alert. The row stays approved and retries next hour.
- SHA mismatch → `Failed — changed since approval`, **Approve unticked**, Ops
  alert. Dan re-reviews. Never deploy something that moved after review.
- API disabled or missing scope → one clear Ops alert naming the fix, and a
  skip. Not a per-row failure.
- Partial multi-file write → the Apps Script API replaces all files in one call,
  so it is atomic per project. Either the whole push lands or none of it does.
- Anything unexpected → `guarded_` alerts, audits, rethrows.

Every state change also writes an Audit Log row, so the Sheet keeps the history
even if a row is later edited.

## What this does not do

- Does not merge PRs. Dan merges in GitHub after reading the PR.
- Does not close issues or tracker rows.
- Does not touch any project not in `projects/` with a committed `.clasp.json`.
- Does not run tests. There are none to run.

## Decisions (Dan, 2026-09-22)

| # | Question | Answer |
|---|---|---|
| 1 | Two-stage or one? | **One stage.** Approve → merged, pushed, and live. |
| 2 | Where does Dan work? | **The Sheet, only.** The deploy job merges the PR itself. |
| 3 | Which projects may deploy? | **Every deployment requires Dan's approval** — no project is exempt from the gate. `tracker` is excluded from deploying *itself*; see below. |

### Consequences of one-stage

Approved code reaches staff within the hour, without anyone having executed it
— the agent states in every PR that it ran nothing. The `/dev` test step in
`docs/WEEKLY-SPRINT.md` is no longer on the path; the review of the diff and the
"Could not verify" section is the whole check.

Dan has decided this, and it is implemented. Two things therefore become
load-bearing rather than nice to have:

- **Rollback.** Every deploy captures the target's current content first and
  stores the version number it replaced. A `Rollback` checkbox restores the
  previous version and repoints the live deployment. One stage in, one stage
  out.
- **The SHA check.** With no `/dev` pause, the only guarantee that deployed
  bytes are reviewed bytes is that the merge SHA still matches what Dan saw.

### The tracker does not deploy itself

`tracker` is excluded from the deploy job. A bad push to `Deploy.js` would break
the mechanism doing the pushing, and the recovery would be hand-editing in the
Apps Script editor with no working rollback. Tracker changes stay a manual
`clasp push`. Everything else in `projects/` is eligible, still gated on the
tick.

### Sheet authority over the repo

Ticking Approve now merges a pull request. The Sheet has been read-only with
respect to the repo until now, deliberately. This is a real inversion, accepted
knowingly: the protected column is Lead-only and Google-enforced, the merge is
recorded in the Audit Log and in GitHub, and a merge is revertable.

## Setup this will need from Dan

- Enable the Apps Script API at <https://script.google.com/home/usersettings>
- Add `https://www.googleapis.com/auth/script.projects` to the tracker's
  `oauthScopes`, then re-authorise
- Confirm the Suggestions/Automated Runs protection list is exactly who should
  be able to approve
