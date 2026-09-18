# TICKET-0005 — Investigate: call-waiting entries lose the answered call

**Ref:** `S-CDA4E3B8` · **Project:** `projects/calllog/` · **Size:** investigation
**Type:** 🔍 **INVESTIGATE ONLY — DO NOT CHANGE CODE, DO NOT OPEN A PR**
**Raised by:** Stella · **Owner:** Monica

## Reported behaviour

> While answering a call, if another call comes in (call waiting), the Call Log
> does not record the details of the call that was answered. Only the
> call-waiting entry is recorded.

## Why this is investigation, not implementation

This system is **half MacroDroid on a physical Android phone, half Apps Script**.
The phone detects call events and POSTs to the web app. The MacroDroid macro is
not in this repository and cannot be read, run or tested from a sandbox.

The most likely cause is that MacroDroid's call-state handling fires once for
the overlapping pair and only reports the second call — in which case the
answered call's data **never reaches Apps Script at all**, and no server-side
change can recover it. Writing Apps Script for that would be a confident fix to
the wrong layer.

## What to do

Read `CallLog_AppScript.js` and answer, on the issue:

1. What exactly does `doPost` receive, and what fields does it require?
2. Is there any path where a well-formed payload for the answered call could be
   **dropped, overwritten, or deduplicated away** server-side — for example by a
   same-timestamp or same-number collision, an upsert keyed on phone number, or
   a row-replacement rather than an append?
3. If two POSTs arrived seconds apart for the same number, would both survive?
4. Is there any logging that would let Dan tell, from the sheet or the execution
   log, whether the first call's POST ever arrived?
5. Your assessment: server-side bug, phone-side bug, or indeterminate — and what
   single check would settle it.

## Acceptance criteria

1. A comment on the issue answering all five questions.
2. **No code changed. No branch. No PR.**
3. Where you cannot tell from the sandbox, say so plainly rather than guessing.
4. If the evidence points at MacroDroid, say that clearly — that is a useful
   result, not a failure.

## Definition of done
Dan reads the findings and knows which layer to look at.
