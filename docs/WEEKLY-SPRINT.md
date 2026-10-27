# The weekly sprint — how to run it

The agent works in two windows a week. The windows live in
`.claude/agent-window.json` (`windows` list) and are the only source of truth;
the times below are examples. At the time of writing: Tuesday 20:00 → Thursday
08:00 IST (`tue-thu`, max 8 tickets) and Thursday 20:00 → Saturday 08:00 IST
(`thu-sat`, max 10 tickets). Each run takes up to two tickets, and each window
has a ticket cap (`max_tickets`). You review the morning each window closes.
This is that routine.

| Window | You review | Its PRs deploy on |
|---|---|---|
| Tue 20:00 → Thu 08:00 (`tue-thu`) | Thursday morning | Thursday 09:00–17:00 |
| Thu 20:00 → Sat 08:00 (`thu-sat`) | Saturday morning | Tuesday 09:00–17:00 |

Deploys run Tuesday and Thursday 09:00–17:00 only: a PR approved at Thursday
morning's review goes live that Thursday; one approved at Saturday morning's
review goes live the following Tuesday.

---

## Before a window opens — queue the work

**Normal path — nothing to do but queue it.** In the tracker, set a row's
Status to "Queued for agent" and Assignee to "Claude". The next hourly push
opens the issue **with `approved`** (Config `agent_auto_approve`, default TRUE).
The push only sends rows queued by a Lead, and only to the repo the project's
`GitHub Repo` cell names. A row that fails either check is **held, not sent**:
its note reads "Not sent: …", and it appears under On hold on the Control Room
tab until the cell is fixed.
In the window the agent's `ticket-writer` step reads the raw suggestion and
either writes the ticket (`docs/tickets/auto/<Ref>.md`, in the PR for you to
check) or stops with a comment — `blocked` (needs an RFC) or `needs-info` (it
asked you up to three questions). Nothing reaches staff without your Approve
tick on the Automated Runs tab.

Set `agent_auto_approve` to FALSE in Config to go back to the manual path
below, where the issue waits for you to write the ticket and add `approved`.

### Manual path (a hand-written ticket, or `agent_auto_approve` off)

For each suggestion you want worked:

1. Decide whether it needs an **RFC**. It does if it changes a data schema, adds
   a trigger, changes who gets notified, or touches more than one project.
   Write it in `docs/rfcs/`, resolve every open question, mark it **Accepted**.
   An RFC left as Draft is a hard stop — the agent will refuse the ticket.
2. Write `docs/tickets/TICKET-NNNN.md` with numbered acceptance criteria.
   Vague criteria produce confident nonsense; this is the highest-leverage
   thing you do all week.
3. Open a GitHub Issue titled `[S-XXXXXXXX] <summary>`, labelled `claude-task`.
4. Add `approved` when it is genuinely ready. **`approved` is the trigger.**

**Ticket sizing.** Small and concrete works. "Remove field X from screen Y" is
a good ticket. "Build a system to do Z" is not a ticket, it is a project.

**Investigate-only.** For anything where the cause might be outside the repo —
a MacroDroid macro, a phone, a third-party service — label it
`investigate-only`. The agent reports findings and changes nothing. This is the
right call more often than it feels like it should be.

---

## Review mornings (Thursday and Saturday)

```bash
cd ~/Public/PROJECTS/Christwood/christwood-estate
git fetch
gh pr list --state open
gh issue list --label awaiting-review
```

Read every PR body in this order, and do not skip the third:

1. **Acceptance criteria** — each marked met or not met. A "met, with a caveat"
   is the agent flagging something; read the caveat.
2. **What changed** — the summary.
3. **Could not verify** — the agent has no Apps Script runtime, no Sheets, no
   Google auth. It did not test anything. This section is where it tells you
   what that cost. Treat a PR that claims it was tested as a red flag.

Judge the *pipeline* as much as the code: did it stay inside its project
directory, keep secrets and names out of source, and tell the truth about what
it could not check?

**Before you start, check the tracker's Control Room tab** (or the dashboard's
"Control room" view). Its health line says whether the window went as expected:

- **Healthy** — the agent ran through the window. Read the PRs and the events.
- **No runs** or **Silent** (red) — the agent did not run, or went quiet. Check
  the routine at claude.ai/code before you read anything else.
- **Failed** (red) — at least one run failed. Its event says why.
- **Can't tell** (grey) — GitHub has not been read since the window end. Use
  Tracker Tools → Agent → Refresh now in the tracker, then look again.

The Control Room also lists **Needs you** (answers and decisions for you),
**On hold** (queued rows that were not sent, usually a missing `GitHub Repo`),
and **Queue** (what is waiting for the next window).

The window-end Chat digest arrives about 09:00–10:00 on the review morning. It
gives the same counts and the top items, with a button to the control room. If
no digest arrives, the Control Room is still the place to look.

**Heartbeat issue.** Each run comments once on one locked issue, titled
`Pipeline heartbeat YYYY-MM`, in the agent repo. The tracker starts a new one
each month at the window end. Do not close it by hand. A window with no
heartbeat comments means the routine did not run in that window.

---

## After review — verify and push

Apps Script has staging built in. `clasp push` updates **HEAD** only; the live
`/exec` URL keeps serving the deployed version until you promote it. Nobody is
affected while you test.

```bash
cd projects/<slug>
git checkout main && git pull        # after merging the PR
clasp push                           # updates HEAD, NOT the live web app
clasp list-deployments               # note the @HEAD deployment id
```

Open the **`/dev` URL** (the `@HEAD` deployment). That runs the new code.
Work through the PR's **manual test steps** — they were written for this.

⚠️ **HEAD shares the live Spreadsheet.** Testing on `/dev` writes real rows. Use
obviously-fake test data and clean it up, exactly as the test steps say. For a
change that could corrupt existing data rather than just add rows, take a copy
of the Sheet and test against that instead.

Happy? Promote, **as the account named in the project's `PROJECT.md` `Runs as`
row** (for most projects that is automations@), **in a browser, editing the
existing deployment**: Apps Script editor → Deploy → Manage deployments → edit
the existing deployment → Version: New version → Deploy. The `/exec` URL staff
use does not change. Not happy? Do nothing — HEAD stays as a draft and the live
version is untouched.

⚠️ Never use `clasp deploy` for a project that runs as automations@ — it would
deploy as the wrong account. Never create a new deployment where one exists.

Then close the loop:

```bash
gh issue close <n> --comment "Deployed and verified <date>."
```

And update the tracker row to `Done`.

---

## After the sprint

- **Close what's resolved.** A "no PR, the premise was false" result is a good
  outcome — close the issue as already-resolved rather than leaving it open.
- **Answer blocked RFCs.** Anything Draft is dead weight until you decide.
- **Re-queue what failed**, with a better ticket. The usual cause of a bad
  result is a vague acceptance criterion, not a bad agent.

---

## Controls

| To do this | Do this |
|---|---|
| Stop everything now | `.claude/agent-window.json`: `agent_enabled: false` |
| Pause the agent without a code change | Add the GitHub label `agent-paused` to any open issue (create the label if it is missing). The routine stops with "paused" while one is open. A tracker Config row `agent_paused` that would automate this is planned and not yet built |
| Run outside the windows once | `override_until: "2026-09-22T18:00:00+05:30"` — one-off; an expired value is ignored and never blocks later windows |
| Change a window or its cap | `windows[].start` / `.end` / `.max_tickets` |
| Change tickets per run or run length | `max_tickets_per_run`, `run_time_budget_minutes` |
| Stop deploying approved PRs | Set the `agent_deploy_enabled` row to FALSE on the Config tab of the Projects Tracker. This stops deployments; the routine does not read it |
| Stop one ticket | Remove its `approved` label |

All of it takes effect on the next hourly run. The routine checks the window
before it reads anything else, so a closed window costs seconds.
