# RFC-GPS-5 — Per-person sign-in for GPS data

**Status:** Draft
**Project:** `projects/transport/`
**PRD:** `projects/transport/docs/PRD.md` Revision 4, R14, R18, R41, T26
**Ticket:** G-A (`docs/tickets/gps/G-A.md`)
**Author:** Claude (Sonnet 5.5), for Dan to review
**Created:** 2026-11-19

---

## Why this needs an RFC

This is login/security. Bus positions, stops and student assignments are about children. The existing web app is deployed `ANYONE_ANONYMOUS`, and every public server function in it can be called by anyone, from any page. The PRD requires that GPS access depends on a named person, from the first pilot day (R41), and that the shared admin PIN never unlocks it.

## What exists today

- `appsscript.json`: `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`; the `userinfo.email` scope is already granted.
- Admin functions are guarded by a PIN-derived token held in the script cache (`atk_...`). A token proves "someone knew the PIN", not who they are.
- In an anonymous deployment `Session.getActiveUser().getEmail()` returns an empty string.

## Decision

**Identity comes only from `Session.getActiveUser().getEmail()`**, in a deployment that makes the visitor sign in with a school Workspace account. It is never read from the PIN token, a function argument, a cookie or the calling page. An empty string means "not signed in".

**Mechanism: a second deployment of the same script, restricted to the school domain, executing as the accessing user.** The existing anonymous deployment is untouched and keeps serving the current app. The GPS views are served only from the second deployment. In the anonymous deployment every GPS function refuses, because identity is blank.

**Creating that deployment is a human step.** Nothing in this repo creates or changes a deployment, and the ticket forbids `clasp deploy`. Steps for the person doing it, with the owner present:

1. In the Apps Script editor: Deploy, New deployment, Web app.
2. Execute as: **User accessing the web app**. Who has access: **Anyone within the school domain** (**TODO(human):** the domain, not recorded here).
3. Note the new `/exec` URL and record it in the Projects Tracker row. Do not reuse the anonymous URL.
4. Sign in with a non-listed school account and confirm every GPS function returns the refusal; sign in with a listed `view` account and confirm the view opens.

### Server-side check (`GpsAuth.js`)

Every GPS server function begins with `gpsRequire_('view')` or `gpsRequire_('manage')`. It takes no token and no address argument.

| Case | Result |
|---|---|
| Anonymous (blank address) | `{ok:false}` |
| Valid admin PIN token, no sign-in | `{ok:false}`: the PIN is not an input |
| Signed in, address not on `GPS_Access` | `{ok:false}` |
| Signed in, `active` is not Yes | `{ok:false}` |
| `view` calling a `manage` function | `{ok:false}` |
| Access sheet unreadable | `{ok:false}` (fails closed) |
| Listed, active, role sufficient | `{ok:true, email, role}` |

- `manage` includes `view`. Email matching ignores case and spaces. An unknown role name denies.
- A refusal is a fixed message and never says which of "unknown", "inactive" or "too low" applied, and it carries no coordinates or student data.
- The active list is read from `GPS_Access` **by header name** and cached for **60 s**. Only active rows are cached. Setting `active` to No therefore blocks the person's next call within 60 s.
- `GPS_Access` is protected so that only the workbook owner can edit it (set by `setupGpsTabs()`, which should be run by the owner).
- Every view is recorded by `gpsLogAccess_(email, view)` in `GPS_Access_Log` with the signed-in address (R18). Whether a failed log write blocks the view is each caller's choice (G-B); the function returns true or false and never throws.

### G-F amendment: stop tool (manage only)

`?page=gps-stops` and its six server functions (`getGpsStops`, `gpsMarkStop`, `gpsTapStop`, `getGpsDwell`, `gpsSaveDwellDraft`, `gpsImportStops`) need `gpsRequire_('manage')`. A `view` role cannot read stop coordinates or the import report. Saves write an audit row to `GPS_Access_Log` before the sheet changes. No change to the roles or the deployment steps.

### What the code cannot show

The server-side check is unit-tested with table-driven cases, but **only a real deployment shows that `getActiveUser().getEmail()` returns the viewer's address** under the chosen settings. That is the T26 spike. It has not been run (no Apps Script runtime was available).

## Risk to settle before the pilot

With **execute as the accessing user**, the script runs with each viewer's own Google permissions. Each GPS viewer would then need access to the spreadsheet itself for the script to read `GPS_Access` and the GPS tabs. That makes the tabs readable by them directly in Sheets, which defeats the role split, and the 60 s cache and the access log would depend on every viewer holding Sheet access.

The PRD's own proposal avoids this: same domain-restricted second deployment, but **execute as the deploying account**, where `getActiveUser().getEmail()` still returns the viewer's address for same-domain users, and the workbook need not be shared with viewers. G-A's brief says "accessing user"; this RFC records that as written and **recommends the spike test the deploying-account variant first**. `GpsAuth.js` works unchanged under either setting. Decision needed from Dan before step 2 above.

## Fallback (text only, not built)

If the spike shows the viewer's address is not available in either variant, use a **separate Apps Script project for the GPS views only**, deployed as a web app restricted to the school domain, with its own copy of `GPS_Access` read through a narrow, read-only data handoff (for example an Apps Script library or a small JSON endpoint on the Worker) rather than by sharing the transport workbook. The main app stays anonymous and carries no GPS code path. Falling back to the PIN is not allowed (R41).

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Put the GPS views behind the admin PIN | PIN holders are not individually identified or removable (R41, G7). |
| Trust an email passed from the page | The caller controls the page; anyone could claim any address. |
| Google Identity token in the page, verified server-side | More moving parts than a domain-restricted deployment and a second client path to secure; keep as a fallback option. |
| Cache the list longer than 60 s | Deactivation would not bite within the PRD's 60 s. |

## Open points

1. Execute-as setting (above). Needs the T26 spike and Dan's decision.
2. Who keeps `GPS_Access` current (PRD Q20) and how often it is reviewed (PRD says at every gate).
3. Role per function. R41: `view` covers the map, tracks, daily summary and shadow view; `manage` adds stops, assignments, tokens, the config push and the mode switch. G-B assigns each function its role against that list.
