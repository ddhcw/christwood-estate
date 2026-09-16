# RFC-0001 — Approval notification on submission

**Status:** Proposed
**Suggestion:** `S-1D76EF33` (Digital MRN/PRN — "Approval to Process")
**Project:** `projects/purchase/`
**Raised by:** Stella Baby, 2026-09-08
**Author:** Dan
**Created:** 2026-09-16

---

## Why this needs an RFC

Per PRD §7, a change that alters **who receives a notification** crosses the RFC threshold. This one sends mail to the Principal and the CEO — real people, on every purchase request. Getting the trigger condition or the recipient list wrong is noisy and embarrassing in a way a code bug is not.

## The request, as raised

> after Digital Purachase Request is rised by Purachase Dept. Approval note has to sent to Ms.Sharon and CEO

## What exists today

`NotificationService.js` has exactly one send path:

- `sendSubmissionNotification(data)` → `getNotificationRecipients('submission')` → `config.onSubmissionEmails` → one `MailApp.sendEmail`.

`ConfigService.js` already defines, reads from the Config sheet, and resolves:

| Config key | Stage | Currently called by |
|---|---|---|
| `onSubmissionEmails` | `'submission'` | `sendSubmissionNotification` |
| `onPrincipalEmails` | `'principal'` | **nothing** |
| `onCEOEmails` | `'ceo'` | **nothing** |
| `onRejectionEmails` | `'rejection'` | **nothing** |

So three quarters of the notification model was built and never wired up. This RFC wires up two of the three stages the suggestion asks for.

## Decision

Add `sendApprovalNotification(data)` to `NotificationService.js`, fired on the same event as the existing submission notification, sending to the union of `getNotificationRecipients('principal')` and `getNotificationRecipients('ceo')`.

**Rationale for each choice:**

- **Reuse the existing config keys.** Ms. Sharon's and the CEO's addresses go in the Config sheet, not in code — non-negotiable #5, and it means Stella can change them without a deploy. No name or address appears in source.
- **One mail to the combined list, not two mails.** The suggestion asks for "an approval note", singular. Two near-identical mails to two leaders reads as a system fault.
- **Reuse `buildNotificationHtml_`** with an approval-framed subject and a short lead line, rather than a second template to drift out of sync.
- **Deduplicate the recipient list**, so an address configured in both fields is not mailed twice.
- **Fire on submission, not on a new approval step.** The suggestion describes notification, not a workflow stage. Adding an approval *state* to the request lifecycle is a much larger change and is explicitly out of scope here.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Hardcode Sharon's and the CEO's addresses | Violates non-negotiable #5. Breaks the day either person changes. |
| Add a full approve/reject workflow with states and buttons | Not what was asked. Would touch `RequestService`, the dashboard and the sheet schema. If leadership wants it, it gets its own RFC. |
| Append the two leaders to `onSubmissionEmails` in the Config sheet, no code change | Zero-code and tempting, but it conflates "the purchase team was told" with "leadership was asked to approve". The two lists diverge the moment anyone wants different copy or a different trigger. Also leaves the dead `'principal'`/`'ceo'` branches dead. |
| Send via Google Chat instead of email | The project has no Chat webhook wiring; the suggestion says "note", and the existing channel is email. |

## Scope

**In:**
- `NotificationService.js` — new `sendApprovalNotification(data)` and a subject/lead variation in the HTML builder.
- The one call site that currently fires `sendSubmissionNotification`.
- `SetupSheet.js` — ensure the Config sheet seeds `onPrincipalEmails` and `onCEOEmails` rows idempotently, so the setting is visible and editable rather than invisible-and-empty.

**Out:**
- `onRejectionEmails` — still unwired. Separate ticket if wanted.
- Any change to the request lifecycle, dashboard, or print view.
- Any change outside `projects/purchase/`.

## Failure behaviour

Per non-negotiable #7 and §9 honest state:

- Empty recipient list → log and skip, exactly as `sendSubmissionNotification` does today. Do not throw; a purchase request must not fail to save because leadership's address is blank.
- `MailApp` throws → catch, log, and let the submission succeed. The request is the record; the mail is a courtesy.
- Re-running must not double-send. The notification fires once per submission, from the same guard as the existing one.

## What cannot be verified in the sandbox

The implementing agent has no Apps Script runtime, no Config sheet, and cannot send mail. `MailApp` quota behaviour, actual HTML rendering in Gmail, and whether the Config sheet rows land in the right columns are all human-verified after deploy. `verifier` writes those steps into the PR.

## Open question for Dan

Is "Ms. Sharon" the Principal (→ `onPrincipalEmails`) or a third role needing its own key? This RFC assumes Principal. If she is neither, the config key list needs one more entry and this RFC gets revised before the ticket is worked.
