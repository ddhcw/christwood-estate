# Fleet Tracker — Setup Guide

Plain steps to get this running. No coding needed — you copy, paste, and click.
Takes about 20 minutes the first time. Do it on a computer (not a phone).

---

## What you'll end up with

- One Google Sheet that quietly stores everything — **backed up to Drive every night**.
- A good-looking **app link** you open on your phone to add fuel, maintenance and trips —
  with a **QR sticker per bus** that opens the app with that vehicle already selected.
- A PIN-locked **admin area**: Dashboard, manage Vehicles & Drivers, and fix mistaken entries.
- Emails that arrive by themselves: a **morning check** (documents, licences, service due,
  missing entries, odd readings), a **Monday digest**, and a **monthly report**.

---

## 🔁 Already running an older version? (updating a live system)

Your existing data is safe — updates only **add** things, nothing is moved or deleted.

1. In the Apps Script editor, **re-paste all files** from the table in Part A, and add any that
   are new to you (latest addition: `Reports`). Delete `MastersForm` if you still have it.
2. Run **`setupWorkbook`** once (Part B). It adds any new Settings rows and columns, and never
   changes values you already have.
   > The latest update adds a tab (**Odometer_Events**), four columns on **Vehicle_Master**, and a
   > `notes` column on **Monthly_Summary**. Every existing vehicle is assumed to have a working
   > odometer. **Run `setupWorkbook` before using the app** — until you do, the new buttons will
   > complain that a tab is missing.
3. Run **🚌 Fleet → Turn on automatic updates** again — this schedules the new automatic emails
   and the nightly backup. Google will ask for permission once more (the backup needs Drive access) — approve it.
4. Push the update to the live link: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**

---

## Part A — Create the Sheet and paste the code

1. Go to **sheets.new** (this makes a blank Google Sheet). Give it a name like *Fleet Tracker*.
2. Top menu: **Extensions → Apps Script**. A code editor opens in a new tab.
3. You'll add **19 files**. In the editor's left panel, each file is added with the **+** button
   next to "Files".
   - For files ending in **`.gs`** → choose **Script**.
   - For files ending in **`.html`** → choose **HTML**.
   - Type the name **exactly** as below (no extension shown in the editor), then paste the
     matching file's contents over whatever is there.

   | File to create | Type | Paste from |
   |---|---|---|
   | `Code` | Script | `Code.gs` |
   | `Setup` | Script | `Setup.gs` |
   | `Data` | Script | `Data.gs` |
   | `Analytics` | Script | `Analytics.gs` |
   | `Triggers` | Script | `Triggers.gs` |
   | `Admin` | Script | `Admin.gs` |
   | `Reports` | Script | `Reports.gs` |
   | `Index` | HTML | `Index.html` |
   | `Styles` | HTML | `Styles.html` |
   | `Script` | HTML | `Script.html` |
   | `FuelForm` | HTML | `FuelForm.html` |
   | `MaintenanceForm` | HTML | `MaintenanceForm.html` |
   | `TripForm` | HTML | `TripForm.html` |
   | `DocForm` | HTML | `DocForm.html` |
   | `VehicleAdmin` | HTML | `VehicleAdmin.html` |
   | `DriverAdmin` | HTML | `DriverAdmin.html` |
   | `FixEntries` | HTML | `FixEntries.html` |
   | `AdminLogin` | HTML | `AdminLogin.html` |
   | `Dashboard` | HTML | `Dashboard.html` |

   > A new project starts with a file called `Code.gs` already there — just paste into it.
   > Delete the sample `myFunction()` text first.

4. Click the **Save** icon (💾).

---

## Part B — Build the tabs (one click)

1. Still in the Apps Script editor, at the top pick the function **`setupWorkbook`** from the
   dropdown (next to ▶ Run), then click **▶ Run**.
2. Google asks for permission the first time → **Review permissions → choose your account →
   Advanced → Go to (project) → Allow**. (This is normal; it's your own script.)
3. Switch back to the Sheet tab. You'll now see all the tabs: **Dashboard, Fuel_Log,
   Maintenance_Log, Trip_Log, Vehicle_Master, Driver_Master, Staff, Document_Register,
   Odometer_Events, Monthly_Summary, Settings** — colour-coded with dropdowns ready.
4. Set the **admin PIN**: Sheet menu **🚌 Fleet → 2) Set / change admin PIN**. Choose a 4–8
   digit PIN. This is what unlocks the admin tools (Dashboard, Vehicles, Drivers, Fix entries).

There's also a new **🚌 Fleet** menu in the Sheet for everything below.

---

## Part C — Publish the app (get your link)

1. In the Apps Script editor: **Deploy → New deployment**.
2. Click the gear ⚙ → **Web app**.
3. Set:
   - **Description:** Fleet app
   - **Execute as:** *Me*
   - **Who has access:** *Anyone* (so drivers can open it without signing in)
     — or *Anyone within (your school)* if everyone has a school Google account.
4. **Deploy → Authorise** if asked → copy the **Web app URL**.
5. Open that URL on your phone, then **Add to Home Screen** so it feels like an app.

> Anytime you change the code later, use **Deploy → Manage deployments → ✏️ Edit →
> Version: New version → Deploy** to push the update.

---

## Part D — Turn on the automatic bits

1. In the Sheet, go to the **Settings** tab and set **`alert_email`** (where the emails go)
   and **`fuel_price_per_litre`** (today's diesel price — lets the app work out litres by itself).
2. Sheet menu: **🚌 Fleet → Turn on automatic updates**. Approve once. From then on, by itself:
   - **Nightly** — the Dashboard refreshes, and a dated **backup copy** of the whole Sheet is
     saved to Drive → *Fleet Tracker Backups* (the newest 30 are kept).
   - **Every morning (~7am)** — ONE email, only if something needs attention: documents or
     driver licences expiring, a service falling due, a bus with no entries for 3 weeks,
     an odometer typo, a fuel entry whose price looks wrong, a bus left marked off road,
     or an odometer left marked not working.
   - **Monday (~8am)** — a weekly digest: km, fuel and maintenance per vehicle, plus anything flagged.
   - **1st of the month (~6am)** — last month's full report, emailed.

Every one of these can also be run on demand from the **🚌 Fleet** menu, and the digest/report
can be switched off on Settings (`weekly_digest`, `monthly_report`).

---

## Part E — Start using it

1. Tap the **🔒 lock** (top-right) and enter your name + PIN to unlock the admin tools.
2. Go to **Vehicles**, then **Drivers**, and add yours. (Do this first so they show up in the forms.)
3. Add a couple of names under the **Staff** tab in the Sheet — these fill the "Entered by" picker.
4. **Print the QR stickers**: Vehicles → **📱 QR** → **Print**. Stick one in each bus. Scanning it
   opens the app with that vehicle already selected — nobody picks the wrong bus again.
5. Day to day: anyone can open the link (or scan the bus's QR) and use
   **Add Fuel / Add Maintenance / Add Trip** — no PIN needed.
6. Admin-only: **Dashboard**, **Documents**, and **Fix entries** appear once you've unlocked.

**Golden rule:** always enter the **odometer** at every fuel fill and every maintenance.
That single number is what makes cost-per-km possible. The one exception is a bus whose
odometer is genuinely broken — see below; tell the app, don't guess a number.

### Little things the app now does for you
- **Remembers you** — "Entered by" and "Paid by" default to what that phone used last time.
- **Picks the driver** — choosing a vehicle auto-selects its assigned driver (changeable).
- **Fills in litres** — type the ₹ amount and litres are worked out from `fuel_price_per_litre` (editable).
- **Pre-fills the trip's opening km** with the vehicle's last known odometer reading.
- **No signal at the pump?** The entry is kept safely on the phone and a yellow banner appears
  on the home screen — it sends automatically next time the app opens with signal.

---

## 🔧 A bus that's off the road

When a bus goes into the garage, mark it — the figures depend on it, and it takes one tap.

**Putting it off road.** On **Add Maintenance**, fill in the job as usual and flick
**"Take this vehicle off road?"** before saving. One action does both: the job is logged *and*
the bus is marked **Under maintenance**. You can also set the status by hand in
**Vehicles → Edit → Status** if it went off road without a maintenance entry.

**Bringing it back.** The home screen shows every off-road bus with a **Back on road** button.
Tap it, check the date, and the app has already counted the days off road for you — change the
number if it's wrong. Those days are written onto the maintenance entry that took it off road,
which is what feeds the "days off road" part of the replace signal.

**While it's off road:**
- It still appears in Add Fuel / Add Maintenance / Add Trip, tagged **🔧 off road** — a bus at
  the garage still gets fuelled or towed, so nothing is blocked. Picking it shows a reminder
  with a **Back on road** button, in case someone forgot to flip it back.
- It's left out of the **service due** and **no recent entries** morning checks (an off-road bus
  is *supposed* to be quiet), but it still appears in the Monday digest so its repair spend shows.
- It's counted under **Off road** on the Dashboard rather than **Active vehicles**.
- If it's still marked off road after `off_road_reminder_days` (default 7), the morning email
  says so — that's almost always someone forgetting, not a three-week repair.

## 🚫 A bus whose odometer has stopped working

Better an honest gap than a made-up number. Tell the app and it stops asking.

**Marking it.** On **Add Fuel** (or Maintenance, or Trip), pick the vehicle and tap
**"Odometer not working?"** underneath the reading box. Give the date it stopped. From then on
that bus's entry forms don't show an odometer field at all — you just record the fuel and save.

**What happens to the numbers.** Fuel and maintenance **spend is still recorded in full**. What
pauses is anything that needs distance: km, cost/km and km/L show **—** for the affected months,
with "Odometer not working" in the `notes` column of Monthly_Summary. The vehicle is also left
out of the fleet's average cost/km — counting its fuel bill against zero km would make the whole
fleet look worse for no reason — and it's skipped by the replace signal, listed as
*could not be assessed* instead of quietly passing as healthy.

**When it's fixed.** Tap **Odometer fixed?** on any entry form, or **Fixed** on the home-screen
banner. The app asks what the meter reads *now*:
- **Higher than before** — the same meter kept counting. Business as usual.
- **Lower than before** — a replacement unit that has started again (often from zero). The app
  records a reset: counting starts afresh from that number, the "lower than the last reading"
  warning stops firing, and the old readings stay on record but are never subtracted from the
  new ones. You don't get a phantom 90,000 km month, and you don't have to retire the bus and
  re-add it to escape the problem.

The distance actually covered while the meter was dead is **not** guessed at or dumped into the
month it came back — those months simply read "not measured". Every odometer break, repair and
replacement is kept in the **Odometer_Events** tab.

> Both of these are also on **Vehicles → Edit** behind the admin PIN — *Status*, *Off road since*,
> *Odometer working?* and *Not working since* — for tidying up after the fact.

---

## The admin tools (behind the PIN)

Tap the **🔒 lock** → enter your name + PIN. It auto-locks after 30 minutes of no use, or tap
the 🔓 to lock straight away. The PIN is checked on the server, so the admin tiles aren't just
hidden — they genuinely won't work without it.

- **Vehicles / Drivers** — tap **+ Add** to add, or tap any row to **edit**. The **Retire** button
  hides a vehicle/driver from the pickers while keeping all its history (so your numbers stay intact).
  There's no permanent delete, on purpose.
- **Fix entries** — pick Fuel / Maintenance / Trip, tap an entry to **correct** it, or **Void** it if
  it was a mistake. Voided entries stay on the record but are left out of all the figures.
- **Edit trail** — every edit is stamped with your name and the date, shown on the edit screen.
- **Duplicate guard** — if the exact same entry is logged twice for a vehicle (e.g. a double tap),
  the second one is automatically skipped. You'll see a "skipped a duplicate" message.

> Forgot the PIN? Just set a new one: **🚌 Fleet → 2) Set / change admin PIN**.

---

## The Settings tab (tune these anytime)

| Setting | What it does |
|---|---|
| `app_title` | Title shown at the top of the app |
| `currency_symbol` | Symbol next to money (default ₹) |
| `alert_email` | Who gets document-expiry emails |
| `doc_expiry_warning_days` | How many days ahead to warn (default 30) |
| `replace_window_months` | How many months the "replace" check compares (default 3) |
| `replace_maint_costkm_rise_pct` | Flag if maintenance ₹/km rises this % (default 20) |
| `replace_efficiency_drop_pct` | Flag if km/L drops this % (default 10) |
| `replace_downtime_rise_days` | Flag if days-off-road rises this much (default 2) |
| `replace_require_all_three` | *Yes* = all three must trigger; *No* = any two |
| `low_efficiency_kmpl` | Optional: always warn below this km/L |
| `fuel_price_per_litre` | Today's fuel price — auto-fills litres and flags odd fuel entries (blank = off) |
| `fuel_price_tolerance_pct` | How far off the price can be before it's flagged (default 25%) |
| `service_interval_km` | Scheduled service due every this many km (default 10,000) |
| `service_warn_km` | Start warning this many km before a service is due (default 500) |
| `silent_vehicle_days` | Flag an active vehicle with no fuel entry for this long (default 21) |
| `odo_jump_km` | Flag odometer jumps bigger than this — likely typos (default 3,000) |
| `off_road_reminder_days` | Remind me if a bus is still marked off road after this long (default 7) |
| `odo_broken_reminder_days` | Remind me if an odometer is still not working after this long (default 14) |
| `licence_warning_days` | Warn this far ahead of a driver-licence expiry (default 30) |
| `weekly_digest` | *Yes/No* — Monday digest email |
| `monthly_report` | *Yes/No* — monthly report email on the 1st |
| `backup_keep` | Nightly backup copies to keep in Drive (default 30) |

Sit with the transport-in-charge and adjust the four `replace_*` numbers once you've
seen a few months of real data. After changing them, the Dashboard updates overnight,
or run **🚌 Fleet → Rebuild dashboard now**.

---

## If something looks off

- **Dropdowns empty in the app?** Add vehicles/drivers first; the app refreshes after each add.
- **"Tab is missing" error?** Run **🚌 Fleet → Set up workbook** again (safe — it never deletes data).
- **Dashboard looks empty?** You need at least a couple of fuel/maintenance entries with
  rising odometer readings. Then **Rebuild dashboard now**.
- **A bus shows "—" for cost/km?** Its odometer is marked not working, so there's no distance to
  divide by. Tap **Fixed** on the home screen once the meter is repaired; months from then on
  measure normally. (The dead months stay "—" — that distance was never recorded.)
- **Everything says "Tab is missing" after an update?** Run **🚌 Fleet → Set up workbook** — the
  update added an `Odometer_Events` tab that doesn't exist in your workbook yet.
- **No expiry email?** Check `alert_email` on Settings, and that you ran "Turn on automatic updates".
- **Changed the code but the app didn't change?** Re-deploy a **New version** (Part C note).
- **Made a mess of the Sheet?** Open Drive → **Fleet Tracker Backups** — there's a dated copy
  from every night. Open the right one and copy back what you need.
- **QR won't scan?** Print it bigger — each code is generated at high size; scale up when printing.

---

## How efficiency (km/L) is worked out

It only uses fills where you ticked **"filled to full tank"**. Between two full fills it
takes the kilometres covered and divides by the litres added in between. Partial fills still
count toward fuel cost — they're just not used as the start/end of an efficiency measurement.
So: tick "full" whenever you brim the tank, and the km/L number stays honest.
