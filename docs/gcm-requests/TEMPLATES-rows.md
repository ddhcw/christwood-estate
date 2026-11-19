# GCM request: 📝 TEMPLATES rows for `cw-bus-notify`

**Status:** Draft, for the GCM maintainer to apply. **Not applied.** Two rows only: the school events. The two stop-level templates (`cw-bus-approaching`, `cw-bus-previous-stop`) are **not drafted**: they wait for Gate L (PRD §6.3c), and nothing here may build anything that only stop-level delivery would use.
**From:** transport live GPS, ticket G-E. **Parent wording review and safeguarding review are still to be done** by the school's safeguarding lead (PRD §6.3d). Every new wording goes through TEST before LIVE, as GCM requires.

Headers are the real ones from `library/01_Constants.gs` `TABS.TEMPLATES`: `Template ID · Format · Title · Body · Item Body · Footer · Image URL · Button Text · Button URL · Notes`. Quote them from row 1 of the sheet when you paste.

## Rules these wordings follow

- **TEXT only.** DMs cannot carry cards.
- **The bus is described, never the child.** No "your child has boarded". That would be attendance information, which GCM v1 bans, and GPS on a bus cannot know it.
- **The student's own stop is never named.** These two events name no stop at all.
- No times of future runs.
- **English only** (Christwood Q8, answered 29 Sep 2026). The estate rule is en, ta and ta-Latn for parent-facing text. Delivery in Tamil is **open question Q15**, below.
- `{{Date}}`, `{{Time}}` and `{{Session}}` are in every body, so the dedupe hash differs from day to day and between the morning and evening runs.
- `{{Shadow Ref?}}` is **optional and on its own last line**. In `shadow_gcm` the feeder fills it with a counter and the event ID (for example `shadow 00007 2026-11-19|T1|SCH|bus_reached_school`), so 40 shadow rows for one event give 40 different bodies. In `live` the feeder leaves it out, and the library drops the empty line (`tidyBody_` in `06_Template.gs`). It never holds an admission number.
- No `{{Student Name?}}` line. It is not needed, and in shadow ROSTER fields are empty anyway.

## Placeholders, and what the feeder puts in them

Every value comes from an allow-list; free text cannot reach a template (R43).

| Placeholder | Source | Form |
|---|---|---|
| `{{Bus}}` | `Vehicle_Master.vehicle_id` of the trip's vehicle | up to 24 letters, digits, space, `.`, `/`, `-`; no link |
| `{{Session}}` | the three session names | `Morning pickup`, `Afternoon drop`, `Evening drop` |
| `{{Time}}` | the time the event row was created, Asia/Kolkata | `HH:mm` |
| `{{Date}}` | the service date | `dd MMM yyyy`, for example `19 Nov 2026` |
| `{{Shadow Ref?}}` | feeder counter and event ID, shadow only | `shadow NNNNN <event id>` |

## Row 1: `cw-bus-reached-school`

| Header | Value |
|---|---|
| Template ID | `cw-bus-reached-school` |
| Format | `TEXT` |
| Title | *(blank)* |
| Item Body | *(blank)* |
| Footer | *(blank: the 🎨 BRANDING `MESSAGE_FOOTER` applies. Maintainer to confirm it is right for a bus message and that it does not promise a reply route that bus messages do not have)* |
| Image URL, Button Text, Button URL | *(blank)* |
| Notes | `Transport feeder. School event. Sent only for the morning pickup run.` |

Body (paste exactly, two lines):

```
Bus {{Bus}} reached school at {{Time}} on {{Date}} ({{Session}}).
{{Shadow Ref?}}
```

## Row 2: `cw-bus-left-school`

| Header | Value |
|---|---|
| Template ID | `cw-bus-left-school` |
| Format | `TEXT` |
| Title | *(blank)* |
| Item Body | *(blank)* |
| Footer | *(as row 1)* |
| Image URL, Button Text, Button URL | *(blank)* |
| Notes | `Transport feeder. School event. Sent only for the afternoon and evening drop runs.` |

Body (paste exactly, two lines):

```
Bus {{Bus}} left school at {{Time}} on {{Date}} ({{Session}}).
{{Shadow Ref?}}
```

## Open question Q15: language (not decided here)

The PRD (§6.3f) lists three options: English only (an exception to the estate rule, recorded in the GCM RFC); one bilingual message; or a per-family language preference (a library change). The PRD recommends the bilingual message, subject to native-speaker review. If the school chooses it, only the Body changes, for example a second line in Tamil under the English one. A suggested shape, **wording to be written and reviewed by a native speaker, not by this ticket**:

```
Bus {{Bus}} reached school at {{Time}} on {{Date}} ({{Session}}).
<Tamil line with the same four placeholders, written and reviewed by a native speaker>
{{Shadow Ref?}}
```

The placeholders stay the same four, so the feeder needs no change. `Notify_Strings` in the transport workbook already holds en, ta and ta-Latn for the app's own use.
