# Official Phone Call Logs Tracking System

**Slug:** `calllog` · **Org:** Christwood · **Category:** Hybrid Systems (GAS + Bridge)
**Status:** Launched · **Owner:** Monica · **Contact if broken:** Monica

Logs calls made and received on the school's main Android device, with caller-ID
lookup against student/parent and staff data.

## Bindings

| Thing | Value |
|---|---|
| Script ID | `1ZRksfK1GVuFBE5XZ6rDCTTpGDJB_FQqPMH6ULqueXA7MNdJrmBZBZVCP` |
| Spreadsheet | `18FQMs3HRmr9UJD9aILMtCtQjWQ5hlSEAwv7bGJXm_T4` |

## Source of truth

This directory. Baseline pulled from the deployed script 2026-09-18 and
confirmed identical to the local working copy.

## CRITICAL: this system is only half in this repo

Call capture happens in **MacroDroid on a physical Android phone** (licensed,
₹299). MacroDroid detects the call event and POSTs to the Apps Script web app,
which writes the row.

**The MacroDroid macro is not in this repository and cannot be read, tested or
changed from a sandbox.** Before concluding that a call-capture bug lives in
`CallLog_AppScript.js`, establish that the Apps Script actually received the
data. If the phone never sent it, no amount of Apps Script is the fix.

This is the single most likely way an autonomous change to this project goes
wrong: writing plausible server-side code for a client-side failure.

## Structure

| File | Role |
|---|---|
| `CallLog_AppScript.js` | Everything — `doPost` ingest, caller-ID lookup, summaries, dropdowns |
