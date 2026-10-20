# Routine — work the ticket queue

You are running unattended in a cloud sandbox. Dan is not here. Nobody will
answer a question, so do not ask one — if you are blocked, say so in the PR and
stop.

## Step 1 — kill switch. Do this FIRST, before reading anything else.

Read `.claude/agent-window.json`, then run `date -u +%Y-%m-%dT%H:%M:%SZ` to get
the real current time. Do not assume what day it is.

Stop immediately, saying why and doing nothing else, if any of these hold:

1. `agent_enabled` is not `true` → "agent disabled".
2. `override_until` is set and the current time is at or after it → "override
   expired".
3. `override_until` is null **and** the current time is outside this week's
   `weekly_window` → "outside window".

### Computing the weekly window

All times are in the file's `timezone` (`Asia/Kolkata`, UTC+05:30). Convert the
current UTC time into that zone first, then ask: is now between the most recent
`start` and the `end` that follows it?

The window crosses midnight and a day boundary, so do not compare day names
alone. Worked example for the default Thursday 20:00 → Saturday 08:00:

- Friday 02:00 IST → inside (after Thursday 20:00, before Saturday 08:00)
- Saturday 07:59 IST → inside
- Saturday 08:01 IST → outside
- Thursday 19:59 IST → outside
- Monday any time → outside

If `override_until` is set and the current time is before it, the window is
open regardless of the weekly schedule. That is the escape hatch for a sprint
that needs to run long.

When you stop for any of these reasons, stop **before** listing issues or
reading the repo. A closed window must cost nothing.

## Step 2 — pick exactly one ticket

List open issues with BOTH labels `claude-task` and `approved`.

- None → say "queue empty" and stop.
- Otherwise take the **oldest one only**. One ticket per run, always, regardless
  of how small they look.

## Step 2b — no ticket yet? Decide first, build second

Look for the issue's ticket: a `docs/tickets/TICKET-*.md` that names its Ref, or
`docs/tickets/auto/<Ref>.md`. If one exists, go to Step 3.

If none exists — the normal case for work queued from the Sheet — run the
`ticket-writer` subagent with the issue text and the project's `PROJECT.md`. It
returns exactly one verdict:

- **READY** — it wrote `docs/tickets/auto/<Ref>.md`. Go to Step 3 and treat that
  file as the ticket. It is committed on the branch, so it appears in the PR.
- **NEEDS-RFC** — comment on the issue with the threshold it hit and the open
  questions, remove `approved`, add `blocked`. Stop. No branch, no PR. Never
  write or accept an RFC yourself.
- **NEEDS-INFO** — comment on the issue with its questions (at most three),
  remove `approved`, add `needs-info`. Stop. No branch, no PR. If it says the
  cause is outside the repo, follow Step 3b instead.

Never override the subagent's refusal to get a ticket built.

## Step 3 — read the context

In this order:
1. `CLAUDE.md` at the repo root — the hard rules bind you.
2. The ticket (hand-written `docs/tickets/TICKET-NNNN.md`, or the one from
   Step 2b).
3. The RFC it references, if any. **If the RFC's status is not `Accepted`,
   stop** and comment on the issue saying so. Do not implement an unaccepted
   RFC. (Auto-written tickets reference no RFC: one that needed it was already
   refused in Step 2b.)
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
0. If the ticket came from Step 2b, open with: "The ticket in
   `docs/tickets/auto/` was written by the agent from the raw suggestion. Check
   its acceptance criteria say what you meant before anything else."
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
