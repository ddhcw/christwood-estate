# PRD: Live Bus GPS Tracking and Parent Bus Notifications

**Project:** `transport` (Christwood Transport Management System)
**Status:** Draft for decision · **Date:** 2026-11-10 · **Revision:** 3 (adds the user's answers of 2026-11-10 and a review of GCM; the changes are listed in §17)
**Owner:** Stella Baby (project owner) · **Contact if broken:** Stella Baby (to be confirmed, Q9) · **Cloudflare account owner:** Dan
**Category:** GAS Web Apps + Hybrid Systems (an ingest component outside GAS feeding a GAS app), feeding GCM (GAS Messaging & Posting)

Checked against:
- the repo `CLAUDE.md`
- `standards/categories/gas-web-apps.md`, `hybrid-systems.md`, `gas-sheet-automations.md` and `gas-messaging-posting.md`
- `standards/estate-wide-best-practices.md`
- `standards/project-shipping-standards.md`
- the RFC rule in `docs/PRD.md` §7

GCM was reviewed in these files, all under `/Users/dan/Public/PROJECTS/`:
- `Christwood/Christwood-GC-mega-project/` (`GCM-REFERENCE-CW.md`, `CLAUDE.md`, `PRD.md`, `trackers/cw-student-dm.md`, `trackers/reply-forward.md`, `rfcs/RFC-010-calendar-feed.md`)
- `AnitaMethodist/GC-mega-project/` (`PLAYBOOK-new-tracker.md`, `library/04_ChatApi.gs`, `05_Resolve.gs`, `06_Template.gs`, `07_Engine.gs`, `08_Outbox.gs`, `10_Setup.gs`, `12_Triggers.gs`)
- the Calendar project's `src/29_GcmFeedLogic.gs` and `src/30_GcmFeed.gs`

---

## 1. Problem and users

Today the school cannot see where a bus is. When a parent rings to ask why the bus is late, the transport in-charge phones the driver, who is driving at the time. If a bus breaks down or goes off route, the office finds out late. Parents wait at the stop without knowing whether the bus is 2 minutes away or 20.

The buses already carry **AIS-140 trackers fitted by the manufacturer**. Their data goes to the manufacturer's platform, which charges a subscription. The school wants **its own system**, both to control the data and to stop paying those fees.

The transport app already records vehicles, drivers, fuel, trips and attendance. `Vehicle_Master` has an unused `gps_device_id` column. Nothing in the app records positions, stops or which students ride which bus.

| User | Device | How often | Needs |
|---|---|---|---|
| Transport in-charge | Phone, sometimes the office desktop | Every run, many times per run | Where the bus is now, whether it has gone quiet, when it was last seen, its speed. In shadow mode, also every parent message the system would have sent |
| Admin and leadership | Phone | A few times a week, and during incidents | The same live view, read-only. Evidence that the system works |
| Pilot driver (**one**) | Their own or a school phone running Traccar Client | Start and stop tracking once per session | A one-page card |
| Parents | Phone. Google Chat DMs on their child's Workspace account (parent-managed), sent by **GCM** from `askus@` | Up to 3 messages per child per session | Messages that the bus is approaching, at the previous stop, reached school or left school. **Shadow mode only in Phase 1** (§6) |

## 2. Goals and non-goals

### Goals

- **G1.** Build the complete pipeline on free tiers and prove it on **one bus, one route, one driver** for about 4 weeks. The pipeline covers the device, ingest, storage, dashboard, alerts and the daily summary. The design must work for the whole fleet without being reworked.
- **G2.** Give the transport in-charge a live map that works on a phone and is honest about its state. Each bus shows as Live, Pending, Stale or Error, with "Data as of HH:MM".
- **G3.** Detect a bus that goes silent during a run and announce it in Ops Alerts within minutes.
- **G4.** Generate parent bus events per session and feed them into **GCM**. Transport must not build its own way of sending Chat messages. It must never send a message that the data cannot support.
- **G5.** Measure accuracy, dropout, latency, battery use, switch-off behaviour, whether events were correct, and **GCM's end-to-end latency**. These numbers drive the Phase 2 decision and the parent go-live decision.
- **G6.** Make Phase 2 a swap at the ingest layer only. **Reusing the AIS-140 device already fitted** is the lead option. Buying an FMB920 is the fallback.

### Non-goals (Phase 1)

- Messages to parents going live. Phase 1 is shadow only.
- A live map for parents.
- Any Chat sending inside transport. GCM delivers every message.
- **Editing the shared GCM library from this repo.** Any library change is separate estate work (§6.5).
- Anything that disturbs the **government VLTD feed** from the fitted AIS-140 devices. This is a hard constraint, not just out of scope.
- Route optimisation, route-deviation alerts, or ETAs more precise than "about N minutes".
- Replacing Trip_Log or the odometer workflow.
- Paid map, geocoding or routing APIs.

## 3. Architecture

### 3.1 Storage: D1 vs KV vs Firestore

At one ping every 30 s while running, the **one-bus pilot** produces about **400–700 pings a day** (morning plus one drop session). A 25-bus fleet produces about **9,000 a day**.

| | Cloudflare D1 | Cloudflare KV | Firestore |
|---|---|---|---|
| Free write budget | 100k rows a day | **1k writes a day** | 20k writes a day |
| Fits the pilot and the fleet? | Yes, and yes with about 4× headroom | Pilot yes, **fleet no** | Yes, but tight at fleet scale |
| Handles latest position, gaps, geofence state, dedupe and purge | Native SQL | Would have to be built by hand | Needs composite indexes |
| How the Worker authenticates | A binding, no credential | A binding | A service-account JWT, which means a new secret |

**Recommendation: D1.** It lives in the same account as the Worker, needs no credential, and has headroom for the whole fleet. Raw pings never touch Sheets, which keeps non-negotiable 12.

### 3.2 Cloudflare: follow the EMIS relay precedent, as a separate Worker

The estate already runs one Worker: `Christwood/student-database-management-system/relay/`. Its name is `christwood-emis-key-relay`, its entry file is `emis-key-worker.mjs`, it is served on `workers.dev`, and it checks an `X-Relay-Secret` header against the `RELAY_SECRET` Worker secret. The Apps Script side stores `EMIS_KEY_RELAY_URL` and `EMIS_KEY_RELAY_SECRET` in Script Properties.

What transport copies from it:
- The **same Cloudflare account (Dan's)**.
- **`.mjs` entry and module files**, so `clasp` never pushes them into Apps Script.
- `wrangler.toml` beside the code, deployed with `wrangler deploy` and `wrangler secret put`.
- Server-to-server calls authenticated by a **shared-secret header in the RELAY_SECRET style**. Here the headers are `X-Transport-Read-Secret` and `X-Transport-Config-Secret`.

**Use a separate Worker, `christwood-transport-gps`, in the same account. Do not add routes to the EMIS relay.** The two have different jobs and different blast radius. This Worker needs a D1 binding, cron triggers and a public ingest path. The EMIS relay is a narrow proxy that should stay that way. A second account would add login, billing and recovery overhead and buy nothing. The code lives at `projects/transport/gps-worker/` in this repo (R24).

Three places where transport deliberately **departs from the precedent**:
1. Device tokens travel in the URL path. Traccar Client cannot set headers.
2. Every secret comparison is constant-time. The relay compares with `!==`.
3. **No secret value is ever written into a file.** The relay folder has a `SCRIPT-PROPERTIES.txt` that holds the live `EMIS_KEY_RELAY_SECRET` in plaintext, in a folder under `~/Public` with no git repo. Transport must not copy that. Treat that relay secret as exposed: rotate it and delete the file. This is noted for Dan and is outside this PRD's scope.

### 3.3 Data flow

```
Phase 1: driver phone (Traccar Client, OsmAnd HTTP)
Phase 2: fitted AIS-140 unit --TCP (secondary server slot)--> Traccar on a small VM --HTTP forward-->
  │
  ▼  https://christwood-transport-gps.<subdomain>.workers.dev/v1/{osmand|traccar}/<token>
Cloudflare Worker "christwood-transport-gps" + D1
  ├─ ingest adapter --> canonical Ping --> pings, device_latest
  ├─ trip engine (on each fresh ping): which session trip is running, geofence crossings, ETA
  │     --> stop_events (deduped) --> outbox --> signed POST to the transport GAS doPost
  ├─ cron every 5 min: bus stale detection --> Ops Alerts; retry the outbox
  ├─ cron daily 23:30 IST: trip_daily, purge
  └─ read API (secret header): /v1/latest, /v1/track, /v1/daily, /v1/events, /v1/health
  ▲ config push (devices, trips, stops, settings)
Transport GAS web app (existing script)
  ├─ doPost (HMAC) --> fan-out over Student_Trip_Stops --> Parent_Notify_Log (transport's own record)
  │     └─ GCM feed (Calendar precedent: opens the GCM control sheet by ID)
  │          appends rows to GCM 📤 OUTBOX for project "cw-bus-notify"
  │          mode shadow_local: no GCM rows | shadow_gcm: Recipient = shadow space | live: Recipient = Admission No
  ├─ Live buses view (admin token): Leaflet + OSM
  ├─ nightly (inside rebuildAnalytics): GPS_Daily, shadow rollup, reconcile with the GCM 📨 MESSAGE LOG
  └─ gpsWatchdog every 15 min in service windows --> Ops Alerts
GCM (unchanged library; its own control sheet)
  └─ trgSweepOutbox every 10 min, only inside SEND_WINDOW --> DM from askus@ (or a post to the shadow space)
```

### 3.4 Ingest contract and the Phase 2 options

Every adapter produces the same **canonical Ping**:
- `device_id`, taken from the token and never from the query string
- `vehicle_id`, stamped at ingest
- `fix_ts` and `recv_ts`, as epoch ms UTC
- `service_date` in `yyyy-MM-dd`, Asia/Kolkata
- `lat`, `lon`, `speed_kmh`, `bearing`, `accuracy_m`
- `battery_pct`, phone only
- `ignition`, hardwired only
- `source`
- `late`, set when `recv_ts - fix_ts > 120 s`

Everything after the adapter is the same whatever the source.

**Phase 2, Option A (lead): reuse the AIS-140 device already fitted.** AIS-140 units must report to the state VLTD backend. Many units can also send a copy to a **second server IP and port**, which is configured by an SMS command or through the vendor's tool. That stream is **raw TCP in the device's own protocol, not HTTP**. Free tiers cannot receive it, so it needs **Traccar on a small VM** listening on that port. Traccar decodes the stream and forwards positions as JSON to `/v1/traccar/<forwarder_token>`, which goes through the same R6 adapter.

Option A is viable only if all of these hold:
1. **Traccar supports the device's protocol.** Check the make and model against Traccar's supported-device list (Q1a).
2. **The vendor allows a secondary server, or offers an API or webhook.** Some vendors lock the configuration or password-protect SMS commands (Q1b). If they offer an API or webhook instead, a third adapter replaces Traccar and the VM.
3. **The VLTD primary slot and the emergency or panic-button slot are never touched.** Only an unused secondary slot is set. The change is made on one bus first, and someone confirms that bus still reports to VLTD (vendor portal or state dashboard) before any other bus is changed (Q1c).
4. **Ownership of the SIM and data plan is clear.** If the SIM belongs to the vendor and is billed through the subscription the school wants to drop, cancelling the subscription may also cut the data, and the school's own feed would stop with it (Q1d).
5. **The contract allows it.** Reconfiguration may void warranty or support, and cancelling may affect AIS-140 compliance services the school is obliged to keep (Q1e, Q1f).

**Phase 2, Option B (fallback): buy a Teltonika FMB920**, or another device Traccar supports, and run it through the same Traccar VM. Use this if the vendor locks the AIS-140 unit, its protocol is unsupported, or reconfiguring it puts VLTD at risk.

Both options need the Traccar VM. Neither option changes anything after the adapter. Fixtures for R6 are written in Phase 1. Once the AIS-140 make is known, a fixture in that protocol is decoded through Traccar and replayed (T4).

## 4. Requirements: tracking

### Ingest (Worker)

- **R1.** `/v1/osmand/<device_token>` accepts the OsmAnd parameters sent by Traccar Client, by GET or POST. *Test:* a replay of 100 recorded pings gives 100 correct rows, with speed converted from knots to km/h.
- **R2.** Each device gets its own random token of at least 128 bits. D1 stores only its SHA-256 hash, and comparison is constant-time. The token never appears in source, a Sheet or any file; only `token_last4` is shown. *Test:* a wrong token returns 401 and writes nothing, and a grep of the repo and the Sheet finds no token.
- **R3.** Inserts are idempotent: `(device_id, fix_ts)` is the primary key and inserts use `INSERT OR IGNORE`. *Test:* sending the same 50 pings twice leaves 50 rows.
- **R4.** A malformed ping that passed authentication still gets **HTTP 200**, and is written to `rejects` with a reason. Any other status makes Traccar Client retry that ping forever. *Test:* each reject reason returns 200 and adds one `rejects` row.
- **R5.** Each device may send at most one ping per 5 s, and each body may be at most 4 KB. *Test:* a burst of 20 pings in 10 s stores at most 3.
- **R6.** `/v1/traccar/<forwarder_token>` takes Traccar's position-forward JSON and produces the same canonical Ping. It is built and tested in Phase 1 and switched off until Phase 2. *Test:* matched OsmAnd and Traccar fixtures produce identical rows. Once the make is known, an AIS-140-protocol fixture decoded through Traccar produces a valid row.
- **R7.** When `store_outside_window = No` (the default for phones), pings arriving outside the service window plus grace are acknowledged and thrown away. *Test:* a phone ping at 22:00 IST stores nothing and increments a counter.

### Storage and retention

- **R8.** An idempotent migration creates these D1 tables: `devices`, `pings`, `device_latest`, `rejects`, `trips`, `stops`, `trip_stops`, `trip_runs`, `stop_events`, `outbox`, `trip_daily`, `alert_state`, `config` and `meta`. *Test:* a second run changes nothing.
- **R9.** Retention:
  - Raw pings: `gps_retention_days`, default 90. The purge runs in chunks of at most 5,000 rows.
  - `rejects`: 30 days.
  - `stop_events` and `outbox`: 90 days.
  - During the pilot, nothing is purged until 30 days after the go/no-go decision.

  *Test:* a ping seeded at 91 days is purged and one at 89 days is kept.

### Status, alerts and honesty

- **R10.** Each mapped bus has exactly one status, computed by a pure function that is tested with `node --test`:
  - **Live** (green, ✓): last fix no older than `gps_stale_minutes` (default 5).
  - **Pending** (amber, ⏳): inside a service window with no fix yet.
  - **Stale** (grey, ⌛): inside a window and the last fix is too old. Outside every window the label is "Off duty · last seen HH:MM", and no alert is raised.
  - **Error** (red, ⚠): any of rejects or auth failures in the last 15 minutes, median accuracy above 100 m, battery below 20 %, or the bus mapped to a vehicle that is not Active.

  *Test:* a table-driven test at each boundary minute.
- **R11.** Every 5 minutes inside a window, the Worker posts to Ops Alerts once when a bus becomes Stale or Error, and once when it recovers. `alert_state` prevents repeats. Each post is retried 3 times with backoff and jitter, and a final failure appears on `/v1/health`. *Test:* a 60-minute silence produces one stale card and one recovery card.
- **R12.** `gpsWatchdog` in GAS runs every 15 minutes inside service windows. It raises an alert in any of these cases:
  - `/v1/health` is down.
  - The Worker cron has been silent for more than 15 minutes.
  - The Worker outbox, Parent_Notify_Log or this project's GCM 📤 OUTBOX rows hold items older than 15 minutes.

  If Chat fails, the alert goes by email to `alert_email`. The manual twin is the menu item "Check GPS now". *Test:* a stubbed stale health response produces exactly one alert per episode.
- **R13.** Every GPS view shows "Data as of HH:MM" in Asia/Kolkata, taken from the server's newest `recv_ts`. If the Worker is down, the view shows the cached data under a red banner and is never blank. *Test:* with the Worker stubbed down, the cached buses, the banner and the original time are shown.

### Dashboard

- **R14.** "Live buses" is a view for admins only. Every server function behind it (`getGpsLive`, `getGpsTrack`, `getGpsDaily`, `getNotifyLog`) checks `adminName_(token)` on the server. The app is deployed `ANYONE_ANONYMOUS`, so this check is the only lock. *Test:* calls with no token, an expired token or a forged token return `{ok:false}` and no coordinates or student data.
- **R15.** The map uses Leaflet and OSM tiles, with no API key. The list underneath shows each bus's status and icon, last seen, speed, battery, the current session trip and the next stop with an approximate ETA. It works at 360 px with tap targets of at least 44 px, refreshes every 30 s, pauses when the page is hidden, and has a manual Refresh. *Test:* at 360 px there is no horizontal scroll and the list is ordered Error, Stale, Pending, Live.
- **R16.** "Today's track" draws the path, with gaps longer than 2 minutes dashed and the stop geofences drawn. *Test:* a 6-minute gap shows as one dashed segment.
- **R17.** The server caches `/v1/latest` for 20 s. *Test:* 5 loads within 20 s make one Worker request.
- **R18.** Every GPS view and every view of the notification log is recorded in `GPS_Access_Log`. *Test:* opening the map and then a track adds 2 rows.

### Config and the Sheet layer

- **R19.** `setupWorkbook()` adds the tabs and Settings described in §7 idempotently, including headers, validation and status formatting. The new tabs are read **by header name**. *Test:* running it twice on a copy leaves existing data unchanged.
- **R20.** GPS_Devices, Transport_Trips, Transport_Stops, Trip_Stops and the GPS Settings are pushed to `/v1/admin/config`. The push is signed with the config-secret header and carries a content hash. *Test:* changing a stop radius takes effect on the next ping, and an unchanged push records no new version.
- **R21.** Issuing or reissuing a token shows it once, as a QR code and URL. Reissuing revokes the old token. *Test:* after a reissue the old token gets 401.
- **R22.** The nightly `gpsDailyPull` runs inside `rebuildAnalytics` and upserts GPS_Daily on `day_key`. The manual twin is "Pull GPS summary for a date". *Test:* running it twice leaves one row.

### Ops

- **R23.** Secrets live only in two places:
  - **Worker secrets:** `OPS_ALERTS_WEBHOOK`, `READ_SECRET`, `CONFIG_SECRET`, `GAS_EVENT_HMAC_KEY`.
  - **Transport Script Properties:** `GPS_WORKER_URL`, `GPS_READ_SECRET`, `GPS_CONFIG_SECRET`, `GPS_EVENT_HMAC_KEY`, `OPS_ALERTS_WEBHOOK`, `GCM_CONTROL_SHEET_ID`, `GCM_SHADOW_SPACE`.

  The control sheet ID is an identifier, not a secret, but it is kept out of source in the same way the Calendar precedent does. **No `SCRIPT-PROPERTIES.txt` holding values may exist, unlike the relay precedent.** *Test:* grepping the repo for each value finds nothing.
- **R24.** The Worker lives at `projects/transport/gps-worker/` and is written only as `.mjs` files, following the EMIS precedent. `.claspignore` also explicitly excludes `gps-worker/**` and `docs/**`. *Test:* `clasp status`, run by a human, lists nothing under `gps-worker/`.
- **R25.** The ops README covers:
  - the Worker URL and the account owner (Dan)
  - where each secret lives, and the crons
  - how to reissue a token and how to pause a bus
  - the notification mode switch
  - how the GCM project is paused (📋 PROJECTS `Status=PAUSED`)
  - the Phase 2 adapter switch
  - who to contact

  *Test:* a second person can switch modes and pause the project using only the README.

## 5. Requirements: trips, stops and events

### 5.1 Sessions, trips and stops

The pilot covers **one bus and one route**. The model is built for the whole fleet.

- **R26. Session trips.** A *trip* is keyed by a **session** and has **its own route number**. The sessions are `MORNING_PICKUP`, `AFTERNOON_DROP` and `EVENING_DROP`. The same bus may run morning route 7 and evening route 12, and different buses may run the two. `Transport_Trips` has one row per trip, with these fields:
  - `trip_code`
  - `session`
  - `route_no`
  - `vehicle_id`
  - `window_start` and `window_end`
  - `active`

  A *trip run* is `trip_run_id = yyyy-MM-dd|trip_code`. `Vehicle_Master.route_no` is **not** used as the trip key, because a bus does not have one route number across sessions. It stays as it is for attendance (see the PROJECT.md footgun about route numbers). *Test:* one vehicle with a morning trip and an evening trip under different route numbers opens two separate runs on the same day.
- **R27. Stops are named places, geocoded once and verified by driving.** The school's existing Sheet names each stop's location but holds **no coordinates** (Q12). `Transport_Stops` has one row per physical stop:
  - `stop_id`
  - `stop_name`, exactly as in the school's sheet
  - `landmark`
  - `lat` and `lon`
  - `radius_m`, default 75
  - `kind`, either stop or school
  - `coord_source`, one of `driven` / `map_tap` / `geocoded_draft`
  - `verified_by` and `verified_on`
  - `active`

  Coordinates come from **driving the route**: the in-charge rides with the stop capture tool and taps "Mark this stop" at each stop, which records the bus phone's position. They can also come from tapping the map. Automatic geocoding of the place name is allowed only as `geocoded_draft`. **Events fire only at stops with a non-blank `verified_on`.** The school gate is one `kind = school` row with a 150 m radius. *Test:* a stop with only a draft is skipped by the event engine and listed as "unverified" in setup validation.
- **R28. Stop sequence per trip.** `Trip_Stops` has the columns `trip_code`, `sequence`, `stop_id` and `scheduled_time`. Every trip has its own sequence. In a pickup trip, school is last. In a drop trip, school is first. The same physical stop can appear in several trips. *Test:* validation flags a duplicate sequence number, a missing school row and a stop more than 30 km from school.
- **R29. A stop per student per session.** `Student_Trip_Stops` has one row per student per session, which allows different pickup and drop points and different trips:
  - `admission_no`, in GCM's `C0nnnnn` form
  - `session`
  - `trip_code`
  - `stop_id`
  - `notify`, Yes or No
  - `active`
  - `edited_by` and `edited_at`

  It holds no names and no parent contact details. *Test:* a stop that is not in that trip's `Trip_Stops` is flagged red, and a student with different morning and evening stops gets the right events in each session.
- **R30. Stop capture and import tool.** It covers four jobs:
  1. A one-time **import** of the school's named-location sheet into `Transport_Stops`, `Trip_Stops` and `Student_Trip_Stops`, once the headers are confirmed (Q12). The import is idempotent and reports any row it cannot map.
  2. "Mark this stop" while driving.
  3. Map tap.
  4. Suggestions from dwell points in recorded tracks, meaning places where the bus stood still for 20 s or more within 30 m.

  Every save is written to the audit log. *Test:* importing twice creates no duplicates, and a marked stop saves coordinates to 6 decimal places with `coord_source = driven`.

### 5.2 Engine

- **R31. Trip runs.** A run opens on the first fresh ping inside the window of the trip assigned to that vehicle for that session. It closes at the end of the window plus grace, or after the last stop of a drop trip. *Test:* pings from 06:40 to 08:20 open and close exactly one morning run.
- **R32. Geofence crossing.** A crossing counts in either of two cases:
  - a fix lands inside `radius_m` with `accuracy_m` no worse than `notify_max_accuracy_m` (50);
  - the line between two consecutive fresh fixes passes within `radius_m` of the stop.

  A bus has left school after 2 consecutive fixes beyond 1.5 × radius at a speed above 5 km/h. The engine only moves forward through the sequence. *Test:* a pass-through at 40 km/h with 30 s pings is detected, and GPS jitter at the gate produces exactly one "left school".
- **R33. Approximate ETA.**
  - Remaining distance is the sum of straight-line legs from the bus, through each remaining stop in the sequence, to the student's stop, multiplied by `eta_road_factor` (1.3).
  - Speed is the median moving speed over the last 5 minutes, held between 12 and 45 km/h.
  - The ETA is always worded "about N minutes" and is never given as a clock time.

  *Test:* known-geometry unit tests, plus ETA error reported in shadow mode.

### 5.3 Event types per session

| Event | Fires when | Sent to | Sessions |
|---|---|---|---|
| `bus_approaching` | The ETA to the student's stop first falls to `notify_eta_minutes` (5) or less, before the bus has crossed that stop | Students at that stop on this trip | All three |
| `bus_at_previous_stop` | The bus enters the geofence of the stop just before the student's stop in sequence | Students at the next stop | All three |
| `bus_reached_school` | The bus enters the school geofence | Students on the morning trip whose pickup stop was crossed (Q13) | `MORNING_PICKUP` |
| `bus_left_school` | The bus leaves the school geofence | Students on that drop trip | `AFTERNOON_DROP`, `EVENING_DROP` |

- **R34. Stop-level events, recorded in the Worker.**
  - Each event is stored once, keyed by `event_key = trip_run_id|stop_id|event_type` (`INSERT OR IGNORE`), with an `expires_at`:
    - approaching: 8 minutes
    - previous stop: 5 minutes
    - school events: 20 minutes
  - Events go to transport's `doPost` as batches signed with HMAC-SHA256 over body and timestamp. A timestamp more than 5 minutes old is rejected.
  - The cron retries until `expires_at`, then marks the event `expired`.

  *Test:* the same crossing produces one row, a bad signature gets 401, and an expired item is never delivered.
- **R35. Fan-out and sent-flags in transport.** `doPost` expands each stop event against `Student_Trip_Stops` into `Parent_Notify_Log`, keyed by `dedupe_key = trip_run_id|admission_no|event_type`. Rows that already exist are skipped. Each batch is written with one `setValues` under `LockService`. *Test:* replaying a batch 3 times changes nothing, and `notify = No` produces no row.
- **R36. Better silent than wrong.** An event is suppressed, and logged with a reason, in any of these cases:
  - The fix that triggered it is `late`.
  - The fix is older than 90 s when evaluated.
  - The bus is not Live.
  - Accuracy is worse than 50 m.
  - There are fewer than 3 speed samples.
  - The stop is unverified.
  - The event arrives after `expires_at`.

  An outage is never reported to parents. *Test:* one fixture per reason produces a suppressed row and **no GCM row**.

## 6. Parent notifications through GCM

### 6.1 What GCM actually is (reviewed, 2026-11-10)

- **Sheet-driven and shared.** A control sheet holds ⚙️ SETTINGS, 📋 PROJECTS, 📝 TEMPLATES, 🎓 ROSTER, 🚫 SUPPRESSION, 📤 OUTBOX and 📨 MESSAGE LOG. The code is a **shared library** at `AnitaMethodist/GC-mega-project/library/`. At Christwood it is published as version 1 (GCM 1.10.0) and pinned by shims. It is never edited from a school folder.
- **Senders and recipients.** Messages are student DMs from `askus@christwood.edu.in` to the child's account. Those accounts are parent-managed, so the reader is a parent and sometimes the child. Messages are **TEXT only** (DMs cannot carry cards) and **English only** (Christwood Q8).
- **Addressing is strict.** Recipient Mode `ADMISSION_NO` resolves through 🎓 ROSTER with `ROSTER_STRICT=TRUE`. An admission number that is not in ROSTER, or is marked LEFT, is **skipped with a stated reason** and never messaged (`05_Resolve.gs`). ROSTER contains only students whose migrated `c0nnnnn@` account has been verified.
- **Two ways in:**
  1. A **tracker sheet** run by a person through Preview → TEST → LIVE, or by AUTO.
  2. **📤 OUTBOX** rows with the headers `Queued At · Project ID · Recipient · Template ID · Values (JSON) · Send After · Status · Result · Hash`, appended by `GCM.enqueue()` or by any system that writes the sheet. Rows are drained by `trgSweepOutbox` **every 10 minutes**, **only inside `SEND_WINDOW`** (Christwood: `07:00-19:00`), with `PAUSE_MS` 600 between sends (`08_Outbox.gs`, `10_Setup.gs:327`).
- **AUTO.** AUTO schedules (`AUTO_ENABLED`, which is `FALSE`) fire **at most once per day per project**, at a 30-minute tick (`12_Triggers.gs runSchedules_`). That makes them useless for bus events. **The OUTBOX sweeper is not gated by `AUTO_ENABLED`.** It checks only `SEND_WINDOW`, the lock and the project's `Status`. Even so, Christwood's decision is that "every v1 send is a person pressing LIVE", and **no unattended path has ever sent to families in production anywhere in the estate**. Transport would be the first.
- **Controls:**
  - Dedupe is an MD5 of `project|recipient|body` over `DEDUPE_WINDOW_DAYS` (2).
  - `DAILY_SEND_CEILING` is 2500, and it only warns.
  - `LOG_SCAN_ROWS` is 6000.
  - 🚫 SUPPRESSION stops messages to an individual.
  - 📋 PROJECTS `Status=PAUSED` is the emergency stop. Queued OUTBOX rows are then held.
- **Replies** to a DM go to the **class teacher** through 📇 REPLY ROUTING.
- **Safeguarding rules for v1.** No marks, attendance, health or family information. Every new wording goes through TEST before LIVE.
- **Precedent for another system feeding GCM.** The Calendar project (RFC-010 / RFC-011) opens the control sheet **by ID** (`GCM_CONTROL_SHEET_ID` in its Config). It writes only into tabs it owns rows in, marks its own rows, writes in one batch, runs as a sweep job with a menu twin, and **does not touch the library**.

### 6.2 Integration design: a new GCM project fed through 📤 OUTBOX

A tracker sheet run from LIVE needs a person pressing a button, and AUTO runs once a day, so neither works for bus events. Transport instead uses the **OUTBOX path, following the Calendar precedent**.

- **GCM side (new config rows, no code; written as a GCM RFC by the GCM maintainer):**
  - A 📋 PROJECTS row with project ID `cw-bus-notify`, Recipient Mode `ADMISSION_NO`, Delivery `API`, `AUTO=FALSE` and `Status` `PAUSED` until go-live.
  - Four 📝 TEMPLATES rows: `cw-bus-approaching`, `cw-bus-previous-stop`, `cw-bus-reached-school`, `cw-bus-left-school`. All are TEXT. Their placeholders are `{{Bus}}`, `{{Session}}`, `{{ETA}}`, `{{Previous Stop}}`, `{{Time}}` and `{{Date}}`. The child's name, if used at all, goes as `{{Student Name?}}` on its own line, following the `cw-student-dm` convention.
  - A 🚀 DEPLOYMENTS entry is not needed, because there is no shim. Transport writes to OUTBOX directly.
- **Transport side (T20):**
  - For each `Parent_Notify_Log` row that is due, transport appends one OUTBOX row: `Project ID = cw-bus-notify`, `Recipient = admission_no` (or the shadow space, see §6.4), `Template ID` for the event type, `Values (JSON)` holding the placeholder values, `Send After` blank and `Status = READY`.
  - All rows from one event are appended in a single batch under transport's lock. Transport never edits an OUTBOX row after appending it. The sweeper reads and writes back a fixed region, so editing an existing row would race with it.
  - The transport account (the web app runs as `USER_DEPLOYING`) needs **edit access to the control sheet**. That account is on GCM's access list, so it can also read 📥 REPLIES. That is an access decision for the GCM owner (Q10b).
- **Roster pre-check.** Transport reads 🎓 ROSTER read-only, by ID, every night. A student who is not on ROSTER is shown as **"Not reachable by GCM"** in transport's view and gets no OUTBOX row, so a `Student_Trip_Stops` row cannot silently be a dead end.
- **Reconciliation.** Every night, transport reads this project's rows from 📨 MESSAGE LOG and OUTBOX. It copies GCM's `SENT`, `SKIPPED` and `FAILED` status and the time sent into `Parent_Notify_Log`. That gives the true delivery latency for each message.
- **GCM's hash dedupe.** GCM skips an identical body to the same student within 2 days. "Bus reached school" would therefore be **silently skipped on day 2**. Every template must include `{{Date}}` and `{{Time}}` so the body differs. Transport's `dedupe_key` stays the authority. GCM's hash is a second safety net.
- **Volume.** One bus with about 40 students sends at most about 240 messages a day across the 3 event types and 2 sessions. A 25-bus fleet would send about 6,000, which is **above `DAILY_SEND_CEILING` 2500** and breaks GCM's `LOG_SCAN_ROWS > ceiling × DEDUPE_WINDOW_DAYS` invariant (6000 > 5000 today). Going fleet-wide needs those settings raised, and the MESSAGE LOG growth reviewed, as GCM work.

### 6.3 The hard problems, stated honestly

**(a) Real-time latency.** These figures come from the code and are not yet measured.

| Step | Time |
|---|---|
| Wait for the next sweeper tick | 0–10 minutes (installed `everyMinutes(10)`, plus Apps Script trigger jitter) |
| Lock wait | Up to 30 s, otherwise the sweep is held to the **next** tick (`tryLock(30000)`, then "another send in progress") |
| Send | About 1 s per message (`PAUSE_MS` 600 plus about 0.4 s for the API call) |

- **Typical end-to-end: about 5 minutes. Worst case on a quiet day: about 11 minutes.** While a whole-school send is running (about 2 hours), sweeps compete for the lock and the delay has no reliable upper bound.
- **Outside `SEND_WINDOW` 07:00–19:00, nothing is sent at all.** Morning pickups before 07:00 and evening drops after 19:00 would be held. The next morning they would be delivered stale, because **OUTBOX rows have no expiry**.

Consequences:
- `bus_approaching` ("about 5 minutes") and `bus_at_previous_stop` are **not deliverable through GCM as it is today**. They would usually arrive after the bus.
- `bus_reached_school` and `bus_left_school` can tolerate a delay of 5–10 minutes, but only inside the window.

GCM would need these changes before stop-level events can go live:
1. An **`Expires At`** value on OUTBOX rows, honoured by the sweeper, which marks the row `EXPIRED` instead of sending it.
2. A **fast lane**. Either a library entry point such as `sendNow(projectId, items)` that applies ROSTER, SUPPRESSION, dedupe, ceiling, PAUSED and logging and sends at once, or a per-project sweep every minute.
3. A **per-project send window**, for example 06:00–20:00 for `cw-bus-notify`, without widening the window for everything else.
4. **Per-project reply routing**, so that replies to bus messages go to the transport in-charge instead of the class teacher.

Calling a library entry point from transport would mean transport including the GCM library. The GCM owner must decide on that access, because Christwood's rule D3/D4 is that only the maintainer and the owner may open the library.

**(b) The unattended path has never run in production.** Transport would be the first project to send to families without a person pressing LIVE. That is a **gate at RFC level, in GCM's own process**. The GCM owner must approve an exception to "every v1 send is a person pressing LIVE", with a fallback and a stop: `Status=PAUSED` stops the project and holds its queued rows. Following the playbook, the first live sends go to **five families, not a whole route**.

**(c) The shared library is not edited from here.** Every change in (a) is **separate estate work**. It needs a GCM RFC, a `GCM_VERSION` bump, a CHANGELOG entry, a published version and a re-pin at every school. Transport's tickets do not include it (see T25). Until it ships, transport can only go live with the two school events.

**(d) Safeguarding.** A message saying where a child's bus is reveals a child's routine and stop. Rules:
- The **school's safeguarding lead must review** the wording before any family receives one.
- Messages describe **the bus, never the child**. They do not say "your child has boarded" or "your child reached school". That would be attendance information, which GCM v1 bans, and GPS on a bus cannot know it anyway.
- The student's own stop is **never named**. It is "your stop". If a ROSTER or stop-assignment error sends a message to the wrong family, it will not reveal another child's stop. The previous stop may be named, because it is a route landmark and not this family's stop.
- Messages give no times of future runs.
- 🚫 SUPPRESSION and `notify = No` must be honoured, and both are tested.
- Siblings each receive their own copy on their own account. That is accepted.

**(e) Strict ROSTER.** A student receives nothing unless their admission number is on GCM's ROSTER with a verified account. Transport must use the same `C0nnnnn` admission numbers, and the pre-check in §6.2 shows the gaps. Students still waiting for the account migration are visible as unreachable and are not silently dropped.

**(f) Language.** GCM at Christwood is English-only (Q8, answered 29 Sep 2026). The estate rule is that parent-facing output ships in en, ta and ta-Latn. Transport keeps all three in `Notify_Strings` (R38). Delivery through GCM needs a decision from the school (Q15):
1. **English only**, with the exception to the estate rule recorded in the GCM RFC.
2. **One bilingual message** (English plus Tamil, or plus Tanglish) in a single template. This needs no change to the library, but makes the message longer.
3. **A per-family language preference** in GCM. This is a library change (estate work).

This PRD recommends option 2 for bus messages, subject to a native-speaker review. It does not decide for the school.

### 6.4 Shadow mode inside GCM (the Phase 1 default)

`parent_notify_mode` takes four values: `off`, `shadow_local`, `shadow_gcm` or `live`. The pilot runs in shadow throughout.

1. **`shadow_local`** (pilot weeks 1–2). Events are written only to `Parent_Notify_Log`. The in-charge reviews them in the shadow view (R40). Nothing touches GCM. This measures whether the events are correct.
2. **`shadow_gcm`** (pilot weeks 3–4, once the GCM RFC has added the project rows). The same OUTBOX rows that live mode would write are appended to the real `cw-bus-notify` project, with the same templates. **`Recipient` is replaced by the dedicated shadow space ID** (`spaces/…`, from Script Property `GCM_SHADOW_SPACE`). GCM resolves a literal `spaces/` recipient in any Recipient Mode (`05_Resolve.gs:19`), so the messages go to a staff space, **"Transport – bus messages (shadow)"**, which contains the in-charge and `askus@`, and reach no family.
   - This is **a redirect, not GCM's TEST space**. TEST is for checking wording, and Christwood keeps TEST and Ops Alerts separate (D8).
   - It exercises GCM's templates, sweeper, logging and pause, and it **measures GCM's real latency**.
   - In shadow, ROSTER fields such as `{{Student Name?}}` are empty, so they must be optional and sit on their own line.
   - Shadow traffic counts towards `DAILY_SEND_CEILING`. For one bus that is negligible.
3. **`live`**. The recipient is the admission number. Live can be limited to chosen event types (`parent_notify_types`) and chosen trips (`parent_notify_trips`). Every condition below must hold:
   - The §11 shadow criteria are met.
   - The GCM RFC is approved, including (b) and (f).
   - The safeguarding lead has signed off (d).
   - The parent notice has gone out with an opt-out.
   - For the stop-level events, the T25 library changes have shipped.

   The likely sequence is the **school events first, to five families on the pilot trip**, followed by stop-level events only after T25.

- **R37. Modes.** In `shadow_local` no GCM row is written. In `shadow_gcm`, every OUTBOX row's `Recipient` starts with `spaces/` and none is an admission number. In `live`, rows go only for the enabled types and trips. *Test:* in each mode, an assertion over the generated OUTBOX payloads checks this.
- **R38. Strings.** `Notify_Strings` has the columns `key`, `en`, `ta` and `ta-Latn`. It ships in the first commit. Every language has the same placeholders. The GCM templates are generated from it in whichever form Q15 decides. *Test:* a placeholder-parity check, plus native-speaker review.
- **R39. Delivery state and failure.** Each `Parent_Notify_Log` row ends in one of: `local_only`, `queued_gcm`, `sent`, `skipped` (with GCM's reason), `failed`, `expired`, `suppressed`. A GCM `FAILED` or `SKIPPED` raises **one Ops Alert per trip run**, not one per student. GCM's own sweep alerts for ERROR rows already exist. Any OUTBOX row of this project still `READY` 15 minutes after being queued raises an alert through the watchdog (R12), because GCM cannot expire rows yet. *Test:* a stubbed MESSAGE LOG with failures produces one alert, and reconciliation copies the statuses across.
- **R40. Shadow review view.** For each trip run, an admin list shows the events, their English text, how many targets, the mode, the status, any suppression reason, the ETA error (actual crossing minus prediction), and **GCM latency** (from GCM's log time minus queue time). *Test:* a seeded run shows correct ETA errors and correct latencies.

## 7. Data

### 7.1 What exists today (verified in `projects/transport`)

The transport workbook (`1RATX-5OGVEvfEXd1xzsJOtFDpGxkU_2Xg7wOPcaCF8k`) has **no stop, location, student or pickup/drop data**. Searches of `Setup.js` `HEADERS`, `Data.js` and every `.html` file found none. Route numbers exist only as `route_no` on `Vehicle_Master`, `Attendance_Roster` and `Attendance_Log`. The `reference/` folder holds only an attendance CSV.

**The school's named-location sheet is outside this repo, and its name, location and headers are unknown.** The import (R30) cannot be specified until a CSV export with its real headers is supplied (Q12). The headers below are transport's own new tabs, not guesses at the school's sheet.

### 7.2 New tabs (read by header name)

| Tab | Columns |
|---|---|
| **GPS_Devices** | `device_id`, `vehicle_id`, `kind` (phone/hardwired), `source_protocol` (osmand/traccar), `holder`, `active_from`, `active_to`, `store_outside_window`, `token_last4`, `token_issued_at`, `status`, `notes`, `edited_by`, `edited_at` |
| **Transport_Trips** | `trip_code`, `session` (`MORNING_PICKUP`/`AFTERNOON_DROP`/`EVENING_DROP`), `route_no`, `vehicle_id`, `window_start`, `window_end`, `active`, `edited_by`, `edited_at` |
| **Transport_Stops** | `stop_id`, `stop_name`, `landmark`, `lat`, `lon`, `radius_m`, `kind`, `coord_source`, `verified_by`, `verified_on`, `active`, `edited_by`, `edited_at` |
| **Trip_Stops** | `trip_code`, `sequence`, `stop_id`, `scheduled_time` |
| **Student_Trip_Stops** | `admission_no`, `session`, `trip_code`, `stop_id`, `notify`, `active`, `gcm_reachable` (written by code from the ROSTER pre-check), `edited_by`, `edited_at` |
| **Parent_Notify_Log** | `dedupe_key`, `event_id`, `created_at`, `service_date`, `trip_run_id`, `session`, `event_type`, `admission_no`, `stop_id`, `eta_minutes`, `mode`, `status`, `suppressed_reason`, `gcm_queued_at`, `gcm_status`, `gcm_result`, `gcm_sent_at`, `latency_s`, `actual_crossing_at`, `eta_error_min` |
| **Notify_Strings** | `key`, `en`, `ta`, `ta-Latn`, `notes` |
| **GPS_Daily** | Unchanged, plus `trip_code`, `session`, `events_fired`, `events_suppressed`, `median_eta_error_min`, `median_gcm_latency_s` |
| **GPS_Access_Log** | Unchanged |

- `Vehicle_Master.gps_device_id` becomes a read-only mirror of GPS_Devices (Q8).
- `Parent_Notify_Log` is archived monthly.

**Settings** (new keys):
- `gps_enabled`
- `gps_service_days`
- `gps_window_grace_min` (15). Trip windows now live on Transport_Trips.
- `gps_stale_minutes` (5)
- `gps_ping_interval_s` (30)
- `gps_retention_days` (90)
- `gps_alerts_enabled`
- `gps_purge_enabled` (No)
- `parent_notify_mode` (`shadow_local`)
- `parent_notify_channel` (`gcm`)
- `parent_notify_types`
- `parent_notify_trips`
- `gcm_project_id` (`cw-bus-notify`)
- `notify_eta_minutes` (5)
- `notify_max_fix_age_s` (90)
- `notify_max_accuracy_m` (50)
- `eta_road_factor` (1.3)
- `eta_speed_window_min` (5)

### 7.3 D1

| Table | Columns or source |
|---|---|
| `devices` | `device_id`, `token_hash`, `kind`, `vehicle_id`, `store_outside_window`, `status` |
| `pings` | Primary key `(device_id, fix_ts)`, index `(vehicle_id, service_date)` |
| `device_latest` | |
| `trips`, `stops`, `trip_stops` | Pushed copies of the Sheet tabs. **Stops have coordinates but no student links.** |
| `trip_runs` | `trip_run_id`, `vehicle_id`, `session`, `opened_at`, `closed_at`, `last_crossed_seq`, `inside_school` |
| `stop_events` | `event_key` and so on |
| `outbox`, `trip_daily`, `alert_state`, `config`, `meta` | |

- **D1 holds no admission numbers.**
- Times are stored as epoch milliseconds in UTC. `service_date` is in Asia/Kolkata.

## 8. Driver onboarding (phone app, pilot driver)

Unchanged in substance, and now for one driver.

1. Install Traccar Client and scan the QR from R21.
2. Set accuracy to High, frequency to 30 s, distance to 0 and angle to 30°. Turn offline buffering on, and wake lock on (Android).
3. Android:
   - Location access "Allow all the time", precise.
   - Battery set to "Unrestricted".
   - Xiaomi: Autostart on and "No restrictions". Oppo, Vivo and Realme: allow background activity and lock the app in Recents. Samsung: add to "Never sleeping apps".
   - Leave mobile data on. Never swipe the app away. The notification must stay visible.
4. iPhone: Location "Always" and Precise, Background App Refresh on, Low Power Mode off. Never force-quit the app.
5. Keep the phone on a charger and in a mount.
6. Start tracking at the start of duty and stop it at the end.
7. The in-charge confirms the bus shows **Live** before the bus leaves.

The pilot driver also **helps the in-charge with "Mark this stop" on the first verified drive of each trip** (R27/R30).

## 9. Privacy and data protection

- **Who sees bus locations:** admin-PIN holders only. This is enforced and logged (R14, R18). Parents see no map.
- **Student data:**
  - Transport holds admission numbers and stop assignments only, in Workspace.
  - Names and parent accounts stay in GCM's ROSTER and in the student master.
  - **Admission numbers never go to Cloudflare.**
  - The transport account having edit access to the GCM control sheet is itself an access decision (Q10b).
- **Stop coordinates are sensitive**, because a doorstep stop is effectively a home address. Transport_Stops is visible to admins only. D1 has stops without the student links.
- **Message content:** the safeguarding rules in §6.3(d) apply.
- **Known weak spot:** access uses a shared PIN. RFC-GPS-5 will add per-person sign-in before the fleet goes beyond the pilot.
- **Retention:**
  - Raw pings: 90 days.
  - Summaries: long-term.
  - `rejects`: 30 days.
  - Events and outbox: 90 days.
  - `Parent_Notify_Log`: 1 year (Q14). GCM keeps its own log under its own archiving.
- **AIS-140 data in Phase 2:** the government feed must continue unchanged. The school's copy is subject to the same retention and access rules.
- **Drivers:** tracking happens on duty only, under a consent note (Q6).
- **Parents:** before live, a parent notice in English, Tamil and Tanglish explains what is sent and how to opt out.

## 10. Failure modes

Unchanged from Revision 2, plus the rows below.

| Failure | What users see | Detection and response |
|---|---|---|
| A sweep is delayed, or a whole-school send holds the lock | A bus message arrives late | The watchdog alerts on any READY row older than 15 minutes (R39). Stop-level events stay non-live until T25 adds expiry |
| An event falls outside `SEND_WINDOW` (before 07:00 or after 19:00) | Delivered the next morning, which is wrong | Transport does not queue school events outside `SEND_WINDOW`, and logs them as `suppressed: outside_gcm_window`, until a per-project window exists |
| A student is not on ROSTER | No message | Shown as "Not reachable by GCM". GCM's own skip reason is reconciled nightly |
| Day-2 message identical to day 1 | GCM skips it as a duplicate | `{{Date}}` and `{{Time}}` in every template make each body different. Tested |
| GCM project is PAUSED | Rows held | Shown in the shadow view. The watchdog counts held rows |
| Stop not verified | No events for that stop | Listed in setup validation |
| Phase 2: reconfiguring the AIS-140 unit breaks VLTD reporting | Compliance risk | A single bus is changed first and VLTD is checked before any other. Configuration is rolled back by SMS command if needed |
| Phase 2: the vendor's SIM is cut after the subscription ends | That bus goes Stale | Settle SIM ownership before cancelling anything (Q1d) |
| Phase 2: the Traccar VM goes down | All hardwired buses go Stale | Ops alert from Stale on several buses at once, plus a VM health check in `/v1/health` |

## 11. Pilot plan and success criteria (one bus)

**Shape:** **One bus, one route, one driver** (Q3), running the morning pickup and its drop session for about 4 weeks of school days.
- Week 1: shakedown, plus **driving the route to verify every stop**.
- Weeks 1–2: `shadow_local`.
- Weeks 3–4: `shadow_gcm`.

Weak-signal areas are not known in advance. They are **found and recorded as the pilot runs** from GPS_Daily gaps, and each dead zone is listed by stop segment.

One bus, one driver and one phone is a small sample. The results prove the **pipeline and the method**, not phone tracking across the fleet. That is acceptable, because Phase 2 does not depend on phones.

### Tracking

| Measure | Pass |
|---|---|
| Coverage (`covered_minutes / window_minutes`) | At least 95 % overall. Every dead zone found is listed, with backfill bringing coverage to at least 98 % |
| Latency | Median 30 s or less, p95 90 s or less |
| Accuracy (at 3 surveyed points on 3 days) | Median 20 m or less, p95 50 m or less |
| Battery | No run lost to battery while on the charger. Drain 10 %/h or less off the charger (one deliberate test) |
| Switch-off detection (4 induced tests: app stopped, phone off, airplane mode, revoked permission) | 4 out of 4 alerted within `gps_stale_minutes` + 5 |
| False Stale alerts | No more than 1 per week by week 4 |
| Silent failures | 0 |
| Usage | In-charge uses it on at least 80 % of school days |
| Cost and standards | ₹0. Under 25 % of every free-tier limit. No raw pings in Sheets. No secrets in any file |

### Shadow notifications

Ground truth comes from the in-charge or attendant recording actual stop times on **at least 8 trip runs**.

| Measure | Pass |
|---|---|
| Approaching, by event time: bus arrives 3–8 minutes after the event | 85 % or more, and never less than 1 minute |
| Previous-stop correctness | 98 % or more |
| School events correct, no duplicates | 98 % or more, 0 duplicates |
| Events missed while the bus was Live | 5 % or fewer |
| Events from stale or late data | **0** |
| Duplicates per student, trip and type | **0** |
| **GCM latency in `shadow_gcm`** (queued to logged SENT) | Recorded honestly. **Pass for school events:** p95 of 12 minutes or less inside `SEND_WINDOW`. Stop-level events are expected to **fail** this without T25, and the measured figure is the evidence for the GCM RFC |
| ROSTER reachability of the pilot trip's students | 100 % reachable, or each gap explained |

### Phase 2 go/no-go

Go when all of these are true:
1. The tracking pass lines held through weeks 2–4.
2. R6 passes, including an AIS-140-protocol fixture if the make is known.
3. **Option A feasibility is settled:** make and model, Traccar protocol support, whether the vendor allows a secondary server or provides an API, written confirmation that VLTD is unaffected, SIM ownership, and the contract terms.
4. Q1 on the RTO is answered or found not to matter.
5. Leadership confirms they rely on it.
6. The budget is approved.

If Option A is blocked, Option B (FMB920) goes to approval instead.

**Parent go-live is a separate decision** (§6.4). It does not have to wait for Phase 2, but stop-level events wait for T25.

## 12. Cost estimate (indicative; confirm with quotes)

| Item | Phase 1 (1 bus, 4 weeks) | Phase 2 Option A: reuse AIS-140 (lead) | Phase 2 Option B: FMB920 (fallback, per bus) |
|---|---|---|---|
| Cloudflare Worker + D1 (Dan's account) | ₹0 | ₹0 up to about 50 buses. About ₹450 a month if over the free tier | Same |
| GAS, OSM, Leaflet, GCM | ₹0 | ₹0 | ₹0 |
| Phone | ₹0 with the driver's own phone, otherwise about ₹7,000–9,000 | Not needed | Not needed |
| Data | About ₹0–300 | Existing SIM if the school owns it. If the SIM is the vendor's, an own M2M SIM at about ₹100–250 a month per bus plus the cost of fitting it (Q1d) | M2M SIM, about ₹100–250 a month |
| Charger and mount | About ₹500–800 | Not needed | Not needed |
| Device | Not needed | **₹0** (already fitted) | About ₹3,500–6,000 |
| Vendor configuration | Not needed | Unknown. Possibly a charge for unlocking or configuring (Q1e) | Not needed |
| Installation | Not needed | ₹0, unless a SIM swap needs a technician | About ₹500–1,500 |
| Traccar VM | Not needed | About ₹500–1,200 a month for the whole fleet | Same |
| Manufacturer subscription | Unchanged | **Saved**, if the contract and compliance allow it (Q1e/f) | Unchanged |
| **Total** | **About ₹0–10,000** | **About ₹500–1,200 a month for the fleet, plus any SIM and vendor costs, offset by the subscription saved** | **About ₹5,000–8,000 per bus one-off, plus about ₹100–250 a month per bus, plus the VM** |

## 13. Risks and the estate rules that apply

- **NN12 (writes to Sheets):** raw pings stay in D1. Sheets get at most one GPS_Daily row per trip per day, and one batched fan-out per event. At fleet scale the bigger pressure is **GCM's** MESSAGE LOG and OUTBOX (about 6,000 rows a day). That is GCM's scaling question and is flagged in its RFC.
- **NN1 and NN6:**
  - Hashed per-device tokens, header secrets in the RELAY_SECRET style, and HMAC on `doPost`.
  - The admin-token check runs on every GAS GPS function.
  - **No secret is ever written to a file.** The EMIS relay's plaintext `SCRIPT-PROPERTIES.txt` shows exactly what to avoid.
- **NN7 and NN9:**
  - Three separate alert paths: buses, the Worker, and delivery.
  - Stopping is preferred over a wrong message.
  - "Data as of" is shown everywhere.
  - Stuck GCM rows are visible.
- **NN8:** idempotence at four layers: pings, stop events, the transport `dedupe_key`, and GCM's hash (made unique per day by `{{Date}}` and `{{Time}}`).
- **NN11:** UTC in D1, Asia/Kolkata elsewhere, `yyyy-MM-dd` in Sheets.
- **NN2:** the new tabs use header names. The existing `getRows_()` uses positions and is not changed here. **GCM headers are matched exactly**, emoji included, following the Calendar precedent. A mismatch fails silently.
- **NN5:** trips, stops, assignments, thresholds, modes, strings and the GCM project ID are all sheet data.
- **Parent-facing localisation (RFC-007):** this conflicts with GCM's English-only setting (§6.3f, Q15).
- **GCM's rules, which apply to transport as GCM's feeder:**
  - Never edit the library.
  - Never write GCM rows that transport does not own.
  - Templates are TEXT only.
  - Use TEST before LIVE for every new wording.
  - `Status=PAUSED` is the stop. `SEND_WINDOW` is not a stop.
- **Shipping §6 (every automated job has a manual twin):** "Check GPS now", "Pull GPS summary for a date", "Replay events for a trip (dry run)", "Reconcile GCM now", and Worker `/v1/admin/run-cron`.
- **New public `doPost`** on an anonymous app: needs security review.
- **New OAuth scope** `script.external_request`, plus access to the GCM control sheet: the deploying account must re-authorise.
- **clasp leakage:** `.claspignore` re-includes `*.js`. The `.mjs` files and R24 close this gap.
- **Deployment:** `clasp push`, `wrangler deploy` and every GCM sheet change are human steps.
- **The EMIS relay secret was exposed in a plaintext file** under `~/Public`. Rotating it is outside this PRD and is flagged to Dan.

## 14. RFCs required

| RFC | Where it lives | Why |
|---|---|---|
| RFC-GPS-1: GPS, trip and stop schema | transport | New tabs (§7.2), new Settings keys, the D1 schema, the canonical Ping, session-keyed trips |
| RFC-GPS-2: Triggers and jobs | transport | `gpsWatchdog` (new trigger), the nightly pull, ROSTER pre-check and GCM reconcile inside `rebuildAnalytics`, the Worker crons, the new `doPost` |
| RFC-GPS-3: Ops notifications | transport | New senders to Ops Alerts, and the email fallback |
| RFC-GPS-4: Shared infrastructure | transport | A second Worker in Dan's Cloudflare account, beside the EMIS relay. The shared Ops Alerts webhook. Non-GAS `.mjs` code in a project folder |
| RFC-GPS-6: Parent bus events feed GCM | transport **and** GCM (`Christwood-GC-mega-project/rfcs/`, mirroring RFC-010) | **Changes who is notified** (families) and **touches more than one project**. Covers: the `cw-bus-notify` project and its templates, transport's write access to the control sheet, the OUTBOX feed, shadow through a redirect space, **the first unattended family sends (an exception to GCM v1's "a person presses LIVE")**, safeguarding review, the language decision, reply routing, and the volume ceiling |
| RFC-GCM-lib: OUTBOX expiry, fast lane, per-project send window and reply routing | **estate (shared GCM core)** | A library change. Needs a `GCM_VERSION` bump, a CHANGELOG entry and a re-pin at every school. Required before stop-level events go live. Not transport's to implement |
| RFC-GPS-7: Reuse fitted AIS-140 devices (Phase 2) | transport | The secondary-server configuration, the Traccar VM, the VLTD safety procedure, and SIM and contract changes |
| RFC-GPS-5: Per-person sign-in | transport | Before the fleet goes beyond the pilot |

## 15. Suggested tickets

Worker tags follow the brief: Codex for code, Sonnet for security- or auth-sensitive work, cross-system integration with GCM, and Tamil, Haiku for documents. The dispatcher confirms them.

The scope is **one pilot bus**. The data model and the code are built for the whole fleet.

Gates:
- T1–T15 start after RFC-GPS-1 to RFC-GPS-4.
- T16–T22 also need RFC-GPS-6.
- T24 needs RFC-GPS-7 to be drafted.

| # | Ticket | Delivers | Tested by | Worker |
|---|---|---|---|---|
| T1 | Worker scaffold and D1 migration | `gps-worker/` as `.mjs` with `wrangler.toml` (Worker `christwood-transport-gps`, D1 ID `TODO(human)`), the idempotent migration (R8), the `.claspignore` exclusion (R24) | Migration run twice locally. `clasp status` checklist | Codex |
| T2 | Device tokens and Worker auth | Issue and revoke tokens, hash-only storage, constant-time comparison, header secrets, rate limit and size cap (R2, R5, R21) | Wrong, revoked and reissued tokens. Burst. Secret grep | Sonnet |
| T3 | OsmAnd adapter and canonical Ping | R1, R3, R4, R7 | Fixture replay, duplicate replay, reject reasons | Codex |
| T4 | Traccar forward adapter | R6. Adds an AIS-140-protocol fixture once the make is known | Equivalence of paired fixtures | Codex |
| T5 | Bus status and stale alerts | R10, R11 | Boundary tests, silence simulation, webhook-failure mock | Codex |
| T6 | Read API, health, rollup and purge | R9, plus the read endpoints | Rollup arithmetic, purge boundary, 401 without the secret | Codex |
| T7 | GAS setup for the new tabs | GPS_Devices, Transport_Trips, Transport_Stops, Trip_Stops, Student_Trip_Stops, Parent_Notify_Log, Notify_Strings, GPS_Daily, GPS_Access_Log and the Settings keys, with validation (R19, R26, R28, R29) | Two runs on a copy. Validation fixtures | Codex |
| T8 | Config push and token menu | R20, R21, Script Properties, manifest scope | Stubbed payload test, manual steps | Sonnet |
| T9 | GAS GPS endpoints and access log | R14, R17, R18 | Token gate. Cache hit. Log rows | Sonnet |
| T10 | Live buses view | R13, R15, R16, showing the session trip and next stop | 360 px checklist, Worker-down simulation | Codex |
| T11 | Watchdog and daily pull | R12 (including the stale GCM READY check) and R22, with menu twins | Stubbed health. A double run gives one row | Codex |
| T12 | Ops README and PROJECT.md | R23, R25. Notes the EMIS precedent and the separate Worker | A second person follows it | Haiku |
| T13 | Driver card and consent (English) | §8, §9 | The in-charge onboards the pilot driver | Haiku |
| T14 | Pilot measurement and decision memo | Weekly one-bus summary (tracking, shadow, GCM latency) and the §11 memo | One seeded week matches a hand calculation | Haiku |
| T15 | Stop import and capture tool | R27, R30: import of the school's named-location sheet (**blocked on Q12 headers**), "Mark this stop", map tap, dwell suggestions, the `verified_on` gate | Idempotent import. Marked-stop fields. Unverified stops skipped | Codex |
| T16 | Trip engine by session | R31, R32: run open and close per trip, segment crossing, school-exit hysteresis | Pass-through, gate jitter, skipped stop, two sessions on one bus | Codex |
| T17 | ETA, stop events and suppression | R33, R34 (Worker side), R36 | Geometry tests, a fixture per suppression reason, replay | Codex |
| T18 | Delivery from Worker to GAS | Outbox, HMAC-signed POST, retry, expiry, `doPost` verification (R34) | Bad signature, replayed timestamp, expired item | Sonnet |
| T19 | Fan-out, sent-flags and modes | R35, R37 | Triple replay. Payload assertions for each mode. Opt-out | Sonnet |
| T20 | GCM OUTBOX feed, ROSTER pre-check and reconcile | §6.2: appends OUTBOX rows under the exact GCM headers (Calendar precedent), the shadow-space redirect, the nightly ROSTER read, the nightly MESSAGE LOG and OUTBOX reconcile, the stuck-row alert (R39). Drafts the `cw-bus-notify` PROJECTS row and TEMPLATES rows **for the GCM maintainer to apply**. This ticket writes no GCM rows except OUTBOX | Fixture control sheet: exact header match, batch append, no edits to existing rows, mode assertions, reconcile mapping | Sonnet |
| T21 | Notification strings in en, ta and ta-Latn | R38, following the §6.3(d) wording rules. A bilingual-template variant for Q15. Tamil driver card and parent notice | Placeholder parity. Native-speaker and safeguarding review | Sonnet |
| T22 | Shadow review view | R40, plus the "Replay events for a trip" dry run | A seeded run shows correct ETA errors and correct GCM latencies | Codex |
| T23 | Ops README addendum for notifications | Switching modes, pausing the GCM project, the go-live checklist, fixing a stop, GCM contacts | A second person runs `shadow_local` → `shadow_gcm` → `off` | Haiku |
| T24 | AIS-140 reuse feasibility pack | Vendor question list (Q1a–f). Traccar protocol lookup once the make is known. A one-bus secondary-server SMS procedure with a VLTD check and rollback. Sizing for the Traccar VM | Reviewed by Dan before anyone contacts the vendor. No device is touched under this ticket | Haiku |
| T25 | *(Estate work, not this repo)* GCM library proposal | A draft RFC-GCM-lib: OUTBOX `Expires At`, a fast lane, a per-project `SEND_WINDOW`, per-project reply routing, fleet-scale ceiling and `LOG_SCAN_ROWS`. Uses the measured shadow latency as evidence | GCM maintainer review. Implemented in the core repository, if approved | Sonnet (draft only) |

## 16. Open questions

1. **AIS-140 (Phase 2 lead option).**
   - a. What are the **make and model** of the fitted devices, and their firmware or protocol? Is that protocol on Traccar's supported list?
   - b. Does the vendor **allow a secondary server IP and port** (by SMS or a vendor tool)? Or does it offer **API or webhook** access instead? Is the configuration locked or password-protected?
   - c. How will we confirm the **government VLTD feed is not disturbed**? Which slot carries VLTD, and who checks the state dashboard after the one-bus change?
   - d. **Who owns the SIM and the data plan** in each device? What happens to data if the manufacturer subscription is cancelled?
   - e. What do the **contract terms** say: lock-in period, cancellation, warranty or support if the device is reconfigured, any unlock charge?
   - f. Does the RTO require AIS-140? The school is unsure. Does cancelling the manufacturer subscription affect compliance services the school must keep, such as the emergency button or state backend fees?
2. **Parents in Phase 1?** This PRD assumes leadership-only map access and parent messages in shadow only. Is that agreed?
3. **Which bus, route and driver** is the one pilot bus? Which sessions does it run (morning pickup plus afternoon or evening drop), and what are the real windows?
4. The Cloudflare account is **Dan's** (answered). Remaining: confirm a **separate Worker** in that account (recommended). Confirm that Dan runs `wrangler deploy`. Confirm that the exposed EMIS relay secret will be rotated.
5. Will the pilot driver use their own phone, or a school phone with a school SIM?
6. Who signs off the driver consent note and the parent notice?
7. Does the driver card need Tamil? (T21 assumes yes.)
8. What is in `Vehicle_Master.gps_device_id` today? Can it become a read-only mirror?
9. Who is the named contact for GPS alerts, and who is in the **shadow space**? Should Stale alerts also go to the in-charge directly?
10. **GCM** (partly answered by the review: intake is the 📤 OUTBOX of a new `cw-bus-notify` project; templates are 📝 TEMPLATES rows; maintainer `dan@`, owner `automations@`; English only). Still open:
    - a. Will the GCM owner approve the **first unattended family sends** (the exception to "every v1 send is a person pressing LIVE")?
    - b. May the transport web app's executing account have **edit access to the GCM control sheet**? That access also exposes 📥 REPLIES.
    - c. Will the estate take on **RFC-GCM-lib** (expiry, fast lane, per-project window, reply routing)? Until it ships, only the school events can go live.
    - d. Who should receive **replies to bus messages**: the class teacher by default, or the transport in-charge?
    - e. GCM's named `{CONTACT}`. It is still unnamed in GCM's own CLAUDE.md.
11. Is keeping raw pings for 90 days acceptable?
12. **The school's stop sheet.** What is its name, where is it, and who owns it? Please provide a **CSV export with its real headers**: they could not be found in `projects/transport`, so the import is unspecified. Should transport's tabs become the master copy after a one-time import, or should the school's sheet stay the master and be re-imported? Who updates a student's stop when it changes? Are the stops shared roadside stops or doorstep stops?
13. Should absent students be left out? (Transport has no student attendance.) Should `bus_reached_school` go to a student whose stop was never crossed?
14. How long should `Parent_Notify_Log` be kept? (Proposed: 1 year.)
15. **Language for bus messages through GCM:** English only (an exception to the estate rule), one bilingual message (recommended), or a per-family preference (a library change)?
16. Do any pickups start before **07:00**, or any evening drops end after **19:00**? GCM's `SEND_WINDOW` holds those messages. That would make a per-project window (RFC-GCM-lib) a precondition for those trips.

## 17. Changes in Revision 3

- **AIS-140 (answer 1):** the lead Phase 2 option is now reusing the fitted AIS-140 device: a secondary server slot sends TCP to a Traccar VM, which forwards to the same R6 adapter. Buying an FMB920 is the fallback. Added the VLTD-must-not-be-disturbed constraint, the Option A failure modes, an Option A cost column, RFC-GPS-7, T24, and the expanded Q1a–f.
- **One-bus pilot (answer 2):** §1, G1, pilot volumes, the §11 criteria (rescaled, with a sample-size caveat, dead zones discovered as the pilot runs, 4 switch-off tests, at least 8 trip runs for shadow), and the ticket scope note. The design stays ready for the whole fleet.
- **Cloudflare (answer 3):** Dan's account. Follows the EMIS relay precedent (`.mjs`, `wrangler.toml`, header secret in the RELAY_SECRET style) as a **separate Worker**, `christwood-transport-gps` (§3.2). Records three deliberate departures, including the **plaintext relay secret in `SCRIPT-PROPERTIES.txt`**. Updated R23, R24, T1 and Q4.
- **GCM (answer 4):** the placeholder contract is replaced by a concrete design: a new GCM project `cw-bus-notify`, fed through 📤 OUTBOX on the Calendar precedent, with a ROSTER pre-check and a nightly reconcile (§6.1–6.2). Added honest sections on latency (about 5 minutes typical, about 11 minutes worst case, nothing outside 07:00–19:00, no expiry), the first unattended sends, no edits to the library (RFC-GCM-lib / T25), safeguarding wording rules, strict ROSTER, and English-only versus en/ta/ta-Latn. Shadow is now `shadow_local` followed by `shadow_gcm` through a `spaces/` redirect. Found the **GCM hash-dedupe trap** (an identical body is skipped within 2 days), fixed by putting `{{Date}}` and `{{Time}}` in every template. Updated R37–R40, RFC-GPS-6, T20, T25 and Q10, and added Q15 and Q16.
- **Stops (answer 5):** trips are keyed by session (morning pickup, afternoon drop, evening drop), each with its own route number (R26). Stops are named places, geocoded once and **verified by driving** (R27). Stop sequences are per trip (R28). Each student has a stop per session (R29). Added an import and capture tool (R30). Confirmed that **transport holds no stop or student data today** (§7.1). The school sheet's headers are unknown and remain open (Q12, T15 blocked).
- **Unchanged:** the D1 recommendation, the ingest contract, tracking requirements R1–R25 apart from the edits named above, the dashboard, driver onboarding, and the status vocabulary.
