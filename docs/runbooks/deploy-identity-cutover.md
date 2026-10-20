# Runbook — move transport, purchase and calllog onto automations@

**Why:** RFC-0004. These three web apps run as whoever last updated their live
deployment. The tracker's deploy job ran as dan@, so every approved release
silently made dan@ the runtime. Transport's fuel reports broke on 2026-09-22.

**Who:** Dan, using two accounts. Each step says which one.
Use a private/incognito window for automations@ so the two never mix.

**The one rule:** in step 3, **edit the existing deployment. Never press
"New deployment".** A new deployment gets a new link, and every bookmark, the
tracker row and calllog's MacroDroid macro would break.

| App | Live deployment ID (starts … ends) | Now on |
|---|---|---|
| transport | `AKfycbxoDz` … `IOpWFmPYqOVJUv` | v12 |
| purchase | `AKfycbydj4` … `XAxl97xTYB8dZBlng` | v8 |
| calllog | `AKfycbz-lY` … `6vZnUr4rHJvu4zhXjocbmp46` | v8 |

Full IDs are not written in this repo (it is public). Read them from the Apps Script
**Deploy → Manage deployments** screen, or ask Claude to run read-only `clasp deployments`.

Purchase has five older versioned deployments (v1–v5). Leave them alone. The
one above is the one the deploy job moves.

After each step, tell Claude "step N done". Claude checks with read-only
`clasp deployments` that the IDs are unchanged and a new version exists.

---

### 1. Pause the deploy job — as dan@

1. Open the Projects Tracker sheet → **Config** tab.
2. Set `agent_deploy_enabled` to `FALSE`.

This pauses deploys **and rollbacks** without deleting anything. The estate
repo holds only transport, purchase and calllog, so this pauses exactly those
three. Leave Approve boxes as they are.

### 2. Check access — as automations@

For each of: the transport, purchase and calllog spreadsheets (IDs in each
`projects/<slug>/PROJECT.md`), and the Projects Tracker sheet:

1. Open it. If you get "You need access", go to step 2.3.
2. Extensions → Apps Script must open **without** "read-only". That means
   Editor on the script.
3. If either fails: as dan@, Share → add `automations@christwood.edu.in` →
   **Editor** → untick Notify → Share.

Then, still as automations@:

4. Open `script.google.com/home/usersettings` → **Google Apps Script API: On**.
   The deploy job calls that API as whoever owns its trigger.

### 3. Redeploy each app in place — as automations@

Do this once per app: transport, then purchase, then calllog.

1. Open the spreadsheet → Extensions → Apps Script.
2. **Deploy → Manage deployments.** (Not "New deployment".)
3. In the left list, tap the deployment whose ID matches the table above.
   Check the start and the end of the ID.
4. Tap the **pencil (Edit)**.
5. **Version: New version.** Description: `Runs as automations@ (RFC-0004)`.
6. Leave "Execute as" on **Me** and "Who has access" as it is.
7. Tap **Deploy**.
8. When asked to authorise: choose automations@ → Advanced if shown →
   **Select all** → Allow.
9. The Web app URL shown must be the **same** as before. If it is different,
   stop and tell Claude.

Do **not** change any code in the editor. Nothing is pushed in this step; the
new version is a snapshot of what is already there.

### 4. Test each app — as any normal user, not automations@

- **transport:** generate a fuel report. It must save into "Fleet Fuel Reports"
  without "Access denied: DriveApp".
- **purchase:** submit a test requisition. The approval email must arrive
  **from automations@christwood.edu.in**. Then delete the test row.
- **calllog:** make or receive one test call on the office phone. A new row must
  appear in the call log sheet.

If any test fails: Manage deployments → edit the same deployment → pick the
previous version number (from the table) → Deploy. Link stays the same.

### 5. Move the deploy trigger — automations@ then dan@

As automations@:

1. Open the Projects Tracker sheet → Extensions → Apps Script.
2. Left bar → **Triggers** (alarm clock) → **Add Trigger**.
3. Function: **`deployApproved`**. Deployment: **Head**. Event source:
   **Time-driven**. Type: **Hour timer**. Interval: **Every hour**. Save.
4. Authorise with **Select all** if asked.

As dan@:

5. Same Triggers page. Find the `deployApproved` trigger **owned by
   dan@christwood.edu.in** → ⋮ → **Delete trigger**.
6. Leave dan@'s other tracker triggers (sync, backup, heartbeat, digest) alone.

Warning: **Setup → "5 · Install / repair triggers"** recreates `deployApproved`
for whoever runs it. If dan@ runs it later, delete dan@'s `deployApproved`
again. The guard (step 6) will refuse that trigger anyway and post an alert.

### 6. Ship the guard — as dan@

1. Merge the tracker PR "Refuse to deploy as the wrong account".
2. Deploy the tracker by hand from the tracker repo, as usual (it never deploys
   itself, RFC-0003): `clasp push`, then Manage deployments → edit the
   tracker's existing deployment → New version.
3. Merge the estate PR (this runbook, RFC-0004, the `Runs as` rows). The guard
   reads `Runs as` from the estate repo's main branch, so this must be merged
   before un-pausing.
4. As **automations@**: Tracker sheet → 🧩 Tracker Tools → 🤖 Agent →
   **Check the deploy account**. Expect "Running as automations@…", "owns a
   deployApproved trigger", and ✅ on transport, purchase and calllog.
5. As dan@: Config tab → `agent_deploy_enabled` → `TRUE`.

### 7. Afterwards — Drive folders the apps write to

Make automations@ the owner of each of these (Share → transfer ownership, or
move into a shared drive automations@ manages). Names come from the code; find
them by name.

**transport** (searches by name across everything the runner can see, so keep
exactly **one** folder of each name — duplicates get picked at random):

- `Fleet Fuel Reports` — fuel report PDFs (`FuelReport.js`, `reportFolder_`).
  Already owned by automations@.
- `Fleet Attendance` — attendance PDFs (`Attendance.js`).
- `Fleet Tracker Backups` — spreadsheet backups (`Reports.js`).

**purchase:**

- If the Config sheet's `Attachment Folder ID` is set, that folder.
- Otherwise a folder created next to the purchase spreadsheet, named
  `<that parent folder's name>] MRN-SUBMISSIONS]`, with one subfolder per
  request ID (`RequestService.js`). Anything created there since 2026-09-22 is
  owned by dan@.

**calllog:** no Drive writes in the code; only its own spreadsheet.
