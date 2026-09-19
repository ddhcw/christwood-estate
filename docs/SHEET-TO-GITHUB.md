# The Sheet → GitHub bridge

Turns a Suggestions row into a GitHub Issue, and writes the resulting PR back
into the row. Lives in `projects/tracker/src/Github.js`.

## What it does, and what it deliberately does not

**Does:** a row where `Assignee = Claude` and `Status = Queued for agent`
becomes an Issue labelled `claude-task`, and the issue number is stamped into
`GH Issue`. Idempotent on `Ref` — re-running creates nothing new.

**Does not:** add the `approved` label. That label is what makes an issue
eligible for an unattended run, and a human adds it after writing a ticket with
numbered acceptance criteria.

This is the important design decision. The first sprint showed why: *"the
dashboard should highlight double entries for all entered data"* only became a
workable ticket once Dan said a duplicate means same vehicle + same date + same
amount. Handed to an agent raw, it produces a confident guess. The bridge
removes the typing, not the thinking.

## Setup — one time

**1. Create a fine-grained PAT.** GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained. Scope it to **`ddhcw/christwood-estate`
only**, with:

| Permission | Level |
|---|---|
| Issues | Read and write |
| Pull requests | Read and write |
| Contents | Read-only |
| Metadata | Read-only (automatic) |

Nothing else. Set an expiry you will actually notice — 90 days is reasonable.

**2. Store it.** Tracker → Extensions → Apps Script → Project Settings →
Script Properties → add `GITHUB_TOKEN` with the token as its value.
**Never in the Config tab, never in source** (non-negotiable #1).

**3. Deploy and wire.** From this repo:

```bash
cd projects/tracker
clasp push
```

Then in the tracker's Apps Script editor, run **`setupGithubBridge`** once. It
is idempotent — run it as often as you like. It adds:

- `GH Issue`, `GH PR`, `Agent Status`, `Queued by` columns on Suggestions and Archive
- a `github_repo` row in Config (leave blank to keep the bridge off)
- `Queued for agent` in the Status dropdown
- a Thursday 18:00 push trigger and a Saturday 08:00 pull trigger

**4. Set the repo.** Config tab → `github_repo` → `ddhcw/christwood-estate`.
Blank disables everything.

**5. Check it.** Run `githubBridgeStatus` and read the result. It reports what
is wired and what is not, and changes nothing.

## Weekly use

| When | What |
|---|---|
| Any time | Set Assignee `Claude` + Status `Queued for agent` on rows you want worked |
| Thu 18:00 | Push trigger creates the issues |
| Thu 18:00–19:00 | **You write the tickets and add `approved`** |
| Thu 19:00 – Sat 07:00 | The agent works the approved queue |
| Sat 08:00 | Pull trigger writes PR links and status back into the sheet |

Both triggers have manual twins — `pushQueuedToGithubNow` and
`pullGithubStatusNow` — per shipping standards §6, so you never have to wait
for a schedule to check state.

## The Lead gate

Only a Lead should be able to hand work to the agent. The check compares the
`Queued by` column against Staff rows whose Role contains "Lead".

**It is not enforced until `Queued by` is populated.** When the column is
missing the run writes *"Lead gate NOT enforced"* to the Audit Log rather than
implying a check it did not perform (non-negotiable #9). Filling that column
automatically is a follow-up — an `onEdit` that stamps the editor's email when
Status changes to `Queued for agent`.

⚠️ **`Claude`'s Staff row currently has Role `Lead`.** Change it to `Agent`, or
the agent counts as a Lead the moment this gate goes live.

## Failure behaviour

- No `github_repo` or no token → skip, write one Audit line, no alert. Being
  unconfigured is not a failure.
- GitHub 5xx or 429 → three attempts with backoff (`withRetry_`).
- Anything else → the row is skipped, counted, and reported; one Ops alert per
  run, not per row. `guarded_` catches, alerts, audits and rethrows.
- A partial run is safe to re-run: rows with a `GH Issue` are skipped, and an
  issue already carrying the Ref is found rather than duplicated.
