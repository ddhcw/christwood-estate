# TICKET-0008 — Call log: the legacy debounce must also match the call direction

**Ref:** _pending — stamped here once the Suggestions row exists and has been given its Ref_ · **Project:** `projects/calllog/` · **Size:** small
**Type:** change (not an investigation)
**Raised by:** Dan, from the findings on issue #8 (TICKET-0005, v10 revision) · **Owner:** Monica
**RFC:** not needed. No schema change, no new trigger, no change to who is notified, one project only.

## Why

The MacroDroid ("legacy") path, `handleLegacyPost` in `projects/calllog/CallLog_AppScript.js`
(the debounce is the block starting at the comment "Debounce: same number+direction…"),
drops a new call when the sheet's last row has the same phone number, is under
`DEBOUNCE_SECONDS` old and has an empty Query and Notes. It never compares the
direction. The comment above it, and `PROJECT.md`, both say "number **and direction**".
Two POSTs for the same number seconds apart (for example an Incoming call and a
Missed call from the same person) therefore collapse into one row, and the second is
lost silently.

## What this does and does not fix

It fixes the mismatch between what the code does and what it claims, for the legacy
path only. It does **not** by itself fix the original report on #8 (the answered call
is missing during call waiting): if the two overlapping calls have **different**
numbers, this debounce never fires, and the cause lies on the phone or in the app.
Dan is settling that with the Executions log and the MacroDroid check. Do not claim
this ticket fixes #8.

## Task

1. Extract the duplicate decision into a **pure** function, for example
   `isLegacyDuplicate_(prevRow, number, callType, nowMs)`, returning true or false.
   `prevRow` is the 10-cell row array as read today. `handleLegacyPost` calls it
   instead of the inline condition.
2. A call is a duplicate only when **all** hold: same normalised number; previous row
   fresher than `DEBOUNCE_SECONDS`; previous Query and Notes both empty; and the
   previous row's `COL_TYPE` equals `callType` (trimmed, case-insensitive).
3. If `callType` is `''` (the payload's direction was not INCOMING, OUTGOING or MISSED)
   **or** the previous row's Type is blank, keep today's behaviour for that comparison
   (match on the other three conditions), so odd payloads and untyped rows do not start
   producing duplicate rows.
4. The deduped response stays `json({ status: 'ok', deduped: true })`. Nothing else in
   `handleLegacyPost`, and nothing in `CallLog_Sync.js` (the Android app path), changes.
5. Add `selfTestDebounce()` to `CallLog_AppScript.js`: plain assertions over the pure
   function, run from the Apps Script editor, that logs `PASS` or throws on the first
   failure. Do not add a menu item and do not add a trigger.
6. Add a line to `projects/calllog/PROJECT.md` Change history, and correct any sentence
   that describes the debounce so it matches the new behaviour.

## Acceptance criteria

1. `isLegacyDuplicate_` exists, takes no sheet or service argument, and has no side effects.
2. Same number, same type, 5 s old, untouched → duplicate (true).
3. Same number, **different** type (Incoming vs Missed), 5 s old, untouched → not a duplicate.
4. Same number, same type, 11 s old → not a duplicate.
5. Same number, same type, 5 s old, Query or Notes filled → not a duplicate.
6. Different number → not a duplicate.
7. `callType === ''` with the other three conditions met → duplicate (old behaviour).
8. Previous row's Type blank with the other three conditions met → duplicate (old behaviour).
9. Type comparison ignores case and surrounding spaces.
10. `selfTestDebounce()` covers criteria 2 to 9 and ends by logging `PASS`.
11. `handleLegacyPost` otherwise behaves exactly as before; `git diff` shows no change to
    `CallLog_Sync.js`, `appsscript.json` or anything outside `projects/calllog/`.
12. Columns are addressed with the existing `COL_*` constants; do not rework the fixed
    column order in this ticket.
13. In the PR, list in "Could not verify": that this was not run against the live sheet
    or MacroDroid, and that `selfTestDebounce()` has to be run once by a person in the editor.

## Manual test (for the PR's test steps)

1. In the Apps Script editor, run `selfTestDebounce`; the log shows `PASS`.
2. POST two legacy bodies for the same number a few seconds apart, one with
   `direction: "INCOMING"` and one with `"MISSED"`: two rows appear. Repeat with both
   `"INCOMING"`: one row appears and the second response contains `deduped: true`.

## Definition of done

The debounce does what the comment and `PROJECT.md` say it does, with a test that
pins it, and Dan knows from the PR that it does not by itself close #8.
