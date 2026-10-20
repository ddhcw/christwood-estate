# Official Phone Call Logs Tracking System

**Slug:** `calllog`
**Org:** Christwood
**Category:** Hybrid Systems (GAS + Bridge)
**Status:** Launched
**Owner:** Monica
**Contact if broken:** Monica
**Tracker link:** TODO(human): tracker `/exec` link with `?project=` set to the tracker Name
**Repo:** `projects/calllog` (estate monorepo)
**Doc status:** Draft — not yet checked by a person

## What it is

The call log for the school's main Android device. It records calls made,
received and missed, looks up the caller's name and student against the
student and staff import tabs, and holds a Nature of Query for each call.
The Apps Script web app receives calls from the handset and writes them to the
Call Log sheet.

## Who uses it

Monica owns the system. Staff who answer the school's calls classify them on
the handset or in the sheet. Office and leadership staff read the Summary and
the PDF reports. How many people use it is not recorded (see Could not verify).

## What it does

- Takes batch syncs from the Call Log Sync Android app. Each call has a hash id,
  and the id is the dedupe key, so re-sent calls are skipped.
- Resolves each new call's caller name, student, grade and section from the
  `importSD` and `importHR` tabs by phone number, then appends the row to the
  Call Log.
- Takes a classify request from the handset and writes a Nature of Query and
  a Type of Call to one row. The row must match the one the dedupe index holds
  for that call id.
- Serves the dropdown lists from the `scratch` tab, so the app and the sheet
  show the same options.
- Still accepts the original MacroDroid body (no `action` field). Repeats of the
  same number and direction within 10 seconds are dropped.
- Builds the Summary, PDF reports (saved to a Drive folder), diagnostics and
  a phone-number cleanup from the Sheet's 📞 Call Log menu.

## Bindings

| Binding field | Value |
|---|---|
| Script ID | `1ZRksfK1GVuFBE5XZ6rDCTTpGDJB_FQqPMH6ULqueXA7MNdJrmBZBZVCP` |
| Spreadsheet(s) | `18FQMs3HRmr9UJD9aILMtCtQjWQ5hlSEAwv7bGJXm_T4` (the Call Log Tracker) |
| Drive folders by name | `<sheet folder name> REPORTS`, created beside the sheet's folder on the first report. If the folder name ends in `]`, the bracket stays at the end. |
| Runs as | `automations@christwood.edu.in` — the shared automations account, so the endpoint does not depend on one staff login |
| Execute as | USER_DEPLOYING |
| Web app access | ANYONE_ANONYMOUS |
| Live deployment | `AKfycbz-lY…6vZnUr4rHJvu4zhXjocbmp46` |
| Live version | 10 |

## Data it touches

The code finds the Call Log columns by fixed position (A to J), not by header
name. The names below are the ones the code expects. Real header names in the
live sheet are not confirmed (see Could not verify).

| Tab | Columns | Who writes them |
|---|---|---|
| `Call Log` | A `Phone Number`, B `Logged At`, C `Call Source`, D `Type of Call`, E `Caller Name`, F `Student Name`, G `Grade`, H `Section`, I `Nature of Query`, J `Notes` | The sync and classify endpoints write A to H and I to D. Staff edit C, D, F, I and J by hand. The menu rewrites dropdowns and removes blank-phone rows. |
| `_sync` (hidden) | `Call ID`, `Call Log Row`, `Call At`, `Duration (s)`, `Direction`, `Synced At`, `Device` | The sync endpoint only. Do not edit. |
| `scratch` | A `Type of Call`; B to D `Nature of Query - Parent`, `- Staff`, `- Someone Else` | Staff edit the lists. The script reads them. |
| `importSD` | `Name of the Student`, `Grade`, `Section`, and the contact and name pairs for father, mother, guardian and primary contact | Imported from outside this repo. |
| `importHR` | `Contact Number`, `Name of the Staff` | Imported from outside this repo. |
| `Summary`, `Reports`, `Diagnostics` | Rebuilt by the script | The script. Summary is not hand-edited. |

## Triggers

| Function | Schedule | Owning account | Manual twin |
|---|---|---|---|
| `doPost` (web app) | On each HTTP POST from the handset | Runs as `automations@christwood.edu.in` | Test connection in the Android app |
| `onEdit` | Simple trigger, on every edit | None (simple trigger) | Edit a Call Source cell |
| `onEditInstallable` | Installable edit trigger, made by the menu | Not recorded (see Could not verify) | Call Log menu ▸ Install triggers |

There is no time-driven trigger. A dead handset only shows in the heartbeat.

## Config and secrets

Script Properties hold the secret and the state. Values are never written to
source or to a sheet.

- `CALLLOG_SECRET`: the shared secret the handset sends. Set on 2026-10-20.
- `CALLLOG_ENFORCE_AUTH`: `true` once unauthenticated requests are rejected.
  Not set on 2026-10-20.
- `CALLLOG_UNAUTH_COUNT`: how many requests arrived without a valid secret.
  It was 15 on 2026-10-20.
- `CALLLOG_LAST_SYNC`: the last sync time, call count and device details.

The secret is shown once, in a dialog, when it is generated. Generating a new
one stops any handset that has not been given the new value.

## How to operate

Check the state first. In the Sheet, open 📞 Call Log ▸ 🔑 Sync & security ▸
**Sync status**. It shows whether the secret is set, whether enforcement is on,
the unauthenticated count, the last sync and the handset's details.

To move to enforced authentication, do this in order:

1. Confirm the handset has the secret. Its last sync must be recent.
2. Watch the unauthenticated count. It should stop rising.
3. Choose **Enforce authentication** and confirm the dialog.

If calls stop arriving after enforcing, choose **Stop enforcing (rollback)**,
then check the secret on the handset.

To change the code, edit the repo, then publish a new version to the existing
deployment. Use the full deployment ID from the Apps Script editor, not from
this file:

```
clasp push -f && clasp deploy --deploymentId <full ID from the editor> -d "what changed"
```

Afterwards, sync one call from the handset and check the new row and Sync status.

**Remove blank-phone rows** deletes rows that have no phone number, no Nature
of Query and no Notes. It cannot be undone. Review the preview first.

Errors go back to the caller as `status: error` with a short message. Nothing
posts to the Ops Alerts space yet. Exceptions are logged to Stackdriver under
the script's Cloud project (see Could not verify).

## Known footguns

- **CRITICAL: this system is only half in this repo.** Call capture on the old
  path happens in **MacroDroid on a physical Android phone**. The macro is not
  in this repository and cannot be read, tested or changed from a sandbox.
  Before you conclude that a call-capture bug is in `CallLog_AppScript.js`,
  check that the Apps Script actually received the data. If the phone never
  sent it, no Apps Script change will fix it. Writing plausible server code for
  a handset fault is the most likely way an autonomous change here goes wrong.
- **The deployed copy was out of date until recently.** This repo held an older
  copy, and the old copy was v8. A deploy from an out-of-date copy would overwrite
  the live auth and sync code. Confirm the repo matches live before any push.
- **Pushing does not change live behaviour.** `clasp push` updates HEAD only.
  The endpoint serves a frozen version until a new version is deployed to the
  same deployment ID. Always pass `--deploymentId`. A bare deploy creates a new
  URL, and the handset keeps posting to the old one.
- **The endpoint is public.** Until enforcement is on, anyone with the URL can
  post rows. The unauthenticated count is the only evidence of how much of that
  traffic is left.
- **Enforcing too early drops calls.** Enforcement rejects every request without
  the secret. Turning it on before the handset has the secret stops calls being
  logged, and that change needs the phone in hand.
- **During the overlap, every call appears twice.** While MacroDroid and the
  app both run, MacroDroid never sends a hash, so the two rows cannot match.
  Switch MacroDroid off once the app is confirmed.
- **The Call Log is written before the dedupe index.** If a run stops between
  the two writes, the next sync adds that call again. The result is a visible
  duplicate, not a silent gap.
- **Batches are capped at 400 calls.** The app splits larger batches. Nothing is
  lost, because dedupe is by hash.
- **Column positions are fixed.** The Call Log is read by position, A to J.
  Inserting or reordering its columns will break writes. This is a known gap
  against the house rule to locate columns by header name.
- **Backfill and cleanup write one cell at a time.** They can reach the
  six-minute limit on a large log. The sync path is batched.
- **Some Nature of Query values no longer match the `scratch` list.** The
  calllog-tracker notes count 882 such rows. Decide whether to restore the
  values or remap them before changing the list.
- **The heartbeat is recorded, not alerted.** Sync status shows the last sync,
  but silence does not alert anyone yet.

## Change history

2026-10-20 · T-508c · First draft written from the live v10 code
2026-10-20 · T-507 · Repo copy resynced to live v10
2026-09-18 · not recorded · Baseline pulled from the deployed script and confirmed identical to the local copy

## Could not verify

- Trigger owners: which account created `onEditInstallable`, and whether it is
  installed on the live sheet at all.
- Real header names on `Call Log`, `importSD`, `importHR` and `scratch`. The
  code reads Call Log by position and the other tabs by the names above.
- Who can view or edit the Call Log sheet, the Summary, the web app and the
  Reports folder.
- Whether the Call Log Sync app sends the shared secret. Version 0.3.0 was
  syncing on 2026-10-20, but the app source is in `calllog-tracker/android`,
  outside this repo, and was not read here.
- Whether the MacroDroid macro is still enabled on the handset. The count of
  15 unauthenticated hits suggests it may be.
- Whether the live v10 code matches this repo. The T-507 resync says it does.
  Nothing here compares the two.
- How many people use the system, and who classifies calls.
- The tracker row: its Name (this file's heading must match it), its
  `/exec` link, GitHub Repo and Status.
- Who writes `importSD` and `importHR`, and how often they refresh.
- Where the Stackdriver logs for the script's Cloud project are kept, and who
  can read them.
- Whether the Reports folder exists yet and where it sits in Drive.
- Monica's current contact details for the "Contact if broken" line.
