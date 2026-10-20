# Digital MRN/PRN — Purchase Requisition Automation

**Slug:** `purchase` · **Org:** Christwood · **Category:** GAS Web Apps
**Status:** Launched · **Owner:** Stella Baby · **Contact if broken:** Stella Baby

Digitised Material/Purchase Requisition Note process, replacing paper-based
purchase requests.

## Bindings

| Thing | Value |
|---|---|
| Script ID | `1w-V1fijdqj-9EzvPQLvbhGMu38mgFI5L6EvVkJ0vLbz3v4fVEAxbUi25` |
| Spreadsheet | `1jkGOTo4haveVCLb6puRPyNEG7rceMKtSXo7za76FBPY` |
| Web app | see the Projects Tracker row for the current `/exec` URL |

## Source of truth

This directory. Baseline commit was pulled from the deployed script on
2026-09-16 and confirmed identical to the previous local copy apart from blank
lines. Per shipping standards §2: **no editing in the Apps Script editor.**
Any live patch must be `clasp pull`ed back and reconciled before the next push.

## Structure

| File | Role |
|---|---|
| `Code.js` | `doGet`, routing, entry points |
| `ConfigService.js` | Config sheet → object. All settings live here, not in code |
| `RequestService.js` | Request creation, numbering, attachments |
| `NotificationService.js` | Email notifications |
| `HRService.js` | Staff lookup from the `ImportHR` sheet |
| `PrintService.js` / `PrintView.html` | Printable requisition |
| `SetupSheet.js` | Idempotent sheet setup |
| `Index/FormView/DashboardView/Styles/ClientScripts` | Web app UI |

## Config keys (Config sheet — never hardcode these)

`prefix`, `yearCode`, `separator`, `nextSeqNum`, `seqPadding`,
`onSubmissionEmails`, `onPrincipalEmails`, `onAdminHeadEmails`, `onCEOEmails`,
`onRejectionEmails`,
`guestEmails`, `attachFolderId`, `maxFileSize`, `allowedFileTypes`,
`schoolName`, `schoolLogoUrl`, `sigText`, `hrColName`, `hrColDept`, `hrColEmail`

## Footguns

- **`onPrincipalEmails` and `onRejectionEmails` are read by
  `getNotificationRecipients()` but nothing calls those stages.** They remain
  unwired. As of TICKET-0001, `onCEOEmails` and `onAdminHeadEmails` **are**
  wired: `sendApprovalNotification(data)` in `NotificationService.js` fires on
  submission (alongside `sendSubmissionNotification`) and sends to the
  deduplicated union of the Admin Head and CEO recipient stages. Don't assume
  a configured address means mail is being sent — that caution still applies
  to `onPrincipalEmails` and `onRejectionEmails`.
- `submitRequest()` in `RequestService.js` wraps `sendSubmissionNotification`
  and `sendApprovalNotification` in **separate** try/catch blocks, so a
  `MailApp` failure in one cannot suppress the other. This was deliberate as
  of TICKET-0001 — if someone later "cleans up" by merging the two try/catches
  back into one, a failure in either notification would silently swallow the
  other, reintroducing the bug this ticket fixed.
- `hrColName` / `hrColDept` / `hrColEmail` are **column letters** in the
  `ImportHR` sheet, held in Config. They exist because the HR import's column
  order is not ours to control — but they are still positional. Treat them as a
  known deviation from non-negotiable #2, not a pattern to copy.
- `nextSeqNumRow: -1` is a sentinel meaning "not yet located".

## Who is who

- **Principal** — academic head. `onPrincipalEmails`. Currently unwired.
- **Admin Head** — Sharon Paul, HR Head by designation, non-academic head of the
  school, reports directly to the CEO. `onAdminHeadEmails`. Purchase approvals
  route to her, **not** to the Principal. Do not conflate the two keys.
- **CEO** — `onCEOEmails`.
