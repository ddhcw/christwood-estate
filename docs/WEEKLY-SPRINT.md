# The weekly sprint — how to run it

The agent works Thursday 19:00 → Saturday 07:00 IST, one ticket per hour.
Saturday morning you review what it produced. This is that routine.

---

## Before Thursday evening — queue the work

Until the Sheet→GitHub sync exists (PRD Phase 2), this step is manual.

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

## Saturday morning — review

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

---

## Saturday morning — verify and push

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

Happy? Promote:

```bash
clasp deploy --deploymentId <the live deployment id> --description "S-XXXXXXXX <what changed>"
```

That repoints the existing `/exec` URL at a new version. The URL staff use does
not change. Not happy? Do nothing — HEAD stays as a draft and the live version
is untouched.

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

| To do this | Change this in `.claude/agent-window.json` |
|---|---|
| Stop everything now | `agent_enabled: false` |
| Run past Saturday | `override_until: "2026-09-22T18:00:00+05:30"` |
| Change the weekly window | `weekly_window.start` / `.end` |
| Stop one ticket | Remove its `approved` label |

All of it takes effect on the next hourly run. The routine reads the window
before it reads anything else, so a closed window costs seconds.
