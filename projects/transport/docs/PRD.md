# PRD: Live Bus GPS Tracking and Parent Bus Notifications

**Project:** `transport` (Christwood Transport Management System)
**Status:** Draft for decision · **Date:** 2026-11-10 · **Revision:** 4 (restructured around stages and gates after the review of 2026-11-10; the changes are listed in §17)
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

**Revision 4 was written from the Revision 3 text only.** The repo, the standards files and the GCM library were not re-read for it. Where a Revision 4 change depends on how that code behaves, the text says "confirm" and names the ticket that confirms it.

**Numbering.** Requirements R41–R43 and tickets T26–T27 are new in Revision 4. No existing number has changed, so earlier references still match.

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
| Parents | Phone. Google Chat DMs on their child's Workspace account (parent-managed), sent by **GCM** from `askus@` | 1 message per child per session at first, up to 3 after Gate L | First the two school events: the bus reached school or left school. Messages that the bus is approaching or at the previous stop come only after Gate L (§2). **Shadow mode only in Phase 1** (§6) |

Staff who see GPS data sign in with their own school Workspace account (R41). The shared admin PIN does not unlock it.

**What Phase 1 solves, and what it does not.** It solves the office's problem: the in-charge can see the bus and answer a parent's call without phoning the driver. It does not yet solve the parent's problem at the stop. A message that says the bus is about 5 minutes away needs a delivery path of a minute or two, and GCM as it stands takes about 6 to 12 minutes (§6.3a). That path is a separate, gated piece of work (Gate L, §2).

## 2. Goals and non-goals

### Goals

- **G0.** Before any code, record the business case: the subscription fee paid today, the questions sent to the vendor about reusing the fitted devices, and which case leadership relies on (Gate 0, §2 and §12.1).
- **G1.** Build the complete pipeline on free tiers and prove it on **one bus, one route, one driver** for at least 4 weeks. The pipeline covers the device, ingest, storage, dashboard, alerts and the daily summary. The design must work for the whole fleet without being reworked.
- **G2.** Give the transport in-charge a live map that works on a phone and is honest about its state. Each bus shows as Live, Pending, Stale or Error, with "Data as of HH:MM".
- **G3.** Detect a bus that goes silent during a run and announce it in Ops Alerts within minutes.
- **G4.** Generate parent bus events per session, measure all four types in shadow, and feed the **two school events** into **GCM**. Stop-level events are delivered only after Gate L. Transport must not build its own way of sending Chat messages. It must never send a message that the data cannot support.
- **G5.** Measure accuracy, dropout, latency, battery use, switch-off behaviour, whether events were correct, and **GCM's end-to-end latency**. The pipeline numbers drive the Phase 2 decision. The phone-only numbers are reported but do not gate it (§11). The event and GCM numbers drive the parent go-live decision and Gate L.
- **G6.** Make Phase 2 a swap at the ingest layer only. **Reusing the AIS-140 device already fitted** is the lead option. Buying an FMB920 is the fallback.
- **G7.** Keep the blast radius small. GPS, stop and student data sit behind per-person sign-in (R41). The account that runs the anonymous web app has no access to GCM (R42).

### Non-goals (Phase 1)

- Messages to parents going live. Phase 1 is shadow only.
- **Delivering stop-level messages** (approaching, previous stop) by any channel. They are measured in `shadow_local` only. Delivery waits for Gate L, and nothing is built that only stop-level delivery would use.
- A live map for parents.
- Any Chat sending inside transport. GCM delivers every message.
- **Editing the shared GCM library from this repo.** Any library change is separate estate work (§6.3c).
- Anything that disturbs the **government VLTD feed** from the fitted AIS-140 devices. This is a hard constraint, not just out of scope.
- Route optimisation, route-deviation alerts, or ETAs more precise than "about N minutes".
- Replacing Trip_Log or the odometer workflow.
- Paid map, geocoding or routing APIs.

### Stages and gates

Work runs in stages. A stage starts only when its gate has passed. If a gate is late, the pilot runs longer. A gate is never skipped. One named person records each gate as passed, with the date, in `PROJECT.md`. The names in the last column are proposals (Q9).

| Stage | What happens | Gate to enter it | Records the gate |
|---|---|---|---|
| **0. Business case** | No code. The vendor question pack and the fee paid today (T24), the break-even table (§12.1) | None | Project owner |
| **1. Tracking pilot** | One bus on a phone. Live map, status, alerts, daily summary (T1–T14, T26) | **Gate 0**, plus RFC-GPS-1 to RFC-GPS-5, plus Q3, Q5, Q9 and Q20 answered | Project owner |
| **2. Stops and events in `shadow_local`** | Stop import, the verification drive, the trip engine. All four event types are generated and measured. Nothing leaves transport (T15–T19, T22) | **Gate 2**: per-person sign-in live (R41), the security review signed (T27), the stop sheet supplied (Q12) | Dan |
| **3. School events through GCM** | `shadow_gcm`, then live to five families (T20, T21, T23) | **Gate 3a** for shadow and **Gate 3b** for live (§6.4) | GCM owner |
| **4. Stop-level delivery** | Approaching and previous-stop messages | **Gate L** (§6.3c). It may never pass, in which case this stage leaves the PRD | GCM owner |
| **Phase 2. Hardware** | One fitted bus first, then the fleet | The Phase 2 go/no-go (§11) | Leadership |

**Gate 0** passes when all of these are true:
1. The fee the school pays the manufacturer today is written into §12.1, per bus per month, with the number of buses and the contract end date, taken from an invoice (Q18).
2. Q1a–f have gone to the vendor in writing, and Q1f has also gone to the RTO or the state transport department. The answers do not have to be back.
3. Leadership has recorded which case it relies on (Q19):
   - **Saving.** The project is justified only if it ends the subscription. The build then waits until Q1d–f are answered and the break-even table shows a saving.
   - **Control.** The project is justified by the live view and by owning the data, even if the subscription has to stay. The build may start while the vendor's answers are pending, and leadership accepts the monthly cost in §12 as an addition.

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
1. Device tokens travel in the URL path. Traccar Client cannot set headers. The Worker therefore never logs a request path (R2).
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
  │     └─ rows wait here for the feeder
  │          this script and its account have no access to GCM (R42)
  │          mode shadow_local: rows stay local_only and the feeder ignores them
  ├─ Live buses view (per-person Workspace sign-in, R41): Leaflet + OSM
  ├─ nightly (inside rebuildAnalytics): GPS_Daily, shadow rollup
  └─ gpsWatchdog every 15 min in service windows --> Ops Alerts
Transport GCM feeder (separate GAS project, separate account, no web entry point: R42)
  ├─ every minute in service windows: due Parent_Notify_Log rows --> feed guard (R43)
  │     --> appends rows to GCM 📤 OUTBOX for project "cw-bus-notify" (Calendar precedent: by ID)
  │          shadow_gcm: Recipient = shadow space | live: Recipient = Admission No
  │     --> copies GCM's status back into Parent_Notify_Log, writes a heartbeat
  └─ nightly: ROSTER pre-check, reconcile with the GCM 📨 MESSAGE LOG
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
- **R2.** Each device gets its own random token of at least 128 bits. D1 stores only its SHA-256 hash, and comparison is constant-time. The token never appears in source, a Sheet or any file; only `token_last4` is shown. Because the token is in the URL path, the Worker never logs a path or a full URL, and its error messages carry `device_id` only. Every token is reissued at the end of the pilot. *Test:* a wrong token returns 401 and writes nothing, a grep of the repo and the Sheet finds no token, and a log capture of 20 requests contains no token.
- **R3.** Inserts are idempotent: `(device_id, fix_ts)` is the primary key and inserts use `INSERT OR IGNORE`. *Test:* sending the same 50 pings twice leaves 50 rows.
- **R4.** A malformed ping that passed authentication still gets **HTTP 200**, and is written to `rejects` with a reason. Any other status makes Traccar Client retry that ping forever. *Test:* each reject reason returns 200 and adds one `rejects` row.
- **R5.** Limits are set so that they never drop a backfill. Traccar Client buffers pings in a dead zone and sends them in a burst when the signal returns (§8), and §11 counts that backfill towards coverage.
  - **Spacing is judged on `fix_ts`, not on arrival time.** A ping whose `fix_ts` is within 5 s of a fix already stored for that device is acknowledged with 200, dropped and counted.
  - **Arrival rate uses a token bucket per device.** Its capacity is `gps_backfill_bucket` (default 400, which is about 3 hours of buffered pings at 30 s), and it refills at 1 per second. A ping over the bucket gets **429**, so the client keeps it and sends it again later. This is the one case where a non-200 answer is wanted (compare R4). Confirm the client's retry behaviour in T3.
  - Each body may be at most 4 KB.
  - A backfilled ping is stored and marked `late`. It counts for the track and for coverage. It never changes the Live status (R10) and never fires an event (R36).

  *Test:* 20 buffered pings with fixes 30 s apart, arriving within 10 s, store 20 rows, all `late`. 20 pings with fixes inside 10 s store at most 3. A flood of 1,000 valid pings in 10 s stores no more than about 410 and answers 429 to the rest.
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
  - The Worker outbox holds items older than 15 minutes.
  - `Parent_Notify_Log` holds rows still `pending_feed` or `queued_gcm` after 15 minutes. The feeder copies GCM's status into that log on every run (R42), so the watchdog itself never opens the GCM control sheet.
  - The feeder's heartbeat is more than 5 minutes old inside a service window, or the feed guard has tripped (R43).

  If Chat fails, the alert goes by email to `alert_email`. The manual twin is the menu item "Check GPS now". *Test:* a stubbed stale health response produces exactly one alert per episode.
- **R13.** Every GPS view shows "Data as of HH:MM" in Asia/Kolkata, taken from the server's newest `recv_ts`. If the Worker is down, the view shows the cached data under a red banner and is never blank. *Test:* with the Worker stubbed down, the cached buses, the banner and the original time are shown.

### Dashboard

- **R14.** "Live buses" is a view for named staff only. Every server function behind it (`getGpsLive`, `getGpsTrack`, `getGpsDaily`, `getNotifyLog`, and every stop, assignment, token and config function) resolves the caller's identity on the server under R41 and checks the role it needs. The existing app is deployed `ANYONE_ANONYMOUS`, so anyone can call any of its server functions. The check is therefore on **who is signed in**. It is never on which page made the call, and never on the admin PIN. *Test:* each function returns `{ok:false}`, with no coordinates and no student data, in four cases: an anonymous call, a valid admin PIN token with no sign-in, a signed-in address that is not on `GPS_Access`, and an address marked inactive.
- **R15.** The map uses Leaflet and OSM tiles, with no API key. The list underneath shows each bus's status and icon, last seen, speed, battery, the current session trip and the next stop with an approximate ETA. It works at 360 px with tap targets of at least 44 px, refreshes every 30 s, pauses when the page is hidden, and has a manual Refresh. *Test:* at 360 px there is no horizontal scroll and the list is ordered Error, Stale, Pending, Live.
- **R16.** "Today's track" draws the path, with gaps longer than 2 minutes dashed and the stop geofences drawn. *Test:* a 6-minute gap shows as one dashed segment.
- **R17.** The server caches `/v1/latest` for 20 s. *Test:* 5 loads within 20 s make one Worker request.
- **R18.** Every GPS view and every view of the notification log is recorded in `GPS_Access_Log` with the signed-in address (R41). *Test:* opening the map and then a track adds 2 rows, each with the viewer's address.
- **R41. Per-person sign-in, from the first day of the pilot.** GPS positions, tracks, stops, student assignments and the notification log are readable only by a person who is signed in with their own school Workspace account and whose address is on the `GPS_Access` tab (§7.2).
  - There are two roles. `view` covers the map, tracks, daily summary and shadow view. `manage` also covers stops, assignments, tokens, the config push and the mode switch.
  - The shared admin PIN stays for the app's existing functions. It unlocks nothing listed here.
  - **Proposed mechanism**, to be confirmed by a spike in T26 and fixed in RFC-GPS-5: a second deployment of the same script, restricted to the school domain and executing as the deploying account, in which `Session.getActiveUser().getEmail()` returns the viewer's address. In the anonymous deployment that call returns an empty string, which is treated as "not signed in".
  - If the spike shows the address is not available that way, the fallback is a separate domain-restricted GAS project for the GPS views. Falling back to the PIN is not allowed.
  - Removing a person is one edit: set `active` to No. It takes effect within 60 s.

  *Test:* the four R14 cases. A `view` user calling a `manage` function gets `{ok:false}`. Deactivating a user blocks their next call within 60 s.

### Config and the Sheet layer

- **R19.** `setupWorkbook()` adds the tabs and Settings described in §7 idempotently, including headers, validation and status formatting. The new tabs are read **by header name**. *Test:* running it twice on a copy leaves existing data unchanged.
- **R20.** GPS_Devices, Transport_Trips, Transport_Stops, Trip_Stops and the GPS Settings are pushed to `/v1/admin/config`. The push is signed with the config-secret header and carries a content hash. *Test:* changing a stop radius takes effect on the next ping, and an unchanged push records no new version.
- **R21.** Issuing or reissuing a token shows it once, as a QR code and URL. Reissuing revokes the old token. *Test:* after a reissue the old token gets 401.
- **R22.** The nightly `gpsDailyPull` runs inside `rebuildAnalytics` and upserts GPS_Daily on `day_key`. The manual twin is "Pull GPS summary for a date". *Test:* running it twice leaves one row.

### Ops

- **R23.** Secrets live only in three places:
  - **Worker secrets:** `OPS_ALERTS_WEBHOOK`, `READ_SECRET`, `CONFIG_SECRET`, `GAS_EVENT_HMAC_KEY`.
  - **Transport Script Properties:** `GPS_WORKER_URL`, `GPS_READ_SECRET`, `GPS_CONFIG_SECRET`, `GPS_EVENT_HMAC_KEY`, `OPS_ALERTS_WEBHOOK`.
  - **Feeder Script Properties** (the separate project of R42): `TRANSPORT_WORKBOOK_ID`, `GCM_CONTROL_SHEET_ID`, `GCM_SHADOW_SPACE`, `OPS_ALERTS_WEBHOOK`, `FEED_LIVE_ALLOWED`.

  The transport script holds **no** GCM identifier. The control sheet ID is an identifier, not a secret, but it is kept out of source in the same way the Calendar precedent does. **No `SCRIPT-PROPERTIES.txt` holding values may exist, unlike the relay precedent.** *Test:* grepping the repo for each value finds nothing.
- **R24.** The Worker lives at `projects/transport/gps-worker/` and is written only as `.mjs` files, following the EMIS precedent. `.claspignore` also explicitly excludes `gps-worker/**` and `docs/**`. *Test:* `clasp status`, run by a human, lists nothing under `gps-worker/`.
- **R25.** The ops README covers:
  - the Worker URL and the account owner (Dan)
  - where each secret lives, and the crons
  - how to reissue a token and how to pause a bus
  - how to add and remove a person on `GPS_Access`
  - the notification mode switch
  - the feeder project: its account, its trigger, `FEED_LIVE_ALLOWED`, and how to reset a tripped feed guard
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

The four types fall into two **tracks**:
- **Track S, school events** (`bus_reached_school`, `bus_left_school`). They tolerate a delay of several minutes, so GCM can deliver them as it is today. They are built end to end.
- **Track L, stop-level events** (`bus_approaching`, `bus_at_previous_stop`). They are generated, logged and measured in `shadow_local`. That costs nothing extra, because the dashboard's next-stop ETA (R15) already needs the same engine. They get **no GCM rows, no GCM templates and no parent wording review** until Gate L passes (§6.3c).

- **R34. Events are recorded per stop, in the Worker.**
  - Each event is stored once, keyed by `event_key = trip_run_id|stop_id|event_type` (`INSERT OR IGNORE`), with an `expires_at`:
    - approaching: 8 minutes
    - previous stop: 5 minutes
    - school events: 20 minutes
  - Events go to transport's `doPost` as batches signed with HMAC-SHA256 over body and timestamp. A timestamp more than 5 minutes old is rejected.
  - The cron retries until `expires_at`, then marks the event `expired`.

  *Test:* the same crossing produces one row, a bad signature gets 401, and an expired item is never delivered.
- **R35. Fan-out and sent-flags in transport.** `doPost` expands each stop event against `Student_Trip_Stops` into `Parent_Notify_Log`, keyed by `dedupe_key = trip_run_id|admission_no|event_type`. Rows that already exist are skipped. A new row starts as `local_only` in `shadow_local`. In `shadow_gcm` or `live` it starts as `pending_feed` if its event type is enabled, and as `local_only` if not. Each batch is written with one `setValues` under `LockService`. *Test:* replaying a batch 3 times changes nothing, and `notify = No` produces no row.
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
  - Two 📝 TEMPLATES rows at first: `cw-bus-reached-school` and `cw-bus-left-school`. The two stop-level templates, `cw-bus-approaching` and `cw-bus-previous-stop`, are added only after Gate L. All are TEXT. Their placeholders are `{{Bus}}`, `{{Session}}`, `{{Time}}` and `{{Date}}`, plus `{{ETA}}` and `{{Previous Stop}}` for the stop-level pair, and the optional `{{Shadow Ref?}}` on its own last line (§6.4). The child's name, if used at all, goes as `{{Student Name?}}` on its own line, following the `cw-student-dm` convention.
  - A 🚀 DEPLOYMENTS entry is not needed, because there is no shim. Transport writes to OUTBOX directly.
- **Transport side: a separate feeder (T20, R42, R43):**
  - The transport web app only writes `Parent_Notify_Log`. A separate **feeder** project, run by a different account and with no web entry point, does everything that touches GCM (§6.5).
  - For each `Parent_Notify_Log` row that is due and passes the feed guard, the feeder appends one OUTBOX row: `Project ID = cw-bus-notify`, `Recipient = admission_no` (or the shadow space, see §6.4), `Template ID` for the event type, `Values (JSON)` holding the placeholder values, `Send After` blank and `Status = READY`.
  - All rows from one event are appended in a single batch under the feeder's lock. The feeder never edits an OUTBOX row after appending it. The sweeper reads and writes back a fixed region, so editing an existing row would race with it.
  - The **feeder's account** needs edit access to the control sheet, which also lets it read 📥 REPLIES. That is an access decision for the GCM owner (Q10b). The account that executes the anonymous web app (it runs as `USER_DEPLOYING`) must have **no** access to the control sheet (R42, Q17).
- **Roster pre-check.** The feeder reads 🎓 ROSTER read-only, by ID, every night. A student who is not on ROSTER is shown as **"Not reachable by GCM"** in transport's view and gets no OUTBOX row, so a `Student_Trip_Stops` row cannot silently be a dead end.
- **Reconciliation.** On every run the feeder copies back the status of the rows it queued. Every night it also reads all of this project's rows from 📨 MESSAGE LOG and OUTBOX. It copies GCM's `SENT`, `SKIPPED` and `FAILED` status and the time sent into `Parent_Notify_Log`. That gives the true delivery latency for each message.
- **GCM's hash dedupe.** GCM skips an identical body to the same student within 2 days. "Bus reached school" would therefore be **silently skipped on day 2**. Every template must include `{{Date}}` and `{{Time}}` so the body differs. Transport's `dedupe_key` stays the authority. GCM's hash is a second safety net. **The same hash breaks `shadow_gcm` unless it is handled.** In shadow, every row of one event has the same recipient (the shadow space) and the same body, so GCM would send one and skip the rest as duplicates. Each shadow row therefore carries a unique `{{Shadow Ref?}}` line (§6.4, R37).
- **Volume.** With school events only, one bus with about 40 students sends at most about 80 messages a day (1 event type per session, 2 sessions), and a 25-bus fleet about 2,000. That is under `DAILY_SEND_CEILING` 2500 by itself, but not once the school's other sends are added. With stop-level events as well, one bus sends about 240 a day (3 event types per session) and a 25-bus fleet about 6,000, which is **above `DAILY_SEND_CEILING` 2500** and breaks GCM's `LOG_SCAN_ROWS > ceiling × DEDUPE_WINDOW_DAYS` invariant (6000 > 5000 today). Going fleet-wide needs those settings raised, and the MESSAGE LOG growth reviewed, as GCM work.

### 6.3 The hard problems, stated honestly

**(a) Real-time latency.** These figures come from the code and are not yet measured.

| Step | Time |
|---|---|
| Wait for the feeder's next run (R42) | 0–1 minute |
| Wait for the next sweeper tick | 0–10 minutes (installed `everyMinutes(10)`, plus Apps Script trigger jitter) |
| Lock wait | Up to 30 s, otherwise the sweep is held to the **next** tick (`tryLock(30000)`, then "another send in progress") |
| Send | About 1 s per message (`PAUSE_MS` 600 plus about 0.4 s for the API call) |

- **Typical end-to-end: about 6 minutes. Worst case on a quiet day: about 12 minutes.** Both figures include the feeder's wait. While a whole-school send is running (about 2 hours), sweeps compete for the lock and the delay has no reliable upper bound.
- **Outside `SEND_WINDOW` 07:00–19:00, nothing is sent at all.** Morning pickups before 07:00 and evening drops after 19:00 would be held. The next morning they would be delivered stale, because **OUTBOX rows have no expiry**.

Consequences:
- `bus_approaching` ("about 5 minutes") and `bus_at_previous_stop` are **not deliverable through GCM as it is today**. They would usually arrive after the bus.
- `bus_reached_school` and `bus_left_school` can tolerate a delay of 5–10 minutes, but only inside the window.

GCM would need these changes before stop-level events can go live:
1. An **`Expires At`** value on OUTBOX rows, honoured by the sweeper, which marks the row `EXPIRED` instead of sending it.
2. A **fast lane**. Either a library entry point such as `sendNow(projectId, items)` that applies ROSTER, SUPPRESSION, dedupe, ceiling, PAUSED and logging and sends at once, or a per-project sweep every minute. Either must reach a p95 of 2 minutes or less from queue to sent (Gate L).
3. A **per-project send window**, for example 06:00–20:00 for `cw-bus-notify`, without widening the window for everything else.
4. **Per-project reply routing**, so that replies to bus messages go to the transport in-charge instead of the class teacher.

Calling a library entry point from transport would mean transport including the GCM library. The GCM owner must decide on that access, because Christwood's rule D3/D4 is that only the maintainer and the owner may open the library.

**(b) The unattended path has never run in production.** Transport would be the first project to send to families without a person pressing LIVE. That is a **gate at RFC level, in GCM's own process**. The GCM owner must approve an exception to "every v1 send is a person pressing LIVE", with a fallback and a stop: `Status=PAUSED` stops the project and holds its queued rows. Following the playbook, the first live sends go to **five families, not a whole route**.

**(c) The shared library is not edited from here.** Every change in (a) is **separate estate work**. It needs a GCM RFC, a `GCM_VERSION` bump, a CHANGELOG entry, a published version and a re-pin at every school. Transport's tickets do not include it (see T25). Until it ships, transport can only go live with the two school events.

That makes stop-level delivery a dependency this project cannot deliver alone. Revision 4 therefore puts it behind **Gate L**, which passes only when all of these are true:
1. RFC-GCM-lib is approved with a **named implementer and a target date**, or a different real-time channel has been approved in its own PRD.
2. The fast path is measured in shadow at a **p95 of 2 minutes or less** from queue to sent.
3. The `shadow_local` results for approaching and previous-stop events meet §11.
4. The safeguarding lead has reviewed the stop-level wording, and Q16 is settled for the trips concerned.

**Decision date: the pilot decision memo (T14).** If condition 1 has not passed by then, stop-level delivery leaves this PRD. The memo records the measured evidence, and a separate PRD is opened if the school still wants the feature. Until Gate L passes, no ticket here builds anything that only stop-level delivery would use. That means no stop-level templates, no stop-level OUTBOX rows, and no parent wording review for them.

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

1. **`shadow_local`** (Stage 2, at least 2 weeks). All four event types are written only to `Parent_Notify_Log`. The in-charge reviews them in the shadow view (R40). Nothing touches GCM. This measures whether the events are correct.
2. **`shadow_gcm`** (Stage 3, at least 2 weeks, after Gate 3a). **School events only.** The same OUTBOX rows that live mode would write are appended by the feeder to the real `cw-bus-notify` project, with the same templates. **`Recipient` is replaced by the dedicated shadow space ID** (`spaces/…`, from Script Property `GCM_SHADOW_SPACE`). GCM resolves a literal `spaces/` recipient in any Recipient Mode (`05_Resolve.gs:19`), so the messages go to a staff space, **"Transport – bus messages (shadow)"**, which contains the in-charge and `askus@`, and reach no family.
   - This is **a redirect, not GCM's TEST space**. TEST is for checking wording, and Christwood keeps TEST and Ops Alerts separate (D8).
   - It exercises GCM's templates, sweeper, logging and pause, and it **measures GCM's real latency**.
   - In shadow, ROSTER fields such as `{{Student Name?}}` are empty, so they must be optional and sit on their own line.
   - Shadow traffic counts towards `DAILY_SEND_CEILING`. For one bus that is negligible.
   - **Every shadow row has a unique body.** GCM's dedupe hash covers project, recipient and body, and in shadow the recipient is the same for every row. Each row therefore carries `{{Shadow Ref?}}` on its own last line, filled with a counter and the event ID, for example `shadow 07/40 e-1042`. It holds no admission number. In `live` the value is blank. Confirm in T20, against `06_Template.gs` and `08_Outbox.gs`, that a blank optional line is dropped and that 40 rows for one event give 40 `SENT` and no `SKIPPED`.
   - The shadow space gets one post per student per event, which is about 80 a day for the pilot bus. Its members should mute its notifications.
   - **Gate 3a** (to start `shadow_gcm`) needs all of: RFC-GPS-6 approved, the `cw-bus-notify` rows applied by the GCM maintainer, the feeder isolation of R42 checked by a person, and the feed guard tests of R43 passing.
3. **`live`** (after **Gate 3b**, which is the list below). The recipient is the admission number. Live can be limited to chosen event types (`parent_notify_types`) and chosen trips (`parent_notify_trips`). Every condition below must hold:
   - The §11 shadow criteria are met.
   - The GCM RFC is approved, including (b) and (f).
   - The safeguarding lead has signed off (d).
   - The parent notice has gone out with an opt-out.
   - At least 2 weeks of `shadow_gcm` have run, and real traffic never tripped the feed guard.
   - The feeder's owner has set `FEED_LIVE_ALLOWED` to Yes (R42).
   - For the stop-level events, Gate L has passed (§6.3c).

   The sequence is the **school events first, to five families on the pilot trip**. Stop-level events follow only after Gate L, and may not follow at all.

- **R37. Modes.** In `shadow_local` no GCM row is written. In `shadow_gcm`, every OUTBOX row's `Recipient` starts with `spaces/` and none is an admission number, and no two rows have the same body. In `live`, rows go only for the enabled types and trips. `parent_notify_types` defaults to the two school events, and a stop-level type cannot be enabled while the Setting `gate_l_passed` is No. *Test:* in each mode, an assertion over the generated OUTBOX payloads checks this. 40 shadow rows for one event give 40 distinct GCM hashes. Enabling `bus_approaching` with `gate_l_passed = No` writes no OUTBOX row and logs the reason.
- **R38. Strings.** `Notify_Strings` has the columns `key`, `en`, `ta` and `ta-Latn`. It ships in the first commit. Every language has the same placeholders. The GCM templates are generated from it in whichever form Q15 decides, for the school events only until Gate L. *Test:* a placeholder-parity check, plus native-speaker review.
- **R39. Delivery state and failure.** Each `Parent_Notify_Log` row is in one of: `local_only`, `pending_feed`, `queued_gcm`, `sent`, `skipped` (with GCM's reason), `failed`, `expired`, `suppressed`. A GCM `FAILED` or `SKIPPED` raises **one Ops Alert per trip run**, not one per student. GCM's own sweep alerts for ERROR rows already exist. Any row still `pending_feed` or `queued_gcm` 15 minutes after it was created raises an alert through the watchdog (R12), because GCM cannot expire rows yet. The feeder never queues a row that is already past its `expires_at`. It marks that row `expired`. *Test:* a stubbed MESSAGE LOG with failures produces one alert, and reconciliation copies the statuses across.
- **R40. Shadow review view.** For each trip run, an admin list shows the events, their English text, how many targets, the mode, the status, any suppression reason, the ETA error (actual crossing minus prediction), and **GCM latency** (from GCM's log time minus queue time). *Test:* a seeded run shows correct ETA errors and correct latencies.

### 6.5 Feeder isolation and the feed guard

Revision 3 gave the web app's own account edit access to the GCM control sheet. That app is public, and the control sheet can message every family from `askus@` without a person pressing a button. Only convention would have kept transport to its own rows. Revision 4 separates the two.

- **R42. The feeder is isolated from the public app.**
  - The feeder is its own GAS project (`projects/transport-gcm-feeder/`) with **no `doGet` and no `doPost`**. It runs on time triggers under an account that is on GCM's access list. That account also has edit access to the transport workbook, so that it can write statuses back.
  - The account that executes the anonymous transport web app has **no access of any kind** to the GCM control sheet. If it has access today, that is an existing exposure, and it is removed before Gate 3a (Q17).
  - The feeder runs every minute inside service windows. Each run reads the `pending_feed` rows in `Parent_Notify_Log`, applies R43, appends to OUTBOX, copies GCM's status back for rows it queued earlier, and writes a heartbeat time.
  - The feeder writes to GCM only by appending OUTBOX rows for `cw-bus-notify`. It reads SETTINGS (for `SEND_WINDOW`), ROSTER, OUTBOX and MESSAGE LOG. It touches no other tab.
  - **Live sends need two switches held by two different accounts**: `parent_notify_mode = live` in the transport Settings, and `FEED_LIVE_ALLOWED = Yes` in the feeder's Script Properties. Editing the workbook alone cannot turn live sends on.
  - If the GCM maintainer prefers that no outside project writes to the control sheet at all, the alternative is an intake sheet that a GCM-side job pulls from. RFC-GPS-6 makes that choice. R43 applies either way.

  *Test:* the feeder's manifest declares no web app. A sharing check of the control sheet, run by a person, does not list the web app's executing account. With the feeder stopped, rows stay `pending_feed`, nothing reaches GCM, and the watchdog alerts within 15 minutes (R12). With `FEED_LIVE_ALLOWED = No` and the mode set to `live`, no row carries an admission number as recipient.

- **R43. Feed guard: the feeder trusts nothing it reads.** `Parent_Notify_Log` is written by the public-facing app, so the feeder checks every row again before it queues anything. A row is queued only if all of these hold:
  - The project is the constant `cw-bus-notify`, and the template belongs to a type enabled in `parent_notify_types`.
  - The recipient is the shadow space (in `shadow_gcm`), or an admission number in the `C0nnnnn` form that has an active `Student_Trip_Stops` row for that trip with `notify = Yes` and `gcm_reachable = Yes` (in `live`).
  - Every placeholder value comes from an allow-list: the bus from `Vehicle_Master`, the session from the three session names, the previous stop from `Transport_Stops`, the ETA as a whole number from 1 to 60, and the date and time in fixed formats. **No free text can reach a template.**
  - The row is not past its `expires_at`, and the time is inside `SEND_WINDOW`.
  - The `trip_run_id` is for today and for an active trip, and there is one row at most per `dedupe_key`.

  There are two caps: `students on the trip × enabled types` rows per trip run, and `gcm_feed_daily_cap` rows a day (default 300 for the pilot). **If a run would break a cap, the feeder queues nothing, marks the guard as tripped and raises an Ops Alert.** It stays tripped until a person resets it from the feeder's menu.

  What the guard does not stop: a person who can edit the workbook could add students to `Student_Trip_Stops` and so cause a real template to reach them, up to the daily cap. The wording is fixed, so the worst case is a wrong bus message and never arbitrary text. The workbook's sharing list is checked at Gate 2 for that reason (T27).

  *Test:* one fixture per rule produces no OUTBOX row and a logged reason. A forged log of 500 rows trips the guard with no rows queued. A value containing a URL is rejected.

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
| **Student_Trip_Stops** | `admission_no`, `session`, `trip_code`, `stop_id`, `notify`, `active`, `gcm_reachable` (written by the feeder from the ROSTER pre-check), `edited_by`, `edited_at` |
| **Parent_Notify_Log** | `dedupe_key`, `event_id`, `created_at`, `service_date`, `trip_run_id`, `session`, `event_type`, `admission_no`, `stop_id`, `eta_minutes`, `mode`, `status`, `suppressed_reason`, `gcm_queued_at`, `gcm_status`, `gcm_result`, `gcm_sent_at`, `latency_s`, `actual_crossing_at`, `eta_error_min` |
| **Notify_Strings** | `key`, `en`, `ta`, `ta-Latn`, `notes` |
| **GPS_Daily** | Unchanged, plus `trip_code`, `session`, `events_fired`, `events_suppressed`, `median_eta_error_min`, `median_gcm_latency_s` |
| **GPS_Access_Log** | Unchanged, plus `viewer_email` |
| **GPS_Access** | `email`, `name`, `role` (`view`/`manage`), `active`, `added_by`, `added_on`, `notes`. A protected range that only the workbook owner can edit |

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
- `parent_notify_types` (`bus_reached_school,bus_left_school`)
- `parent_notify_trips`
- `gate_l_passed` (No)
- `gcm_project_id` (`cw-bus-notify`)
- `notify_eta_minutes` (5)
- `notify_max_fix_age_s` (90)
- `notify_max_accuracy_m` (50)
- `eta_road_factor` (1.3)
- `eta_speed_window_min` (5)
- `gps_backfill_bucket` (400)
- `gcm_feed_daily_cap` (300)

### 7.3 D1

| Table | Columns or source |
|---|---|
| `devices` | `device_id`, `token_hash`, `kind`, `vehicle_id`, `store_outside_window`, `status` |
| `pings` | Primary key `(device_id, fix_ts)`, index `(vehicle_id, service_date)` |
| `device_latest` | The latest fix per device, plus the R5 token-bucket state |
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

- **Who sees bus locations:** only staff named on `GPS_Access`, each signed in with their own school Workspace account. This is enforced and logged per person (R14, R18, R41). The shared admin PIN unlocks no GPS, stop or student data. Parents see no map.
- **Student data:**
  - Transport holds admission numbers and stop assignments only, in Workspace.
  - Names and parent accounts stay in GCM's ROSTER and in the student master.
  - **Admission numbers never go to Cloudflare.**
  - Only the feeder's account can reach the GCM control sheet, and that is itself an access decision (Q10b). The public web app's account cannot reach it (R42).
- **Stop coordinates are sensitive**, because a doorstep stop is effectively a home address. Transport_Stops is visible to `GPS_Access` users only. D1 has stops without the student links.
- **Message content:** the safeguarding rules in §6.3(d) apply.
- **Closed in Revision 4:** Revision 3 left GPS access on a shared PIN until after the pilot. Per-person sign-in (R41, RFC-GPS-5) now applies from the first day of the pilot.
- **Remaining weak spots:**
  - The device token travels in a URL. R2 limits this: no path is logged, and tokens are reissued at the end of the pilot.
  - Anyone the transport workbook is shared with can read its tabs directly, without going through the app. Its sharing list is checked at Gate 2 (T27).
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
| A sweep is delayed, or a whole-school send holds the lock | A bus message arrives late | The watchdog alerts on any row still `pending_feed` or `queued_gcm` after 15 minutes (R39). Stop-level events stay non-live until Gate L |
| An event falls outside `SEND_WINDOW` (before 07:00 or after 19:00) | Delivered the next morning, which is wrong | Transport does not queue school events outside `SEND_WINDOW`, and logs them as `suppressed: outside_gcm_window`, until a per-project window exists |
| A student is not on ROSTER | No message | Shown as "Not reachable by GCM". GCM's own skip reason is reconciled nightly |
| Day-2 message identical to day 1 | GCM skips it as a duplicate | `{{Date}}` and `{{Time}}` in every template make each body different. Tested |
| GCM project is PAUSED | Rows held | Shown in the shadow view. The watchdog counts held rows |
| Stop not verified | No events for that stop | Listed in setup validation |
| Phase 2: reconfiguring the AIS-140 unit breaks VLTD reporting | Compliance risk | A single bus is changed first and VLTD is checked before any other. Configuration is rolled back by SMS command if needed |
| Phase 2: the vendor's SIM is cut after the subscription ends | That bus goes Stale | Settle SIM ownership before cancelling anything (Q1d) |
| Phase 2: the Traccar VM goes down | All hardwired buses go Stale | Ops alert from Stale on several buses at once, plus a VM health check in `/v1/health` |
| The feeder stops, or its trigger is lost | Events stay `pending_feed`. No parent message | The watchdog alerts when the heartbeat is older than 5 minutes or a row has waited 15 minutes (R12). Rows past `expires_at` are marked `expired` and are never sent late |
| The feed guard trips (a cap is broken) | No bus messages until it is reset | Ops Alert at once. A person checks `Parent_Notify_Log`, then resets the guard from the feeder's menu (R43) |
| A dead zone ends and the phone sends its buffer in a burst | The track fills in. No event fires from old fixes | R5 accepts the burst by `fix_ts`. The pings are `late`, and R36 suppresses events from them |
| A person leaves or changes role | They lose GPS access | `GPS_Access.active = No` takes effect within 60 s (R41). The list is reviewed at every gate |
| Gate L does not pass | Parents get the school events only | Stop-level delivery leaves the PRD at the decision memo (§6.3c). The shadow evidence is kept |
| Phase 2: the vendor or the RTO says the subscription must stay | No saving | The project continues only on the Control case recorded at Gate 0 (§12.1) |

## 11. Pilot plan and success criteria (one bus)

**Shape:** **One bus, one route, one driver** (Q3), running the morning pickup and its drop session for at least 4 weeks of school days. The stages of §2 set the order:
- **Stage 1**, from day one: tracking. Week 1 is shakedown. The tracking pass lines are measured over weeks 2–4.
- **Stage 2**, once Gate 2 passes: **driving the route to verify every stop**, then at least 2 weeks of `shadow_local`.
- **Stage 3**, once Gate 3a passes: at least 2 weeks of `shadow_gcm` for the school events.

If a gate is late, the pilot runs longer. Stage 3 may finish after the tracking decision has been made.

Weak-signal areas are not known in advance. They are **found and recorded as the pilot runs** from GPS_Daily gaps, and each dead zone is listed by stop segment.

One bus, one driver and one phone is a small sample. The results prove the **pipeline and the method**, not phone tracking across the fleet. That is acceptable, because Phase 2 does not depend on phones. For that reason each tracking measure below is marked **Pipeline** (true whatever the device, and a gate for Phase 2) or **Phone** (true of this phone only, reported but not a gate).

### Tracking

| Measure | Kind | Pass |
|---|---|---|
| Coverage (`covered_minutes / window_minutes`) | Phone | At least 95 % overall. Every dead zone found is listed, with backfill bringing coverage to at least 98 % |
| Backfill after a dead zone | Pipeline | Every buffered ping is stored once, is marked `late`, and fires no event (R5) |
| Latency (fix to dashboard) | Pipeline | Median 30 s or less, p95 90 s or less |
| Accuracy (at 3 surveyed points on 3 days) | Phone | Median 20 m or less, p95 50 m or less |
| Battery | Phone | No run lost to battery while on the charger. Drain 10 %/h or less off the charger (one deliberate test) |
| Switch-off detection (4 induced tests: app stopped, phone off, airplane mode, revoked permission) | Pipeline | 4 out of 4 alerted within `gps_stale_minutes` + 5 |
| False Stale alerts | Pipeline | No more than 1 per week by week 4 |
| Silent failures | Pipeline | 0 |
| Access | Pipeline | Every GPS view in `GPS_Access_Log` carries a named address. No view by PIN alone |
| Usage | Pipeline | In-charge uses it on at least 80 % of school days |
| Cost and standards | Pipeline | ₹0. Under 25 % of every free-tier limit. No raw pings in Sheets. No secrets in any file |

### Shadow notifications

Ground truth comes from the in-charge or attendant recording actual stop times on **at least 8 trip runs**.

| Measure | Pass |
|---|---|
| Approaching (`shadow_local` only), by event time: bus arrives 3–8 minutes after the event | 85 % or more, and never less than 1 minute |
| Previous-stop correctness (`shadow_local` only) | 98 % or more |
| School events correct, no duplicates | 98 % or more, 0 duplicates |
| Events missed while the bus was Live | 5 % or fewer |
| Events from stale or late data | **0** |
| Duplicates per student, trip and type | **0** |
| **GCM latency in `shadow_gcm`** (queued to logged SENT) | Recorded honestly, for the school events, and including the feeder's wait of up to 1 minute. **Pass:** p95 of 13 minutes or less inside `SEND_WINDOW`. No stop-level rows go to GCM. The same figure shows whether stop-level events could ever pass without a fast path, and it is the evidence for RFC-GCM-lib |
| Shadow rows that GCM skipped as duplicates | **0** (R37) |
| Feed guard | Every R43 fixture rejected. Never tripped by real traffic |
| ROSTER reachability of the pilot trip's students | 100 % reachable, or each gap explained |

### Phase 2 go/no-go

Go when all of these are true:
1. The **Pipeline** pass lines held. The Phone lines are reported in the memo and do not gate this decision. Both cover weeks 2–4.
2. R6 passes, including an AIS-140-protocol fixture if the make is known.
3. **Option A feasibility is settled:** make and model, Traccar protocol support, whether the vendor allows a secondary server or provides an API, written confirmation that VLTD is unaffected, SIM ownership, and the contract terms.
4. Q1f is answered **in writing**: whether AIS-140 is required for these buses, and which paid services must be kept.
5. The break-even table in §12.1 is filled in with real figures. It shows a monthly saving, or leadership has confirmed the Control case of Gate 0 at the stated monthly cost.
6. Leadership confirms they rely on it.
7. The budget is approved.

If Option A is blocked, Option B (FMB920) goes to approval instead.

**Phase 2 starts with one bus, not the fleet.** The first hardwired bus runs for 2 weeks through the Traccar VM. The Phone measures (coverage and accuracy) are taken again on it, because the pilot could not measure them for hardware, and the VLTD feed is confirmed on that bus (§3.4). The fleet follows only if that bus passes.

**Parent go-live is a separate decision** (§6.4). It does not have to wait for Phase 2, but stop-level events wait for Gate L.

## 12. Cost estimate (indicative; confirm with quotes)

| Item | Phase 1 (1 bus, 4 weeks or more) | Phase 2 Option A: reuse AIS-140 (lead) | Phase 2 Option B: FMB920 (fallback, per bus) |
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

### 12.1 Baseline and break-even (filled in at Gate 0)

The saving cannot be judged without the fee paid today, and Revision 3 did not record it. These figures come from an invoice, not from memory (Q18).

| Figure | Value |
|---|---|
| Buses with a fitted AIS-140 unit (N) | `TODO(school)` |
| Subscription per bus per month (S) | `TODO(school)` |
| Contract end date, notice period, any exit fee | `TODO(school)` |
| Services inside the fee that must be kept for compliance (Q1f) | `TODO(vendor, RTO)` |
| Who owns the SIMs (Q1d) | `TODO(vendor)` |

**Monthly saving = N × S − (V + N × M + K)**
- V is the Traccar VM, about ₹500–1,200 a month.
- M is an own SIM per bus: ₹0 if the school already owns the SIMs, otherwise about ₹100–250 a month.
- K is whatever compliance obliges the school to keep paying.

Worked for 25 buses with K = 0:
- The own system costs about ₹500 a month at best (school-owned SIMs and a small VM) and about ₹7,450 a month at worst (₹1,200 plus 25 × ₹250).
- The break-even subscription is therefore between about **₹20 and ₹300 per bus per month**. Below the applicable figure there is no saving.
- Option B adds about ₹125,000–200,000 one-off for 25 buses (₹5,000–8,000 each). The payback in months is that sum divided by the monthly saving.

If Q1f shows that the subscription cannot be cancelled, the saving is nil and the project rests on the Control case alone (Gate 0).

## 13. Risks and the estate rules that apply

- **NN12 (writes to Sheets):** raw pings stay in D1. Sheets get at most one GPS_Daily row per trip per day, and one batched fan-out per event. At fleet scale the bigger pressure is **GCM's** MESSAGE LOG and OUTBOX (about 6,000 rows a day). That is GCM's scaling question and is flagged in its RFC.
- **NN1 and NN6:**
  - Hashed per-device tokens, header secrets in the RELAY_SECRET style, and HMAC on `doPost`.
  - The per-person identity check (R41) runs on every GAS GPS function. The admin PIN unlocks none of them.
  - The public web app's account cannot reach GCM. A separate feeder with a feed guard does the writing (R42, R43).
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
- **New public `doPost`** on an anonymous app: the security review (T27) is **Gate 2**, not a note. It covers the `doPost`, the R41 checks, the feeder, and the sharing lists of the workbook and the control sheet.
- **New OAuth scope** `script.external_request` on the transport script: the deploying account must re-authorise. Access to the GCM control sheet belongs to the feeder's account only.
- **A dependency outside the project's control:** stop-level delivery needs a shared-library change. It sits behind Gate L, with a decision date, so it cannot stall the rest (§6.3c).
- **An unproven business case:** the saving depends on answers the school does not yet have. Gate 0 and §12.1 make leadership choose the case before the build.
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
| RFC-GPS-6: Parent bus events feed GCM | transport **and** GCM (`Christwood-GC-mega-project/rfcs/`, mirroring RFC-010) | **Changes who is notified** (families) and **touches more than one project**. Covers: the `cw-bus-notify` project and its templates, the **separate feeder and its account** (R42), the feed guard (R43), removing any control-sheet access held by the web app's account, the OUTBOX feed for the **school events only**, shadow through a redirect space, **the first unattended family sends (an exception to GCM v1's "a person presses LIVE")**, safeguarding review, the language decision, reply routing, and the volume ceiling |
| RFC-GCM-lib: OUTBOX expiry, fast lane, per-project send window and reply routing | **estate (shared GCM core)** | A library change. Needs a `GCM_VERSION` bump, a CHANGELOG entry and a re-pin at every school. This is condition 1 of **Gate L**, so it needs a named implementer and a target date. Not transport's to implement |
| RFC-GPS-7: Reuse fitted AIS-140 devices (Phase 2) | transport | The secondary-server configuration, the Traccar VM, the VLTD safety procedure, and SIM and contract changes |
| RFC-GPS-5: Per-person sign-in | transport | **Moved forward: required before the pilot starts** (R41). Fixes the mechanism after the T26 spike, the `GPS_Access` tab and the two roles |

## 15. Suggested tickets

Worker tags follow the brief: Codex for code, Sonnet for security- or auth-sensitive work, cross-system integration with GCM, and Tamil, Haiku for documents. The dispatcher confirms them.

The scope is **one pilot bus**. The data model and the code are built for the whole fleet.

Gates (§2):
- **T24 runs first**, in Stage 0. It needs no RFC, because it touches no device and writes no code. Its output feeds RFC-GPS-7.
- T1–T14 and T26 start after **Gate 0** and RFC-GPS-1 to RFC-GPS-5.
- T15–T19 and T22 may be built alongside them, but go live only after **Gate 2** (T27).
- T20, T21 and T23 also need RFC-GPS-6. They cover the **school events only**.
- T25 is a draft. Nothing here depends on it unless **Gate L** passes.

| # | Ticket | Delivers | Tested by | Worker |
|---|---|---|---|---|
| T1 | Worker scaffold and D1 migration | `gps-worker/` as `.mjs` with `wrangler.toml` (Worker `christwood-transport-gps`, D1 ID `TODO(human)`), the idempotent migration (R8), the `.claspignore` exclusion (R24) | Migration run twice locally. `clasp status` checklist | Codex |
| T2 | Device tokens and Worker auth | Issue and revoke tokens, hash-only storage, constant-time comparison, header secrets, the `fix_ts` spacing rule, the burst bucket, the size cap and no path logging (R2, R5, R21) | Wrong, revoked and reissued tokens. A backfill burst is kept, and a flood gets 429. Secret grep. Log capture | Sonnet |
| T3 | OsmAnd adapter and canonical Ping | R1, R3, R4, R7 | Fixture replay, duplicate replay, reject reasons | Codex |
| T4 | Traccar forward adapter | R6. Adds an AIS-140-protocol fixture once the make is known | Equivalence of paired fixtures | Codex |
| T5 | Bus status and stale alerts | R10, R11 | Boundary tests, silence simulation, webhook-failure mock | Codex |
| T6 | Read API, health, rollup and purge | R9, plus the read endpoints | Rollup arithmetic, purge boundary, 401 without the secret | Codex |
| T7 | GAS setup for the new tabs | GPS_Devices, Transport_Trips, Transport_Stops, Trip_Stops, Student_Trip_Stops, Parent_Notify_Log, Notify_Strings, GPS_Daily, GPS_Access_Log and the Settings keys, with validation (R19, R26, R28, R29) | Two runs on a copy. Validation fixtures | Codex |
| T8 | Config push and token menu | R20, R21, Script Properties, manifest scope | Stubbed payload test, manual steps | Sonnet |
| T9 | GAS GPS endpoints and access log | R14, R17, R18, using the R41 identity check from T26 | The four R14 refusals. Cache hit. Log rows with the viewer's address | Sonnet |
| T10 | Live buses view | R13, R15, R16, showing the session trip and next stop | 360 px checklist, Worker-down simulation | Codex |
| T11 | Watchdog and daily pull | R12 (including the feeder heartbeat and the stuck `pending_feed` and `queued_gcm` checks) and R22, with menu twins | Stubbed health. A double run gives one row | Codex |
| T12 | Ops README and PROJECT.md | R23, R25. Notes the EMIS precedent and the separate Worker | A second person follows it | Haiku |
| T13 | Driver card and consent (English) | §8, §9 | The in-charge onboards the pilot driver | Haiku |
| T14 | Pilot measurement and decision memo | Weekly one-bus summary (tracking split into Pipeline and Phone, shadow, GCM latency) and the §11 memo, which also records the Gate L decision | One seeded week matches a hand calculation | Haiku |
| T15 | Stop import and capture tool | R27, R30: import of the school's named-location sheet (**blocked on Q12 headers**), "Mark this stop", map tap, dwell suggestions, the `verified_on` gate | Idempotent import. Marked-stop fields. Unverified stops skipped | Codex |
| T16 | Trip engine by session | R31, R32: run open and close per trip, segment crossing, school-exit hysteresis | Pass-through, gate jitter, skipped stop, two sessions on one bus | Codex |
| T17 | ETA, stop events and suppression | R33, R34 (Worker side), R36 | Geometry tests, a fixture per suppression reason, replay | Codex |
| T18 | Delivery from Worker to GAS | Outbox, HMAC-signed POST, retry, expiry, `doPost` verification (R34) | Bad signature, replayed timestamp, expired item | Sonnet |
| T19 | Fan-out, sent-flags and modes | R35, R37 | Triple replay. Payload assertions for each mode. Opt-out | Sonnet |
| T20 | GCM feeder: OUTBOX feed, feed guard, ROSTER pre-check and reconcile | §6.2, R42, R43: a **separate GAS project** (`projects/transport-gcm-feeder/`) with no web entry point. School events only. Appends OUTBOX rows under the exact GCM headers (Calendar precedent), the shadow-space redirect, the nightly ROSTER read, the nightly MESSAGE LOG and OUTBOX reconcile, the stuck-row alert (R39). Drafts the `cw-bus-notify` PROJECTS row and TEMPLATES rows **for the GCM maintainer to apply**. This ticket writes no GCM rows except OUTBOX | Fixture control sheet: exact header match, batch append, no edits to existing rows, mode assertions, reconcile mapping. One fixture per R43 rule. 40 shadow rows give 40 `SENT` and no duplicate skip. The manifest has no web app | Sonnet |
| T21 | Notification strings in en, ta and ta-Latn | R38 for all four events, following the §6.3(d) wording rules. GCM template drafts and parent wording review for the **two school events only**. A bilingual-template variant for Q15. Tamil driver card and parent notice | Placeholder parity. Native-speaker and safeguarding review | Sonnet |
| T22 | Shadow review view | R40, plus the "Replay events for a trip" dry run | A seeded run shows correct ETA errors and correct GCM latencies | Codex |
| T23 | Ops README addendum for notifications | Switching modes, pausing the GCM project, the go-live checklist, fixing a stop, GCM contacts | A second person runs `shadow_local` → `shadow_gcm` → `off` | Haiku |
| T24 | **Stage 0.** Business case and AIS-140 reuse feasibility pack | The fee paid today and the §12.1 break-even table (Q18). The leadership case decision (Q19). Vendor question list (Q1a–f). Traccar protocol lookup once the make is known. A one-bus secondary-server SMS procedure with a VLTD check and rollback. Sizing for the Traccar VM | Reviewed by Dan before anyone contacts the vendor. No device is touched under this ticket | Haiku |
| T25 | *(Estate work, not this repo)* GCM library proposal | A draft RFC-GCM-lib: OUTBOX `Expires At`, a fast lane, a per-project `SEND_WINDOW`, per-project reply routing, fleet-scale ceiling and `LOG_SCAN_ROWS`. Uses the measured shadow latency as evidence. States the fast-path target of a p95 of 2 minutes or less (Gate L) | GCM maintainer review. Implemented in the core repository, if approved | Sonnet (draft only) |
| T26 | Per-person sign-in | R41: a spike to confirm how the viewer's Workspace address is obtained, then the `GPS_Access` tab, the two roles, the server-side check used by every GPS function, and the address in `GPS_Access_Log`. RFC-GPS-5 is finalised from the spike | The R14 and R41 cases. PIN alone is refused. Deactivation works within 60 s | Sonnet |
| T27 | Security review (**Gate 2**) | A written review of: the public `doPost` (HMAC, replay window, size limits), the R41 check on every GPS function, the feeder and feed guard design, the Worker's secrets and logging, and the sharing lists of the transport workbook and the GCM control sheet. Each finding is fixed or accepted in writing | Dan signs the review. A person other than the author runs the refusal tests against the deployed app | Sonnet (review), human (sign-off) |

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
    - b. May the **feeder's account**, not the web app's, have **edit access to the GCM control sheet**? That access also exposes 📥 REPLIES. Or does the maintainer prefer an intake sheet that GCM pulls from (R42)?
    - c. Will the estate take on **RFC-GCM-lib** (expiry, fast lane, per-project window, reply routing)? If so, who implements it and by when? That is condition 1 of Gate L. Until it ships, only the school events can go live.
    - d. Who should receive **replies to bus messages**: the class teacher by default, or the transport in-charge?
    - e. GCM's named `{CONTACT}`. It is still unnamed in GCM's own CLAUDE.md.
11. Is keeping raw pings for 90 days acceptable?
12. **The school's stop sheet.** What is its name, where is it, and who owns it? Please provide a **CSV export with its real headers**: they could not be found in `projects/transport`, so the import is unspecified. Should transport's tabs become the master copy after a one-time import, or should the school's sheet stay the master and be re-imported? Who updates a student's stop when it changes? Are the stops shared roadside stops or doorstep stops?
13. Should absent students be left out? (Transport has no student attendance.) Should `bus_reached_school` go to a student whose stop was never crossed?
14. How long should `Parent_Notify_Log` be kept? (Proposed: 1 year.)
15. **Language for bus messages through GCM:** English only (an exception to the estate rule), one bilingual message (recommended), or a per-family preference (a library change)?
16. Do any pickups start before **07:00**, or any evening drops end after **19:00**? GCM's `SEND_WINDOW` holds those messages. That would make a per-project window (RFC-GCM-lib) a precondition for those trips.
17. **The web app's account.** Which account deploys the transport web app, and does it have any access to the GCM control sheet today? If it does, which is preferred: redeploying the app from an account without that access, or removing that account from the sheet (R42)?
18. **The fee paid today.** What does the school pay the manufacturer per bus per month, for how many buses, until what date, and with what notice period or exit fee (§12.1)?
19. **Which case does leadership rely on:** Saving, Control, or both (Gate 0)?
20. **Sign-in.** Do the in-charge, the admins and the leadership viewers each have a school Workspace account that they can use on their phone (R41)? Who keeps `GPS_Access` up to date?

### What blocks what

The last column is a proposal. Each row needs a named person and a date before its stage is planned.

| Questions | Block | Answered by |
|---|---|---|
| Q18, Q19, and Q1a–f sent | Gate 0, and so all build work | Leadership, the school office, the project owner |
| Q3, Q5, Q9, Q20 | Stage 1 | Transport in-charge, project owner |
| Q4 | The first `wrangler deploy` (T1) | Dan |
| Q8, Q11, Q13, Q14 | RFC-GPS-1 | Project owner |
| Q12 | T15, and so all of Stage 2 | Transport in-charge |
| Q10a, Q10b, Q10d, Q10e, Q15, Q16, Q17 | Gate 3a and Gate 3b | GCM owner, safeguarding lead |
| Q2, Q6, Q7 | Driver onboarding and live sends | Leadership |
| Q10c | Gate L | GCM owner and maintainer |
| Q1a–f answered | The Phase 2 go/no-go | Vendor, RTO |

## 17. Changes in Revision 4

Revision 4 answers the review of 2026-11-10, which found three main issues and two smaller ones.

- **Issue 1, stop-level messages cannot arrive in time and the fix has no owner:**
  - Events are split into Track S (school events) and Track L (stop-level events) (§5.3).
  - Only the school events go through GCM. Stop-level events are measured in `shadow_local` and get no templates, no OUTBOX rows and no wording review.
  - **Gate L** sets four conditions for stop-level delivery, with a decision date at the pilot memo. If it does not pass, the feature leaves this PRD (§6.3c).
  - `shadow_gcm` would have lost most of its rows to GCM's dedupe hash. Each shadow row now has a unique `{{Shadow Ref?}}` line (§6.2, §6.4, R37).
  - §1 now says plainly that Phase 1 solves the office's problem and not yet the parent's.
- **Issue 2, the business case was unproven and the pilot did not test it:**
  - **Gate 0** comes before any code: the fee paid today, the vendor questions sent, and leadership's choice between the Saving case and the Control case (§2).
  - §12.1 adds the baseline and a break-even formula. T24 runs first and no longer waits for RFC-GPS-7.
  - Tracking measures are marked Pipeline or Phone. Only Pipeline measures gate Phase 2 (§11).
  - The Phase 2 go/no-go needs the break-even table filled in and Q1f answered in writing. Phase 2 starts with one hardwired bus for 2 weeks.
- **Issue 3, the access model was too weak:**
  - **R41:** per-person Workspace sign-in from the first day of the pilot. RFC-GPS-5 moves from "before the fleet" to "before the pilot". The PIN unlocks no GPS, stop or student data (R14, R18, T26).
  - **R42:** a separate feeder project and account does everything that touches GCM. The public web app's account has no access to the control sheet. Live sends need two switches held by two accounts.
  - **R43:** a feed guard checks every row again, allows no free text into a template, and stops everything if a cap is broken.
  - The security review is now **Gate 2** (T27). R2 forbids logging the token path.
- **Smaller issue, the rate limit would have dropped backfill:** R5 now judges spacing on `fix_ts`, allows a burst through a token bucket, and answers 429 only above it.
- **Smaller issue, blocked inputs:** §2 adds stages and gates, §16 adds Q17–Q20 and a table of what blocks what.
- **Consequential changes:**
  - The feeder adds up to 1 minute, so the latency figures are now about 6 minutes typical and 12 minutes worst case, and the pass line is a p95 of 13 minutes.
  - The pilot is "at least 4 weeks" and runs longer if a gate is late.
  - `Parent_Notify_Log` gains the `pending_feed` status. New Settings: `gate_l_passed`, `gps_backfill_bucket`, `gcm_feed_daily_cap`. New tab: `GPS_Access`.
  - The heading of R34 was reworded so that "stop-level" has one meaning. A reference to a §6.5 that did not exist now points to §6.3c, and a real §6.5 holds R42 and R43.
- **Not done in this revision:** the repo, the standards files and the GCM library were not re-read. Three points need confirming in code: how the viewer's address is obtained (T26), how GCM treats a blank optional line and duplicate bodies (T20), and how Traccar Client reacts to 429 (T3).

### Changes in Revision 3 (kept for the record)

Some of these were superseded by Revision 4, including the pilot week plan, the latency figures and transport's direct access to the control sheet.

- **AIS-140 (answer 1):** the lead Phase 2 option is now reusing the fitted AIS-140 device: a secondary server slot sends TCP to a Traccar VM, which forwards to the same R6 adapter. Buying an FMB920 is the fallback. Added the VLTD-must-not-be-disturbed constraint, the Option A failure modes, an Option A cost column, RFC-GPS-7, T24, and the expanded Q1a–f.
- **One-bus pilot (answer 2):** §1, G1, pilot volumes, the §11 criteria (rescaled, with a sample-size caveat, dead zones discovered as the pilot runs, 4 switch-off tests, at least 8 trip runs for shadow), and the ticket scope note. The design stays ready for the whole fleet.
- **Cloudflare (answer 3):** Dan's account. Follows the EMIS relay precedent (`.mjs`, `wrangler.toml`, header secret in the RELAY_SECRET style) as a **separate Worker**, `christwood-transport-gps` (§3.2). Records three deliberate departures, including the **plaintext relay secret in `SCRIPT-PROPERTIES.txt`**. Updated R23, R24, T1 and Q4.
- **GCM (answer 4):** the placeholder contract is replaced by a concrete design: a new GCM project `cw-bus-notify`, fed through 📤 OUTBOX on the Calendar precedent, with a ROSTER pre-check and a nightly reconcile (§6.1–6.2). Added honest sections on latency (about 5 minutes typical, about 11 minutes worst case, nothing outside 07:00–19:00, no expiry), the first unattended sends, no edits to the library (RFC-GCM-lib / T25), safeguarding wording rules, strict ROSTER, and English-only versus en/ta/ta-Latn. Shadow is now `shadow_local` followed by `shadow_gcm` through a `spaces/` redirect. Found the **GCM hash-dedupe trap** (an identical body is skipped within 2 days), fixed by putting `{{Date}}` and `{{Time}}` in every template. Updated R37–R40, RFC-GPS-6, T20, T25 and Q10, and added Q15 and Q16.
- **Stops (answer 5):** trips are keyed by session (morning pickup, afternoon drop, evening drop), each with its own route number (R26). Stops are named places, geocoded once and **verified by driving** (R27). Stop sequences are per trip (R28). Each student has a stop per session (R29). Added an import and capture tool (R30). Confirmed that **transport holds no stop or student data today** (§7.1). The school sheet's headers are unknown and remain open (Q12, T15 blocked).
- **Unchanged:** the D1 recommendation, the ingest contract, tracking requirements R1–R25 apart from the edits named above, the dashboard, driver onboarding, and the status vocabulary.
