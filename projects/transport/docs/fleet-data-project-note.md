# Fleet Data & Automation — Project Starting Note

*Source: Transport-in-charge's handwritten list, dated 23/6/26. Decoded, interpreted, and reframed around the actual goal.*

---

## The goal, stated as a data question

You don't want to *log* the fleet. You want to answer one question per vehicle, over time:

> **What does this vehicle cost to run per kilometre, and is that number getting worse?**

Everything below either feeds that question or it doesn't. The transport-in-charge's list is collection-centric — twelve things to write down. Your project is decision-centric — three numbers to trend (fuel cost/km, maintenance cost/km, downtime) and one signal (replace this one). Keep that distinction visible or the scope balloons into "digitise the whole transport office," which is a different, larger project.

## The one design decision that determines whether this works

**Odometer reading must be captured at every fuel fill and every maintenance event, no exceptions.**

Raw spend per vehicle is useless. A bus that runs 3,000 km/month *should* cost more than one that runs 800. Without distance, you can't tell "expensive because it's worked hard" from "expensive because it's dying" — which is the entire point. The odometer is the join key between money spent and distance driven. If only one thing survives Phase 1, make it this.

The in-charge half-knows this already — item 3 says *Fuel + O/D*, item 12 captures open/close kms. Reinforce it everywhere; don't let it be optional.

---

## Decoded inventory

My reading of the twelve items, with confidence flagged. Correct anything I've misread.

| # | As written | Reading | Serves the goal? |
|---|-----------|---------|------------------|
| 1 | Attendance — Morning Driver's — M/Excel | Driver morning attendance, kept in Excel | Operational, not core |
| 2 | Vehicle In-time — Notepad → WhatsApp | Arrival time noted on paper, sent on WhatsApp | Operational |
| 3 | Fuel — Excel — update — O/D | Fuel entries in Excel, updated with **odometer** | **Core** |
| 4 | Maintenance — Approval Note | Maintenance needs an approval note before spend | **Core** (approval = cost control) |
| 5 | Fuel — Enter | The fuel data-entry step itself | **Core** |
| 6 | Vehicle Document update | Insurance / FC / permit / PUC renewals | Useful (compliance) |
| 7 | Driver Master data | Master list of drivers | Supporting |
| 8 | Biometric — Attendance | Biometric staff/driver attendance | Operational |
| 9 | GPS — Tracker — "Neverskip" | Two notes: GPS vehicle tracking, and **NeverSkip** (school ERP) as the intended platform for **biometric driver attendance** — replacing the current paper sign-in register | GPS = core (distance); NeverSkip = scope decision |
| 10 | Access Card | Gate / vehicle access cards | Operational |
| 11 | Maintain Single Master — Date / Fuel / Vehicle Maintenance / Driver date — Month / Year — RAW, monthly/annual | Hold the **raw data once**, then slice it by month / year (and whatever else) | **Core intent** |
| 12 | Sports / Field / Staff Trip — Open kms, Close kms, Time, Close | Special (non-routine) trips: capture opening & closing odometer + times | **Core** (distance source) |

All three previously ambiguous items are now resolved: **"Neverskip"** (item 9) is the school ERP they're evaluating for biometric attendance, not a note about the GPS unit; **item 11** means raw data held once and sliced by month / year; **O/D** is the odometer. The NeverSkip detail has the biggest consequences — see the build-vs-buy section.

## Reframing item 11 — the in-charge's best instinct

"Maintain Single Master" is the most important line on the page. They're asking for *one* consolidated record instead of attendance-in-Excel, in-time-on-notepad, fuel-in-another-Excel. That instinct is right, but the execution they're imagining — one giant master sheet maintained by hand — is wrong. A single hand-maintained master is where data goes to rot.

The correct shape is **one capture point per event type, one analytics layer on top.** Separate logs that feed a single dashboard. That gives them the "single view" they want without the double-entry that kills it.

Their own phrasing — *raw data, sliced monthly / annually* — is exactly this. The raw rows live once in append-only logs; "monthly" and "annual" are views computed off them, not separate sheets anyone maintains. Hold that line: the moment someone is hand-typing a monthly summary, the design has failed.

---

## Proposed data model

Five transaction logs, two masters, one derived layer. Each log is append-only — you add rows, you don't edit a master by hand.

**Masters (slow-changing reference data)**
- `Vehicle_Master` — vehicle_id, reg no, make/model, type (bus/van/car), seating, year of purchase, in-service date, status (active/standby/retired), GPS device id, access card id
- `Driver_Master` — driver_id, name, licence no, licence expiry, phone, currently assigned vehicle

**Logs (append-only events)**
- `Fuel_Log` — date, vehicle_id, **odometer**, litres, amount ₹, station, paid-by (card/cash/reimbursement), driver_id, entered_by
- `Maintenance_Log` — date, vehicle_id, **odometer**, category (scheduled/breakdown/accident), description, parts ₹, labour ₹, vendor, approval ref, downtime (days off road)
- `Trip_Log` — date, vehicle_id, driver_id, purpose (routine/sports/field/staff), open odo, close odo, distance (derived), start time, end time
- `Document_Register` — vehicle_id, doc type (insurance/FC/permit/PUC), number, issue date, **expiry date**
- `Attendance` — date, driver_id, in/out — *operational; Phase 3, only if they want it here*

**Derived layer (formulas / Apps Script — never hand-entered)**

Per vehicle, per month:
- km driven (from consecutive odometer readings)
- fuel cost, fuel cost/km, efficiency (km/litre)
- maintenance cost, maintenance cost/km
- total operating cost/km
- cumulative maintenance to date
- downtime days

**The replacement signal** is a composite, not a single number: maintenance cost/km rising *and* efficiency falling *and* downtime increasing across a trailing window (say 3–6 months). Any one alone is noise; together they're a failing vehicle. Decide the actual thresholds with the in-charge before building the dashboard — don't let the formula invent the policy.

---

## The friction problem (this is what will actually sink it)

Look at the current flow: in-time goes *notepad → WhatsApp → Excel*. Fuel sits in a different Excel. That's manual triple-handling, and every hop loses data. People won't maintain a system that asks them to write the same thing three times.

Design rule: **capture each fact once, at the moment it happens, by the person who has it.**
- Fuel fill → a Google Form (or WhatsApp-to-Sheet) the driver/in-charge fills at the pump, odometer mandatory.
- Maintenance → a form at approval time, which doubles as the approval note (item 4) — one action, two outputs.
- Trips → open/close odometer captured in the same form.

If you can wire even one of these to a phone-friendly Form that writes straight to the Sheet, you've removed the notepad and the re-typing in one move.

## GPS + NeverSkip — the build-vs-buy fork you need to settle first

NeverSkip (now PowerSchool Neverskip) isn't an attendance app — it's a full school ERP, and its transport module already claims route planning, GPS tracking, distance/trip history, and vehicle maintenance tracking. It also integrates third-party biometric, GPS, and Tally systems, and the GPS side is typically an AIS 140 government-approved device with historical trip distance and speed data. So before you build anything in Sheets, find out exactly what this school's NeverSkip subscription already includes. Two consequences:

**The GPS could be your automatic odometer.** This is the friction fix I flagged last turn. If AIS 140 trip data is accessible (export or API), distance per vehicle per day arrives without anyone reading a dashboard — removing the single most failure-prone manual input in the system. Chase this first; the answer reshapes Phase 1.

**Don't rebuild what they're already paying for.** Attendance (items 1, 8 — paper register today, biometric via NeverSkip intended), GPS tracking, document reminders, even maintenance *scheduling* may already exist in the ERP. Rebuilding those in Sheets is wasted effort and a second source of truth.

**But the cost analytics is almost certainly still yours.** ERP transport modules are built for safety, tracking, and parent comms. They track maintenance *schedules* and *reminders*; they do not, as a rule, compute **fuel-and-maintenance cost per kilometre per vehicle and trend it into a replacement signal**. That specific question — the entire point of your project — is the gap a focused Sheets + Apps Script build fills, sitting on top of whatever raw data NeverSkip and the fuel records can feed it.

So the honest scoping is: NeverSkip owns tracking, attendance, and compliance reminders; your build owns the cost-per-km analytics and the replace/keep decision. Confirm the subscription details before you draw the Phase 1 boundary — you may be able to *pull* distance from NeverSkip rather than capture it.

---

## Open questions to resolve before building

1. **Fuel method** — full-tank fills or partial top-ups? Full-tank-to-full-tank gives clean efficiency maths; partial fills need tank-state assumptions. Push for full-tank discipline if at all possible.
2. **Who pays for fuel** — fuel card, cash, reimbursement? Determines who enters the data and whether you can cross-check against statements.
3. **Odometer vs GPS** as the distance source of truth — and specifically, can you pull AIS 140 trip distance out of NeverSkip rather than capture odometers by hand? See above.
4. **Replacement policy** — what actually triggers a "replace" recommendation? Cost/km threshold, age, cumulative cost crossing residual value? Define it as a number, not a vibe.
5. **Scope boundary vs NeverSkip** — what does the school's ERP subscription already cover? Attendance, biometric, access cards, GPS, and maintenance scheduling (items 1, 8, 10, plus parts of 6 and 9) may already live there. My recommendation: keep all of that out of Phase 1, and out of this project entirely where NeverSkip already does it. Your build is the cost-per-km analytics layer, nothing more.

---

## Suggested phasing

**Phase 1 — answer the core question.** `Vehicle_Master` + `Fuel_Log` + `Maintenance_Log`, odometer mandatory, capture via Forms. Derived: cost/km and efficiency per vehicle per month. This alone tells you which vehicles to worry about. Ship this, get real data flowing, before anything else.

**Phase 2 — distance & compliance.** `Trip_Log` (tightens distance accuracy, covers item 12) and `Document_Register` with expiry alerts (item 6). GPS integration if the export exists.

**Phase 3 — operational, if wanted.** Attendance, biometric, access cards, dashboards, the "single master" consolidated view (item 11) now built on clean underlying logs rather than as a hand-maintained sheet.

---

*Next step: get the school's NeverSkip subscription scope (especially whether AIS 140 trip distance is accessible), and confirm the fuel method. Those two answers settle the Phase 1 boundary and the distance-capture approach.*
