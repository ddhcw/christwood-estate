# TICKET-0007 — Call-waiting: the answered call is lost in doPost

**Ref:** `S-CDA4E3B8` · **Project:** `projects/calllog/` · **Size:** medium
**RFC:** none — bug fix, no schema or notification change
**Raised by:** Stella · **Owner:** Monica
**Supersedes:** TICKET-0005 (the investigation)

## What the investigation established, and what Dan then confirmed

TICKET-0005 asked whether this was a phone-side or server-side fault, since the
capture half lives in MacroDroid on a physical Android device. Its question 3
was: *"If two POSTs arrived seconds apart for the same number, would both
survive?"*

**Dan has confirmed there are two `doPost` executions when a call is waiting
while another is live.** So the data does arrive, and something server-side is
dropping one of the two rows. This is now a bug in this repository, not a
MacroDroid problem.

## The prime suspect

`doPost` (`CallLog_AppScript.js:557`) has a debounce at lines 568-579:

```js
const sameNum   = normaliseNumber(prev[COL_PHONE - 1]) === number;
const fresh     = (Date.now() - ts) < DEBOUNCE_SECONDS * 1000;   // 10 seconds
const untouched = !prev[COL_QUERY - 1] && !prev[COL_NOTES - 1];
if (sameNum && fresh && untouched) return json({ status:'ok', deduped:true });
```

It exists to drop genuinely duplicate POSTs for one call. Two overlapping calls
land inside its 10-second window by definition, so if both POSTs carry the same
number it will collapse them into one row — which matches the symptom exactly:
one row survives, and it is the call-waiting one.

**Do not assume this is the whole story.** It only fires when both POSTs carry
the *same* number, and two different callers would not. Establish what is
actually happening before changing the logic.

## Step 1 — instrument, and say what you find

Add logging of the raw `e.postData.contents` and the debounce decision
(`sameNum` / `fresh` / `untouched`, and whether it dropped). State in the PR
what the two POSTs would have to look like for the current code to produce the
reported symptom.

If the evidence points somewhere other than the debounce, follow the evidence
and say so. A correct diagnosis with a smaller fix beats a confident rewrite.

## Step 2 — fix

## Acceptance criteria

1. **Two POSTs for two genuinely different calls always produce two rows**,
   however close together they arrive. This is the whole point of the ticket.
2. Real duplicate POSTs for the *same* call are still dropped — do not simply
   delete the debounce and reintroduce duplicate rows.
3. The distinguishing signal is chosen from what the payload actually contains,
   and justified in the PR. A timestamp or call-id from MacroDroid is a better
   discriminator than number+direction if one is present; if none is, say so and
   explain what you used instead.
4. `LockService.waitLock(20000)` behaviour is checked: two near-simultaneous
   POSTs serialise on the lock, and a timeout must not silently lose a row.
   If a lock timeout can drop a call, that is in scope.
5. Diagnostic logging is left in place, at a level that will not flood the
   execution log in normal use.
6. `DEBOUNCE_SECONDS` becomes readable without a code change if it stays a
   tuning knob (non-negotiable #5) — a Config/Settings value, not a constant.
7. Nothing outside `projects/calllog/` is touched.

## What you still cannot verify

You cannot run MacroDroid, place a real call, or see a real payload. Write the
manual test steps Dan and Monica need: make a call, take a second call while the
first is live, and confirm two rows with the right numbers and types. Say
plainly that you have not exercised this.

## Definition of done
Deployed, and Monica confirms a real call-waiting scenario produces two correct
rows in the Call Log.
