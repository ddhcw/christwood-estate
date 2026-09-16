# TICKET-0001 — Wire up approval notification to Principal and CEO

**Ref:** `S-1D76EF33`
**RFC:** [RFC-0001](../rfcs/RFC-0001-approval-notification.md) — must be Accepted before work starts
**Project:** `projects/purchase/` (Digital MRN/PRN)
**Category:** GAS Web Apps → also read `standards/categories/gas-messaging-posting.md`
**Size:** small
**Blocked on:** the open question in RFC-0001 §Open question

---

## Task

Implement the decision in RFC-0001. Nothing beyond it.

## Acceptance criteria

1. `sendApprovalNotification(data)` exists in `NotificationService.js` and is called on submission, alongside the existing `sendSubmissionNotification`.
2. Recipients come from `getNotificationRecipients('principal')` ∪ `getNotificationRecipients('ceo')`, deduplicated, case-insensitively.
3. **No email address, and no person's name, appears anywhere in source.**
4. Empty recipient list → `Logger.log` and return. No throw.
5. `MailApp` failure → caught and logged. The purchase request still saves.
6. `SetupSheet.js` seeds `onPrincipalEmails` and `onCEOEmails` Config rows, and re-running `setupSheets()` does not duplicate them.
7. Config is read by header/label, never by hardcoded row index.
8. Subject line distinguishes this from the existing submission mail.
9. No file outside `projects/purchase/` is touched.

## Subagent sequence

| Step | Agent | Output |
|---|---|---|
| 1 | `implementer` | The diff, confined to `NotificationService.js` and `SetupSheet.js` |
| 2 | `reviewer` | Diff checked against `standards/`; violations vs unverifiable, kept separate |
| 3 | `docs-writer` | `projects/purchase/PROJECT.md` updated with the new notification stage and its Config keys |
| 4 | `verifier` | Numbered manual test steps for the PR body, plus an explicit "could not verify" list |

## Manual verification (filled by `verifier`, run by Dan after deploy)

To be written into the PR body. At minimum it must cover: `setupSheets()` run twice with no duplicate Config rows; a test submission with both Config fields blank; a test submission with one field populated; a test submission with the same address in both fields, confirming one mail not two.

## Definition of done

A merged PR, deployed via `clasp push`, and one real purchase request submitted end to end with Stella confirming the mail arrived and read correctly.

**Not done when the PR merges.** Per shipping standards §9.7, "it works" and "it's maintained" are different bars — this ticket closes at the second one.
