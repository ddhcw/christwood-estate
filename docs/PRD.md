# PRD — Autonomous Suggestions Pipeline

**Org:** Christwood
**Owner:** Dan (dan@christwood.edu.in)
**Status:** Draft → pilot
**Created:** 2026-09-16

---

## 1. Problem

Staff raise suggestions in the Projects Tracker. They queue. Dan is the only person who implements them, and he is on-site at Christwood roughly three days a week. On the other days his Claude Code weekly allowance goes unused, because the work requires a laptop he is not logged into.

Separately, the estate has no version control. Thirty-odd Apps Script projects live only in the Apps Script editor, which violates §2 of `standards/project-shipping-standards.md` ("repo is the single source of truth") and makes any automated change unsafe.

## 2. Goal

Dan marks selected suggestions in the tracker. While he is away, an autonomous agent implements them and opens pull requests. When he returns, he reviews and deploys. The agent stops on its own.

**Success looks like:** on a Monday back at Christwood, Dan opens one filtered view and sees N reviewed, house-style-compliant PRs waiting, each traceable to a suggestion Ref and each with written manual test steps.

## 3. Non-goals

- **The agent does not deploy.** No `clasp push`, no Google auth in the sandbox. It produces reviewed code; Dan deploys.
- **The agent does not touch live data.** No Sheets access, no student records.
- **This does not replace the tracker.** The tracker stays the staff-facing surface and the system of record.
- Not a general-purpose coding agent. It works one ticket at a time from an explicit allowlist.

## 4. Constraints that shape the design

| Constraint | Consequence |
|---|---|
| A Routine runs in a fresh cloud VM with a git clone only | Everything the agent needs — source, standards, project metadata — must be committed to the repo |
| Cloud sessions do not read `~/.claude/CLAUDE.md` | House style must live at the repo root, not the user profile |
| Routines run with no permission prompts | Branch protection is the only real sandbox |
| No Sheets runtime, no clasp, no execution in the sandbox | The agent codes blind; verification is a written human checklist, not a test run |
| Routine minimum interval is 1 hour | Cadence is coarse; that is fine |
| Suggestions contain staff names and operational detail | Repo is **private**, always |

## 5. Architecture

```
Projects Tracker (Sheet)          GitHub (private monorepo)        Cloud Routine
─────────────────────────         ─────────────────────────        ─────────────
Suggestions tab
  Assignee = "Claude"    ──┐
  Status = Queued           │  nightly GAS sync
                            └──►  Issue: [S-XXXXXXXX] title
                                  labels: claude-task, approved
                                                    │
                                                    ▼
                                            ┌───────────────┐
                                            │ 1. kill switch│◄── .claude/agent-window.json
                                            │ 2. one issue  │
                                            │ 3. subagents  │
                                            │ 4. open PR    │
                                            └───────┬───────┘
                                                    │
                                  PR: agent/S-XXXXXXXX
                                       │
  GH Issue / GH PR / Agent Status ◄────┘  nightly GAS poll
```

**Work always flows one way through:** suggestion → RFC (if the change is non-trivial) → ticket (GitHub Issue) → branch → PR → human review → deploy.

## 6. Repository

Single monorepo, **Christwood only**, for projects that had no repo of their
own: `christwood-estate`. Projects that already had a repository keep it — the
estate convention is `ddhcw/christwood-<project>`. See `CLAUDE.md`.

⚠️ This section originally said "nothing is published" and recommended a
monorepo on that basis. That was wrong: `christwood-projects-tracker` and
`christwood-oasis` already existed. The monorepo still earns its place for the
three projects that genuinely had nothing, but it was chosen on a false premise
and should not be extended to projects that already have a home.

```
CLAUDE.md                  house style, loaded by every cloud session
standards/                 copy of _standards (router + category best-practices)
docs/PRD.md                this file
docs/rfcs/RFC-NNNN-*.md    design decisions, one per non-trivial change
docs/tickets/              ticket source-of-truth, mirrored to GitHub Issues
projects/<slug>/           one directory per Apps Script project
  .clasp.json              scriptId — the deploy link
  PROJECT.md               what it is, what it binds to, who notices if it breaks
  *.js / *.html
.claude/agents/            Sonnet-class subagents (implementer, reviewer, docs-writer, verifier)
.claude/routines/          the autonomous prompt
.claude/agent-window.json  the kill switch, written by the GAS sync
```

Other schools get their own repos. No cross-school monorepo — different employers, different data.

## 7. Work model

All implementation runs through **Sonnet-class subagents**, never a single monolithic pass:

| Subagent | Role |
|---|---|
| `implementer` | Smallest correct change for one ticket, within one project directory |
| `reviewer` | Diff against `standards/`; read-only; separates violations from unverifiable items |
| `docs-writer` | Updates the project `CLAUDE.md` and ops README per shipping standards §3 |
| `verifier` | Cannot execute; writes the manual test steps a human runs after deploy, and states plainly what it could not verify |

**RFC threshold:** any change that alters a data schema, adds a trigger, changes who receives a notification, or touches more than one project needs an RFC merged before a ticket is opened. Everything smaller goes straight to a ticket.

## 8. Selection and control

Reuses the tracker's existing schema. New surface is deliberately tiny:

- **Staff tab** gains a row: `Claude`, Role `Agent`, Active TRUE. Assigning to Claude is the pick gesture.
- **Suggestions tab** gains Status value `Queued for agent`, and three grey columns: `GH Issue`, `GH PR`, `Agent Status`.
- **Config tab** gains `agent_enabled` (TRUE/FALSE) and `agent_until` (a date).
- Only a Staff row with Role `Lead` may set `Queued for agent`. Enforced in the sync, not the UI; violations revert and log to the Audit Log.

**Stopping — two independent mechanisms, both fail-safe:**

1. `agent_until` is a date. The sync writes it to `.claude/agent-window.json`. The routine's first action is to read that file and exit if the window has closed. If the sync dies, the sheet is unreachable, or Dan forgets, the window still expires. This is the one that matters.
2. `agent_enabled: FALSE` makes the next sync strip the `approved` label from every open issue. Immediate, visible in GitHub, reversible.

The big red button remains pausing the Routine itself.

Per non-negotiable #7, the run that first finds the switch off posts one line to the Ops Alerts space. No silent stop.

## 9. Safety

- Private repo; secret scanning and push protection on.
- Branch protection on `main`: no direct pushes, PR review required.
- Fine-grained PAT scoped to this one repo — Issues RW, Contents RW, Pull requests RW, nothing else. Stored in Script Properties (non-negotiable #1).
- One issue per run. A bad run is one bad PR.
- Tickets touching student-data paths are never queued to the agent.
- The agent never edits outside its ticket's `projects/<slug>/`.

## 10. Honest risks

- **The agent codes blind.** No runtime, no Sheets, no deploy. It cannot know whether its change works. Mitigation: queue only small, well-specified tickets; require written manual test steps in every PR; over time extract pure-logic functions so `node --test` can run in CI.
- **Deploy stays manual.** This buys reviewed PRs, not running systems. That is the correct boundary for a live school estate, but it is a real limit on "work while I'm away".
- **Stale source is the failure mode that hurts.** If a project's repo copy drifts from what's deployed, the agent rewrites code that doesn't exist and the PR silently deletes live behaviour. Mitigation: `clasp pull` sweep before any agent window opens, committed as its own baseline commit.
- **Vague suggestions produce confident nonsense.** The tracker contains both `S-ED7B7C37` ("remove route numbers in the fuel entry screen" — implementable) and `S-D35AEDB2` ("build similar system of master timetable remapping" — not a ticket). Triage is a human job and stays one.

## 11. Phasing

| Phase | Scope | Exit criterion |
|---|---|---|
| **0** | Private repo, standards committed, branch protection, pilot project reconciled from deployed source | `main` protected, `projects/purchase/` matches production |
| **1 — pilot** | One project, one ticket, end to end, run manually | A merged PR for `S-1D76EF33`, deployed and working |
| **2** | Sheet → Issue sync, selection columns, Lead-only gate | Dan queues from his phone, an issue appears |
| **3** | Kill switch, the Routine, PR status writeback, Ops alert | One unattended window produces a reviewable PR and stops on time |
| **4** | Remaining ~20 projects pulled in; calendar-driven window; deploy-on-merge desktop task | Estate-wide |

**Phase 1 gates everything.** If the pilot does not produce a PR Dan is willing to merge, the design is wrong and phases 2–4 do not start.

## 12. Pilot

Project: **Digital MRN/PRN (Purchase Requisition Automation)** — `projects/purchase/`
Ticket: **`S-1D76EF33`** — see `docs/tickets/TICKET-0001.md`

Chosen because it is the only open suggestion on a project whose repo copy is confirmed clean against production.
