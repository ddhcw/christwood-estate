# RFC-0004 — Deploy identity: the deployer is the runtime

**Status:** 📝 **Draft** (awaiting Dan)
**Projects:** `projects/transport/`, `projects/purchase/`, `projects/calllog/`, and the
Projects Tracker deploy job (`ddhcw/christwood-projects-tracker`, `src/Deploy.js`)
**Author:** Dan + Claude · **Created:** 2026-10-13
**Amends:** RFC-0003 ("runs on Google's infrastructure as Dan")

---

## Problem

All three web apps here are `executeAs: USER_DEPLOYING`. In Apps Script that
means **the account that last updated a deployment is the account the app runs
as.** Not the owner, not whoever wrote the code: whoever last pressed Deploy.

RFC-0003 put the deploy job on a time-driven trigger installed by dan@. Every
approved release repoints the live deployment, so every release silently makes
dan@ the runtime.

That broke transport on 2026-09-22. Its "Fleet Fuel Reports" folder is owned by
automations@ and dan@ is only a viewer, so fuel report generation fails with
"Access denied: DriveApp". Purchase was also job-deployed on 2026-09-22 and now
runs as dan@. Its approval emails now come from dan@. calllog was created by
frontoffice@ and has not been job-deployed yet, so it still runs as
frontoffice@ (inferred: nothing has redeployed it; not verifiable from here).

The estate convention is that automations@ owns triggers and is the runtime
(Christwood-GC-mega-project PRD, D2). Nothing enforced it.

## Decision

1. **Each project declares its runtime account** in a `Runs as` row in
   `PROJECT.md`. For all three: `automations@christwood.edu.in`.
2. **The deploy job's trigger is owned by automations@.** dan@'s copy is
   deleted. A trigger runs as its owner, so the job, and every deployment it
   moves, is then automations@.
3. **The job refuses to deploy as anyone else** (the guard, below).
4. **The three apps are moved onto automations@ once, by hand**, by editing each
   existing deployment in place. Links do not change. See the runbook.

## The guard

In `Deploy.js`, before the PR is merged and before anything is pushed or
moved:

- Read `projects/<slug>/PROJECT.md` from GitHub **at the reviewed SHA** and take
  the `Runs as` account.
- Compare it with `Session.getEffectiveUser()`, which for a trigger is the
  trigger's owner.
- If they differ, or either is unknown: `Deploy state` = `Failed`, note starts
  "Wrong deploy account" and names the fix. **Approve stays ticked**, nothing is
  merged, and one Ops Alert is posted per run (6-hour cooldown, so the hourly
  trigger does not spam). Once the trigger is fixed, the row deploys by itself.
- Rollback moves the live deployment too, so it gets the same check, against
  `PROJECT.md` on the default branch.
- `checkDeployAccount()` is the manual twin (shipping standards §6): Agent menu
  → "Check the deploy account". Changes nothing; reports who it runs as,
  whether this account owns a `deployApproved` trigger, and per project whether
  a deploy would be allowed.

**Why `PROJECT.md`, not a Config cell.** The tracker's config-as-data pattern
fits tunables. This is not a tunable. It is a safety check, and RFC-0003 rule 5
already says the deploy target comes from the repo so that editing a cell
cannot redirect a deploy. The same holds here: if the expected account lived in
a cell, anyone who can edit Config could make the guard agree with the wrong
account. In the repo, changing it needs a reviewed PR. It also sits next to the
code it describes, so whoever reads `PROJECT.md` sees the footgun.

## Why no Google credentials on the laptop or in GitHub

The tempting fix is "let Claude or CI deploy as automations@". That means a
refresh token for automations@ in `~/.clasprc.json` or a GitHub secret.

- automations@ currently holds **Super Admin**. A leaked token for it is a
  leaked domain.
- A laptop token lives as long as the laptop. A GitHub secret is readable by any
  workflow anyone can get merged.
- It is unnecessary. The trigger-owner model already gives us "runs as
  automations@" with the credential held by Google, never exported.

So: no Google credentials in GitHub Actions, routines, or files, and clasp on
the laptop stays logged in as dan@ for read-only use. Every step that needs
automations@ is a human step in a browser.

## Open question

**Should automations@ keep Super Admin?** It needs Editor on the scripts and
sheets it runs, the Apps Script API user setting, and Drive ownership of what
it writes. None of that needs Super Admin. Removing it shrinks the damage from
any compromise of its triggers or session. Anything that genuinely needs Admin
SDK should be listed first, and given a narrower custom admin role. **Dan to
decide; not part of this rollout.**

## Visible changes for staff

- Purchase approval emails come **from automations@** instead of dan@.
- Transport fuel reports work again.
- No links change.

## Rollout

Full steps, phone-friendly: [`docs/runbooks/deploy-identity-cutover.md`](../runbooks/deploy-identity-cutover.md).

1. Pause: `agent_deploy_enabled` = FALSE (pauses exactly these three projects).
2. As automations@: confirm Editor on the three scripts and the tracker; turn on
   the Apps Script API user setting.
3. As automations@: for each app, **edit the existing deployment** → New
   version → Deploy → Select all. Link unchanged.
4. Test: transport fuel report, purchase approval email sender, calllog test call.
5. As automations@: install the `deployApproved` trigger. As dan@: delete
   dan@'s `deployApproved` trigger.
6. Merge the guard PR, deploy the tracker by hand, merge this PR, run
   `checkDeployAccount()` as automations@, then set `agent_deploy_enabled` TRUE.
7. Afterwards: automations@ takes ownership of the Drive folders the apps write
   to (listed in the runbook by name).

## Follow-ups (not in this RFC)

- `installTriggers()` reinstalls `deployApproved` for whoever runs it. The guard
  makes a wrong owner harmless (refuse + alert), but splitting the deploy
  trigger out of "Install / repair triggers" would stop it happening at all.
- Transport finds its folders with `getFoldersByName`, which picks any folder
  of that name the runner can see. Storing folder IDs in config would remove
  the ambiguity.
