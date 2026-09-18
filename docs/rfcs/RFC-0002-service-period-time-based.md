# RFC-0002 — Service period: time-based rather than km-based

**Status:** 🚧 **DRAFT — NOT ACCEPTED. The routine must not implement this.**
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

## Open questions — Dan must answer before this is Accepted

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

## Next step

Dan answers the four questions; this RFC is revised and moved to Accepted;
TICKET-0004 is then unblocked and labelled `approved`.
