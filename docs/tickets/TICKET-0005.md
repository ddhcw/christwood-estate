# TICKET-0005 — Investigate: call-waiting entries lose the answered call

**Ref:** `S-CDA4E3B8` · **Project:** `projects/calllog/` · **Size:** investigation
**Type:** 🔍 **INVESTIGATE ONLY — DO NOT CHANGE CODE, DO NOT OPEN A PR**
**Raised by:** Stella · **Owner:** Monica

## Revision 2026-10-21: read the live v10 code, not the old v8 copy

The first investigation (24 Sep) read the old v8 `doPost` (lines 557–615). That
copy is gone: `projects/calllog/` now matches the **live script, version 10**.
Read these, in this order:

- `projects/calllog/CallLog_Sync.js` — `doPost` (line 48) → `dispatchPost`
  (line 65). No `action` (or `action: "log"`) goes to the **legacy MacroDroid
  path**; `action: "sync"` goes to `syncCalls` (line 160), the **Android app
  path**, which de-duplicates by a deterministic id derived from the call itself.
- `projects/calllog/CallLog_AppScript.js` — `handleLegacyPost` (line 573) and the
  debounce block (≈ lines 583–592, `DEBOUNCE_SECONDS`).
- `docs/` is not needed; the sync contract is described in comments at the top of
  `CallLog_Sync.js`.

What the first investigation found (about v8, may no longer hold): the debounce
compares a new POST only with the sheet's last row and drops it, silently,
when the number matches, the row is under 10 seconds old and untouched; it never
checks the call direction. So two POSTs for the same number seconds apart
collapse into one row.

**Answer separately for each path** (legacy MacroDroid, and Android app `sync`):
does the debounce still exist and is it still direction-blind; and for the app
path, would two overlapping calls (one answered, one call-waiting) get different
ids and both survive a sync? Say which path is likely in use now (the app was
syncing on 2026-10-20; whether the MacroDroid macro is still running cannot be
seen from here: say so).

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

Read the v10 files named in the revision above and answer, on the issue:

1. What exactly does `doPost` receive on each path, and what fields does it require?
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
