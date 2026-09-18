# Routine — work the ticket queue

You are running unattended in a cloud sandbox. Dan is not here. Nobody will
answer a question, so do not ask one — if you are blocked, say so in the PR and
stop.

## Step 1 — kill switch. Do this FIRST, before reading anything else.

Read `.claude/agent-window.json`.

- If `agent_enabled` is not `true` → stop immediately. Say "agent disabled" and
  do nothing else.
- If the current time is at or after `agent_until` → stop immediately. Say
  "window closed" and do nothing else. `agent_until` is a full **timestamp**
  with a timezone offset, not a date — compare instants, not calendar days.
  Run `date -u +%Y-%m-%dT%H:%M:%SZ` to get the current time rather than
  assuming what today is.

Do not read the repo, do not list issues, do not think about the work. Exit.

## Step 2 — pick exactly one ticket

List open issues with BOTH labels `claude-task` and `approved`.

- None → say "queue empty" and stop.
- Otherwise take the **oldest one only**. One ticket per run, always, regardless
  of how small they look.

## Step 3 — read the context

In this order:
1. `CLAUDE.md` at the repo root — the hard rules bind you.
2. The `docs/tickets/TICKET-NNNN.md` the issue names.
3. The RFC it references. **If the RFC's status is not `Accepted`, stop** and
   comment on the issue saying so. Do not implement an unaccepted RFC.
4. `projects/<slug>/PROJECT.md` — bindings and footguns.
5. `standards/category-router.md` → the matching category file.

## Step 3b — investigate-only tickets

If the ticket is marked **Investigate only**, do not change code. Read, work out
what is actually happening, and post your findings as a comment on the issue:
what you checked, what you can rule out, what you cannot determine from here,
and what a human would need to check next. Then remove `approved`, add
`awaiting-review`, and stop. No branch, no PR.

Saying "I could not determine this from the sandbox" is the correct answer when
it is true. Do not manufacture a fix to look productive.

## Step 4 — implement, through the subagents

Run them in order. Do not skip one because the change looks trivial.

| # | Agent | Job |
|---|---|---|
| 1 | `implementer` | Smallest correct diff, inside `projects/<slug>/` only |
| 2 | `reviewer` | Check the diff against `standards/`. If it reports a violation, hand it back to `implementer` once. If the second pass still violates, stop and open the PR as a **draft** explaining why. |
| 3 | `docs-writer` | Update `PROJECT.md` for what changed |
| 4 | `verifier` | Write the numbered manual test steps and the explicit "could not verify" list |

## Step 5 — open the PR

Branch `agent/S-XXXXXXXX`. Never commit to `main` — the ruleset will reject it
anyway, and trying is a bug in your behaviour, not in the ruleset.

PR body, in this order:
1. **What changed** — two or three sentences, plain.
2. **Acceptance criteria** — the ticket's list, each marked met or not met. If
   one is not met, say so. Do not quietly drop it.
3. **Manual test steps** — from `verifier`, numbered, runnable by a human.
4. **Could not verify** — from `verifier`. Be blunt. You have no Apps Script
   runtime, no Sheets, no Google auth, and you did not deploy or test anything.
   Never imply otherwise.
5. **Standards applied** — which files in `standards/` you actually read.

Then on the issue: comment with the PR link, remove `approved`, add
`awaiting-review`.

## Step 6 — stop

One ticket, one PR, done. Do not pick up a second. Do not tidy the repo. Do not
start anything nobody asked for.

## If something goes wrong

Comment on the issue with what failed and why, remove `approved` so you do not
retry the same broken thing every three hours, and stop. A failed run that says
so plainly is fine. A failed run that pretends to have succeeded is not.
