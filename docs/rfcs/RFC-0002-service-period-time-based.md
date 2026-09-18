# RFC-0002 — Service period: time-based rather than km-based

**Status:** ✅ **Accepted** (2026-09-18, Dan answered all four questions)
**Suggestion:** `S-A433C6E9` · **Project:** `projects/transport/`
**Raised by:** Lakshmanan · **Owner:** Stella Baby · **Created:** 2026-09-18

---

## The request, as raised

> Service period is yearly (time-based, not km-based)

## What exists today

`computeServiceDue_` in `Reports.js:137` measures service intervals purely in
**kilometres**, from two Settings rows seeded by `Setup.js:135-136`:

| Setting | Default | Meaning |
|---|---|---|
| `service_interval_km` | 10000 | A scheduled service is due every this many km |
| `service_warn_km` | 500 | Warn when within this many km of due |

It establishes a baseline odometer reading at the most recent `Scheduled`
maintenance and measures distance since. It already handles a dead odometer as a
special case (`eraFrom`, "serviced on the old meter"), because with no working
meter a km-based interval cannot be computed at all — which is itself an
argument for the change being requested.

The daily digest in `Triggers.js:31` reports "service due" from this function.

## Why this needs an RFC

It changes how a safety-relevant due date is computed for vehicles carrying
children. Getting it wrong means either a fleet of false alarms or a vehicle
quietly going unserviced. It is over the threshold in PRD §7 (logic/schema
change), and it is not a change I am willing to have made on a guess.

## Decisions (Dan, 2026-09-18)

| # | Question | Answer |
|---|---|---|
| 1 | Yearly from what? | **A fleet-wide date, set by the transport department.** Which date they pick is their business, not the system's — the system just needs somewhere to hold it. |
| 2 | Replace km, or both? | **Replace km entirely.** |
| 3 | Warning window? | **None.** No "approaching service" state at all. |
| 4 | Vehicles with no recorded scheduled service? | **No false alarms.** |

## Decision

Add one Settings row, `service_due_date`, holding a single fleet-wide date that
the transport department maintains. Rewrite `computeServiceDue_` to use it and
drop the km basis.

A vehicle is flagged **Service due** when all of these hold:

1. `service_due_date` is set, and
2. today is on or after it, and
3. the vehicle has no `Scheduled` maintenance record dated on or after
   `service_due_date` minus `service_interval_months` (new Settings row,
   default 12).

A vehicle with **no maintenance records at all** is reported as **Unknown**, not
flagged — answer 4. But the count of Unknown vehicles is shown alongside the due
list, because "we have no idea whether this vehicle has been serviced" is
information Stella needs, and silently omitting it is not the same as not
false-alarming. This is the closest reading of non-negotiable #9 (honest state:
unknowns are not the same as fine) that still satisfies answer 4.

If `service_due_date` is blank, the section reports that no service date is set
and lists nothing. Blank config must never read as "all vehicles fine".

### Resolving the tension between answers 1 and 4

A fleet-wide due date means a vehicle's status depends on its own service
history relative to that date. A vehicle with no history would therefore flag as
overdue the moment the date passes — a fleet-wide false alarm on day one, which
answer 4 rules out. Hence the third Unknown state rather than a binary
due/not-due.

## ⚠️ Risk Dan should be aware of

Removing the km basis entirely (answer 2) means **the only automated
service-tracking signal becomes a date someone has to remember to type in.**
Today the system computes service-due from odometer readings that accumulate on
their own. After this change, if the transport department never sets
`service_due_date`, or sets it once and never updates it, no vehicle is ever
flagged and nothing in the system complains.

This is a school bus fleet. Dan has decided, and this RFC implements that
decision — but the mitigation is cheap and worth considering as a follow-up: a
stale-date warning when `service_due_date` is more than 12 months in the past.
Not in this ticket.

## Superseded open questions

1. **Yearly from what?**
   a. 12 months from that vehicle's last `Scheduled` maintenance date, or
   b. a fixed annual date per vehicle (e.g. its `in_service_date` anniversary), or
   c. a fixed calendar date for the whole fleet?

   These give different due dates and different code.

2. **Replace km, or both?** Does the km interval go away entirely, or does
   service become due on **whichever comes first** — a year elapsed *or*
   10,000 km? "Whichever comes first" is the common fleet practice and would
   also fix the dead-odometer gap, but it is a bigger change and it is not what
   the suggestion literally says.

3. **Warning window.** `service_warn_km` (500 km) has no time equivalent. How
   many days before due should a vehicle start showing as approaching?

4. **Existing vehicles.** For a vehicle with no recorded `Scheduled` maintenance
   yet, what is the baseline — `in_service_date`, or does it show as unknown
   rather than overdue? Showing an unserviced-in-the-system vehicle as a year
   overdue on day one would be a false alarm across the fleet.

## Provisional shape (not to be built yet)

Add `service_interval_months` and `service_warn_days` as Settings rows alongside
the existing km rows — config as sheet data, non-negotiable #5 — and extend
`computeServiceDue_` to evaluate whichever basis is configured. Keeping the km
settings in place rather than deleting them preserves the existing behaviour
until the sheet says otherwise, and lets question 2 be answered by configuration
rather than a second code change.

## Scope

**In:** `Reports.js` (`computeServiceDue_` and its section), `Setup.js`
(Settings rows).

**Out:** the daily digest's other sections; any change to how maintenance is
recorded; a stale-date warning (see Risk above); anything outside
`projects/transport/`.
