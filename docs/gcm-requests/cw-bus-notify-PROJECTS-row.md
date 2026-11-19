# GCM request: 📋 PROJECTS row for `cw-bus-notify`

**Status:** Draft, for the GCM maintainer to apply. **Not applied.** Nothing in the transport repo writes this row.
**From:** transport live GPS, ticket G-E. **Spec:** `projects/transport/docs/PRD.md` rev 4 §6.2 and R42. **RFC:** `docs/rfcs/RFC-GPS-6-parent-bus-events-feed-gcm.md`.
**Library:** GCM 1.10.0, published version 1 (Christwood). No library change is requested. This is configuration data only.

## The row

Headers are the real ones from `library/01_Constants.gs` `TABS.PROJECTS`. Quote them from row 1 of the sheet when you paste, not from this file.

| Header | Value | Why |
|---|---|---|
| Project ID | `cw-bus-notify` | The feeder's constant. It will not write for any other ID |
| Name | `Bus notifications (transport feeder)` | |
| Status | `PAUSED` | See "Status" below. `PAUSED` is the emergency stop: the sweeper holds the project's queued OUTBOX rows |
| Recipient Mode | `ADMISSION_NO` | The sweeper re-resolves each OUTBOX `Recipient` in this mode. A literal `spaces/…` resolves in any mode (`05_Resolve.gs`), which is how shadow works |
| Source Sheet ID | *(blank)* | No tracker sheet. Rows arrive through OUTBOX |
| Data Tab | *(blank)* | As above |
| Header Row | *(blank)* | As above |
| Recipient Column | *(blank)* | As above |
| Filter | *(blank)* | As above |
| Template ID | `cw-bus-reached-school` | Fallback only. Every OUTBOX row names its own template |
| Delivery | `API` | Student DMs need the API path. The shadow space is posted to with the same path |
| Sent Flag Column | *(blank)* | No source sheet to flag |
| Sent By Column | *(blank)* | As above |
| AUTO | `FALSE` | AUTO runs once a day and is useless here. The OUTBOX sweeper is not gated by `AUTO_ENABLED` |
| Schedule | *(blank)* | |
| Hide Sent Rows | `FALSE` | |
| Notes | `Fed by the transport GCM feeder only (RFC-GPS-6). School events only. Do not queue by hand.` | |

## Status: PAUSED versus ACTIVE

The PRD says `PAUSED` until go-live. The sweeper (`08_Outbox.gs`, `sweepOne_`) holds every row of a non-ACTIVE project and sends nothing. **Shadow mode also needs the project ACTIVE**, because the shadow messages are real sends to the shadow space, through the same sweeper. So:

1. Apply the row as `PAUSED`.
2. Set `ACTIVE` only for Gate 3a (start of `shadow_gcm`). The redirect to the shadow space is what keeps shadow traffic away from families.
3. Live sending needs Gate 3b and the feeder owner's `FEED_LIVE_ALLOWED = Yes` as well.
4. `PAUSED` stops it again at any time. Rows already queued stay in OUTBOX as `READY` and are held. **They are sent when the project goes ACTIVE again, however old they are**, because GCM cannot expire rows (no `Expires At`). Before re-activating after a pause, the maintainer should set any stale `cw-bus-notify` OUTBOX rows to `CANCELLED` (the feeder shows these as `skipped`).

## Not requested, but the maintainer should know

- **No expiry in GCM.** An OUTBOX row queued in the last minutes before `SEND_WINDOW` closes, or while the project is `PAUSED`, can be sent the next morning. The feeder only queues inside the window and refuses to queue rows past `expires_at`, but it cannot recall a row it already appended. This is why stop-level events stay behind Gate L.
- **Access.** The feeder's account needs edit on the control sheet (it appends OUTBOX rows) and, as a side effect, can read 📥 REPLIES. Q10b in the PRD asks the GCM owner to decide that. The account that runs the public transport web app must have no access.
- **Volume.** With school events only, one bus of about 40 students adds about 80 messages a day. Fleet-wide that is about 2,000, near `DAILY_SEND_CEILING` 2500 once the school's own sends are added.
- **Replies** go to the class teacher through 📇 REPLY ROUTING. Per-project reply routing is a library change and is not requested here (PRD §6.3a item 4).
- **Hash dedupe.** GCM skips an identical body to the same recipient within `DEDUPE_WINDOW_DAYS`. Every template includes `{{Date}}`, `{{Time}}` and `{{Session}}`, and shadow rows carry a unique `{{Shadow Ref?}}` line, so neither day-2 messages nor the 40 shadow rows of one event collide.
