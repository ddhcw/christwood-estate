# Christwood Transport — Expansion Plan

*Prepared for the Transport in charge, HR Head and CEO. Draft 1, 25 August 2026.*

---

## 1. What this is

The fleet tracker now running answers a question about **money**: what does each bus cost to
run per kilometre, and is that getting worse. It is an office record system. Nobody outside
the office depends on it, and if it broke on a Tuesday nobody would notice until Wednesday.

This expansion answers questions about **children and time**, in real time, to people outside
the office:

- Where is my child's bus right now?
- When will it reach our stop?
- Is my child actually on it?
- Which of our thirty buses is where, and which one is late?

That is a different kind of system, and the difference matters more than the feature list.
**A parent-facing live system is a service with an operational commitment.** When it is wrong
or down at 7:15am, the school's phone rings. Everything below is shaped by that.

---

## 2. What we already have, and what it is worth

Four answers from the scoping conversation change the cost of this project by an order of
magnitude. They are worth stating plainly because the budget rests on them.

| What we have | Why it matters |
|---|---|
| **Students hold school Google Workspace accounts, and parents use them** | Identity and notifications are solved and free. No SMS contract, no DLT registration, no password system, no separate parent app to get installed. At ~850 students this is the difference between roughly ₹0 and ₹1.2 lakh a year. |
| **Every bus has an attendant** | Student attendance becomes a software problem, not a hardware one. A photo-grid app — faces, not names — needs no literacy, and an adult confirming is far harder to defeat than a card a child taps. |
| **Buses are school-owned, drivers school-employed** | We can fit devices and set policy without a contract variation or an operator's cooperation. |
| **A working fleet tracker, with vehicle, driver and route records already in it** | The masters this expansion needs already exist and are already maintained. No parallel list of buses or drivers. |

**The consequence: this expansion can be built for very little.** The dominant costs in a
project like this are normally per-message notification fees and per-child hardware. We avoid
both. What remains is one device per bus and a small amount of cloud.

---

## 3. What the GPS audit found

The audit is done, and the answer is worse than the first draft of this plan assumed.

| Platform | Buses | State |
|---|---:|---|
| Tata Fleet Edge | 4 | Live; school holds logins |
| Tata Fleet Edge | 7 | **Hardware fitted, subscription never activated** |
| Way4TrackPro | 4 | Live, separate platform |
| Nothing fitted | 16 | No device |
| **Total** | **31** | **8 actually tracked** |

Three findings follow from it.

### 3.1 The 16 untracked buses are a compliance gap, and it is already known internally

Published guidance on AIS 140 indicates that Tamil Nadu layers additional school-bus tracking
requirements on top of the central mandate: real-time tracking accessible to school management,
parents and traffic police; a physical, hard-wired panic button reachable by both driver and
attendant; and a live feed to the state transport authority's portal. The stated consequence of
non-compliance is permit suspension and fines under the Motor Vehicles Act.

*This is drawn from published industry guidance, not legal advice — the exact obligation should
be confirmed with the school's RTO consultant before money is committed.* The school already
knows the gap exists, which means the device spend is owed whether or not this project proceeds.

**That reframes the entire budget.** The right question is not "what does live tracking cost",
it is "given that we must fit and run these devices anyway, what does it cost to make them
useful to parents and management?" The answer to the second question is very small.

### 3.2 An earlier recommendation has to be withdrawn

The first draft suggested the attendant's phone could serve as the position source where devices
were missing. That works technically and it will not do legally: a phone app is not a hard-wired
VLTD with a physical panic button feeding the state portal. **The 16 buses need real AIS 140
devices regardless of what we build.** The attendant phone remains the right tool for boarding
(Phase 4) and a useful corroborating position source — but it is not a substitute for compliance.

### 3.3 The good news is the hardware already on the fleet

Tata's factory-fitted Telematics Control Unit is AIS 140 compliant, so 11 buses already carry
compliant hardware — 4 live and 7 needing only a subscription. Way4Track is an RTO-approved
AIS 140 provider, so those 4 are compliant too. **15 of 31 need no new hardware at all.**

### 3.4 Is the hardware good enough? Yes — the constraint is access, not capability

Checked against the AIS 140 specification, because it determines whether any of this is
buildable at all. The certified minimums are:

| Capability | Spec minimum | What we need it for |
|---|---|---|
| Position while moving | every **30 seconds** | Live map, stop-approach alerts, ETAs |
| Position while stationary | every 5 minutes | Knowing a bus is parked, not lost |
| Accuracy | **5 m** (GPS + NavIC dual constellation) | Stop geofences are 50–100 m, so ample |
| Emergency / tamper events | transmitted **immediately** | Panic button, in real time |
| Backend destinations | **minimum 2 different IP addresses** | One to the state portal, one to us |

Nothing this project needs exceeds what these devices already do. **The last row is the
important one**, and it corrects an earlier draft of this plan: sending to a second backend is
*mandated by the standard*, not an optional extra to negotiate at purchase. Every compliant
device on the fleet already supports it.

### 3.5 So the real question is who holds the configuration

Capability is uniform across all 31 buses. Control is not.

| Group | Device | Who can point the second feed at us | Difficulty |
|---|---|---|---|
| 16 new | Aftermarket, we buy | **We do** | None — a line in the purchase spec |
| 4 | Way4Track aftermarket | Way4Track | Low — a routine support request |
| 11 | Tata factory-embedded TCU | **Tata, and only Tata** | The one genuine unknown |

The Tata TCU is embedded at the factory. Neither the school, nor an installer, nor any third
party can reconfigure it. This is the single dependency in the whole project that we cannot
resolve ourselves.

### 3.6 What to ask, and of whom

| Ask | Of | Why it matters |
|---|---|---|
| **"Your TCU is AIS 140 certified, which mandates support for a second backend IP. Please configure the second stream to our endpoint."** | Tata Motors | Framed as a configuration change on hardware that already does it — not a request to build an API. There is no public Fleet Edge developer documentation, so asking for an API invites either a refusal or a long enterprise sales conversation |
| Is the **state portal feed live on the 7 dormant buses independently of the Fleet Edge subscription?** | Tata Motors | If the TCU already transmits to the government backend, those 7 may be compliant already and merely invisible to *us* — which changes what activating the subscription actually buys |
| Cost to activate the 7 dormant subscriptions | Tata Motors | Sets whether those are the cheapest or dearest buses to bring online |
| Add our endpoint as the second destination | Way4Track | Same request, far smaller vendor, usually straightforward |
| Current annual spend on the 8 live buses | School accounts | The baseline new spend is measured against |
| Confirm second-destination configuration is included | Device vendors, at quotation | Required by the standard, but confirm it is exposed to us and not locked |

### 3.7 If Tata says no — and why it must not hold up the build

There is a partial fallback and a full one, and the full one is cheap enough that this
dependency should never become a blocker.

**Partial — a scheduled export.** A CSV or report export from Fleet Edge would give daily
distance and trip history. That delivers the odometer auto-fill, the fuel cross-check and
campus in/out *retrospectively* for those 11 buses. It does **not** deliver live map position
or parent ETAs.

**Full — fit our own devices alongside.** Dual devices are permitted. **11 × ₹5,000 = ₹55,000
one-off**, and the dependency disappears completely.

> **The Tata dependency is worth at most ₹55,000 to eliminate.** That figure should govern how
> long we spend negotiating. Set a decision date; if the answer is not yes by then, fit the
> devices and move on. Months of vendor correspondence cost more than ₹55,000 of attention.

## 4. What changes architecturally — and what does not

**The existing fleet tracker does not change.** It stays exactly as it is: Google Sheets plus
Apps Script, fuel and maintenance and driver attendance, the Fuel Process report. It is the
right tool for that job.

**The live layer sits beside it, not inside it.** Thirty buses reporting position every thirty
seconds is roughly 14,000 writes a day. Putting that into the workbook would destroy it and
exhaust the Apps Script quotas within days. This is already settled house policy: bursty
concurrent writes belong in a real datastore, with Sheets as the reporting layer.

So the shape is:

```
  Tata Fleet Edge   (11 buses)  ─┐
  Way4TrackPro      ( 4 buses)  ─┼─► adapter ─► one common position record
  New AIS 140 kit   (16 buses)  ─┘              {bus, lat, lon, speed, time, source}
                                                          │
      Attendant phone (31 buses) ─────► boarding events ───┤
                                                          ▼
                                                  Firebase (Firestore)
                                                          │
            ┌─────────────────────────────────────────────┼──────────────┐
            ▼                        ▼                    ▼              ▼
      Parent view            Management dashboard    Chat alerts    nightly roll-up
      (their bus, ETA)       (all 31, live)          (existing        into the
       Google sign-in                                 Workspace)      Sheets workbook
```

Each vendor gets a small adapter that normalises its feed into one common record. **Registration
number is the join key** — it is the one identifier all three platforms and our own
Vehicle_Master share. Everything above the adapter layer is vendor-agnostic, so losing or
changing a vendor costs one adapter, not the system.

**Two schema additions to the existing fleet tracker** make the audit durable instead of living
in this document: `tracker_vendor` and `tracker_device_id` on Vehicle_Master. Without them the
dashboard cannot say *which* feed has gone quiet, and next year nobody will remember which bus
is on which platform.

The nightly roll-up is the important join: **GPS distance can fill in the odometer readings
that the fuel report depends on today**, which removes the most error-prone manual step in the
existing system and lets us cross-check fuel purchased against distance actually driven.

---

## 5. Phases

Roughly six weeks per phase — two weeks of build across the days available, then three to four
weeks of testing and live rollout before the next phase starts.

Note that the priority order given (a, b, c, d) is not the build order. **Campus in/out (d) is
a by-product of tracking (a)** — it is a geofence around the school on the same feed, so it
ships with Phase 2 at no extra cost. **Alerts (b) are also derived from (a)**, but need parent
identity and consent, so they follow.

### Phase 1 — Approval and procurement  *(2–4 weeks, ₹0 of build)*

The GPS audit is done (Section 3). What remains:

- The one-page proposal for leadership (accompanying this document).
- Put the questions in Section 3.6 to Tata, Way4Track and accounts.
- Quote the 16 devices, **requiring the second data destination to be configurable by us**.
  The standard already mandates the capability; what needs confirming is that it is not locked.
- **Set a decision date for Tata.** If there is no yes by then, budget the ₹55,000 fallback in
  Section 3.7 and stop waiting.
- Confirm the compliance obligation with the school's RTO consultant.
- Confirm parent account coverage — how many students have an account a parent actually reads.
- Draft the parental consent note and the data retention rule.
- Name who owns the system operationally when it misbehaves at 7am.

**Exit test:** budget approved, devices ordered, and we know whether Fleet Edge and Way4Track
will give us data.

### Phase 2 — Live tracking, management dashboard, campus in/out  *(~6 weeks)*

Delivers priorities **(a)** and **(d)**.

- Three vendor adapters, built in order of who controls the feed:
  **(1) the 16 new devices** — the feed we own outright, no vendor in the loop, so the whole
  ingestion path can be proven without waiting on anyone;
  **(2) Way4Track** — a routine request to a small vendor;
  **(3) Tata** — shape decided by their answer, and deliberately last.
  All three normalise into one common position record, joined on registration number.
- If Tata is unresolved when this phase ships, those 11 buses appear on the dashboard from
  whatever export exists, **labelled as delayed rather than live** — never shown as fresh.
- `tracker_vendor` and `tracker_device_id` added to Vehicle_Master, so the dashboard can name
  which feed has gone quiet.
- Management dashboard: all thirty buses on one map, live, with route, speed, last-seen time,
  and an honest "no signal for N minutes" state.
- Campus geofence → automatic time in and time out per bus, per trip, replacing the current
  notepad-and-WhatsApp practice.
- Trip classification: morning run, evening run, refuelling, servicing, outing.
- Nightly roll-up into the existing workbook — distance driven per bus per day.
- Management alerts only, to the existing Ops Chat space. No parent-facing anything yet.

**Exit test:** the Transport in charge uses the dashboard instead of phoning drivers for a
full week, and the campus in/out times match a manual spot check.

### Phase 3 — Parent and management alerts  *(~6 weeks)*

Delivers priority **(b)**.

- Parent view: one page, their child's bus, live position and ETA. Google sign-in, no password.
- Chat notifications: bus left school, bus approaching your stop, bus reached school.
- ETA from the route's own history rather than a paid routing service — a bus that runs the
  same road at the same time every day gives better and cheaper estimates than a traffic API.
- Parent can mark a child absent for the day, so the bus does not wait.
- Delay reason field, so a late bus shows "held at level crossing" rather than silence.

**Exit test:** run one route for two weeks with volunteer parents before opening it to all.

### Phase 4 — Student boarding attendance  *(~6 weeks)*

Delivers priority **(c)**.

- Attendant app: photo grid of the children expected at the next stop, tap to board, tap to
  alight. No reading required. Works offline and syncs when signal returns.
- Expected-list driven by the parent's absence marking, so a legitimate absence is not an alarm.
- **Not-boarded alert** to office and parent before the bus leaves the stop.
- **End-of-run empty-bus confirmation** by the attendant — the check that prevents a child
  being left asleep on a parked bus.
- Management dashboard: who is aboard each bus right now.

**Exit test:** three routes for three weeks, with the paper register kept in parallel and the
two compared daily.

---

## 6. Costs

31 buses, ~850 students, 200 school days. Rupees. The important split is between spend the
school owes under the tracking rules anyway, and the marginal cost of turning that into
something parents and management can use.

### A. Compliance — owed whether or not this project happens

| Item | One-off | Per year | Confidence |
|---|---:|---:|---|
| AIS 140 device + panic button, fitted × 16 | 80,000 | — | Firm — ~₹5,000 fitted is the going Chennai rate |
| SIM and platform for those 16 | — | 28,800 | Firm — ~₹150/bus/month |
| Activate 7 dormant Fleet Edge subscriptions | — | *to confirm* | **Unknown — ask Tata** |
| Existing 4 Fleet Edge + 4 Way4Track | — | *already paid* | **Unknown — ask accounts** |
| **Compliance subtotal** | **80,000** | **28,800 +** | |

### B. What this project adds on top

| Item | One-off | Per year | Note |
|---|---:|---:|---|
| Attendant devices × 31 | 0–155,000 | 0–37,200 | Zero if attendants use their own phones with a data allowance |
| Mounts and chargers | 15,000 | — | A flat phone is a dead tracker |
| Cloud (Firebase) | 0 | 0–18,000 | Free tier covers this scale |
| Three vendor adapters | 0 | 0 | In-house build; ongoing cost is maintenance attention, not cash |
| Maps, notifications, hosting | 0 | 0 | OpenStreetMap, Google Chat, free hosting tier |
| **Project subtotal** | **15,000–170,000** | **0–55,200** | |

### C. Contingency — only if Tata refuses data access

| Item | One-off | Per year | Trigger |
|---|---:|---:|---|
| Own devices on the 11 Tata buses | 55,000 | 19,800 | Only if Tata will not point the second stream at us (Section 3.7) |

Not a committed cost, and deliberately capped: knowing the buy-out price is ₹55,000 is what
stops the negotiation running for months.

**The headline: ₹80,000 of device spend is required by law. For ₹15,000 more, that spend stops
being a compliance cost and becomes live tracking for every parent, a management dashboard,
automatic campus timings, and confirmed student boarding.**

### What we are deliberately not paying for

| Avoided | Would have cost | Instead |
|---|---:|---|
| SMS to parents | ~1,20,000/yr | Google Chat on accounts already owned |
| WhatsApp Business API | ~65,000/yr | as above |
| Google Maps Platform | ~15–40,000/yr | OpenStreetMap + Leaflet |
| Paid routing/ETA service | ~30,000/yr | Each route's own recorded history |
| Parent identity system | build + support | Google sign-in on student accounts |
| RFID or face-recognition attendance | 3,00,000–6,00,000 | The attendant already aboard, confirming on a phone |
| Third-party school-transport platform | 1,50,000–5,00,000/yr | Built on infrastructure already licensed |

## 7. Things worth adding that were not asked for

Each of these is cheap because the data is already there once the phases above are built.

**Safety**

1. **End-of-run empty-bus check.** The attendant confirms the bus is empty; an alert fires if
   the confirmation does not arrive. This is the single highest-value item in the document —
   it is the control that prevents a child being left on a parked bus.
2. **Wrong-stop alert.** A child alighting somewhere that is not their stop.
3. **SOS.** AIS 140 devices have a panic button; the attendant app should have one too. Routed
   to management instantly.
4. **Route deviation alert.** The bus is not on its known road.

**Fewer false alarms — needed for the rest to work**

5. **Parent marks child absent today.** Without this, every legitimate absence becomes a
   not-boarded alarm and the office learns to ignore alarms within a fortnight. This is not a
   nice-to-have; it is what makes the not-boarded alert credible.

**Money, and less manual work**

6. **Odometer from GPS.** Fills the readings the fuel report depends on, removing the most
   error-prone manual entry in the existing system.
7. **Fuel cross-check.** GPS distance against odometer distance against litres purchased. This
   is how pilferage shows up, and it pays for the project on its own.
8. **Trip log fills itself.** Outings and refuelling runs stop being typed in.
9. **Who actually drove.** Ties to the driver attendance already built.

**Everyday quality**

10. **Tamil alongside English** for the parent and attendant screens.
11. **Delay reason**, so parents see a cause rather than a silent late bus.
12. **A message budget.** Cap what any family receives per day. Notification fatigue is how
    these systems die — parents mute them and then miss the one that mattered.

---

## 8. Blind spots and things that will tie us up later

Listed most likely to hurt first.

1. **The moment parents can see the bus, the school owns the outage.** Today if tracking is
   down nobody knows. From Phase 3 onwards, a 7:15am failure means the office phone rings.
   This needs a named owner, a documented fallback message, and a visible "tracking is
   currently unavailable" state rather than a stale position. *This is the single biggest
   change and it is organisational, not technical.*

2. **One person, two days a week.** The build depends on Dan; the running system does not
   respect that schedule. Buses run at 6:30am and 3:30pm. Before Phase 3 opens to parents there
   must be a runbook a non-technical person can follow and a second person who can execute it.

3. **A child can suppress their own alert.** Notifications go to the *student's* account. A
   student old enough to bunk is old enough to delete the message saying they did not board.
   **Mitigation: not-boarded alerts must also go to the office, not only the family.** Worth
   deciding whether older students' families should also get a second channel.

4. **Children's data has a legal frame.** The DPDP Act 2023 requires verifiable parental
   consent for processing a child's personal data and restricts tracking and behavioural
   monitoring of children. Bus safety is a defensible purpose, but the school needs a written
   consent note, a stated retention period (recommend location traces kept 90 days, attendance
   kept for the academic year), and a rule for what happens when a child leaves. Cheap to do
   at the start, expensive to retrofit.

5. **Attendance creates a duty of care.** Once the school says it knows which child is aboard,
   it is answerable when that is wrong. A system that is 95% right may be worse legally than no
   system, because it invites reliance. Everything must be framed as *attendant-confirmed*,
   with the confirmation rate visible to management.

6. **The attendance system rots if nobody watches compliance.** It depends entirely on an
   attendant tapping a screen twice per child. That is exactly the kind of task that decays.
   Management needs a daily completion figure per bus, and a gentle escalation, from day one.

7. **Three vendors, three ways to fail.** Keeping Fleet Edge, Way4Track and a third supplier
   means three adapters, three sets of credentials, three contracts to renew and three support
   desks to chase. When a bus stops reporting, the first question is always *which feed?* — which
   is exactly why `tracker_vendor` has to be recorded per vehicle from day one. Mitigations:
   specify a secondary server on the 16 new devices so at least that feed is ours outright; keep
   every adapter behind one common record so a vendor change costs one adapter; and show
   per-source health on the dashboard rather than a single misleading "all systems good".

7b. **A vendor may simply refuse data access — but it is a priced risk, not an open one.** If
   Tata will not point the second stream at us, fitting our own devices to those 11 buses costs
   ₹55,000 one-off and ends the dependency (Section 3.7). The trap is not the money, it is
   spending three months in correspondence to avoid spending it. Set a decision date in Phase 1.

8. **The notification channel is unusual and could move.** Google Chat to student accounts is
   free and works, but it is not what Chat is designed for, and Workspace for Education policy
   can change. **Build the notification layer behind an interface** so Chat can be swapped for
   WhatsApp or SMS without rewriting anything above it. The cost of that abstraction now is a
   day; the cost of not having it later is the whole notification subsystem.

9. **ETAs will be wrong sometimes and parents will treat them as promises.** Show a range, not
   a minute. Show when it was last updated. Never show a confident number from stale data.

10. **Dead zones.** Rural stretches of route will drop signal. The map must say "last seen 4
    minutes ago near X" rather than showing a bus parked in a field.

11. **Do not let the live system creep into the Sheets workbook.** It will be tempting to add
    "just one" live tab. The 6-minute execution limit and cell quotas make that a dead end.

12. **Expectation inflation.** Live tracking generates calls about three-minute delays that
    nobody noticed before. Budget for a short parent communication explaining what the system
    does and does not promise.

13. **Sibling and shared-account handling.** One parent with three children has three student
    accounts. Decide early whether alerts go to each child's account, or whether we build a
    family view. Retrofitting this is painful.

---

## 9. Decisions needed from leadership

1. Approve the budget envelope (Section 6) and the phase sequence.
2. Name the operational owner and the deputy for the live system.
3. Approve the parental consent note and the data retention periods.
4. Decide whether not-boarded alerts go to the office as well as the family. *(Recommended: yes.)*
5. Confirm we may use student Workspace accounts as the parent notification channel.

---

## 10. Timeline

| Phase | Work | Elapsed |
|---|---|---|
| 1 — Plan, audit, approval | 2–4 weeks | Sept 2026 |
| 2 — Tracking, dashboard, campus in/out | ~6 weeks | Oct–Nov 2026 |
| 3 — Parent and management alerts | ~6 weeks | Nov 2026 – Jan 2027 |
| 4 — Student boarding attendance | ~6 weeks | Jan – Feb 2027 |

Roughly six months end to end, live for the start of the 2027–28 academic year with a full
term of real running behind it.

A deliberate note on sequencing: **each phase is useful on its own.** If the project stops
after Phase 2, the school still has a live fleet dashboard and automatic campus in/out times,
and the fuel report gets its odometer readings for free. Nothing is stranded.
