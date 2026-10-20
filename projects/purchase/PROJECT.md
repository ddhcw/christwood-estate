# Purchase Requisition (Digital MRN/PRN)

**Slug:** `purchase`
**Org:** Christwood
**Category:** GAS Web App
**Status:** Launched
**Owner:** Purchase project owner, as named in the Projects Tracker row
**Contact if broken:** Named in the Projects Tracker row for purchase
**Tracker link:** Projects Tracker, row for purchase (the current `/exec` URL is in that row)
**Repo:** `projects/purchase`
**Doc status:** Draft — not yet checked by a person

## What it is

The digital Material/Purchase Requisition Note (MRN/PRN) process. It replaces
the paper purchase request. A staff member fills in a form, attaches quotes or
supporting files, and submits. The system numbers the request, stores it in a
Sheet, sends emails, and produces a printable requisition.

## Who uses it

- **Staff** submit requests through the web app. Any signed-in school account
  can open the form. The app checks the email against the HR import (the
  `ImportHR` tab) before it accepts a request.
- **Guests** are school consultants or others listed in the Config tab under
  `Allowed Guest Emails`. They type their email in by hand, because the app
  cannot read their Google account.
- **Viewers** are people listed under `Department Roles` in the Config tab. Any
  viewer role sees all requests on the dashboard. The `access` field of the role
  is read, but the code does not use it to narrow the list.
- **Approvers** are the Admin Head and the CEO. They receive the approval email.
  Purchase approvals go to the Admin Head, not the Principal.
- **Print access** is decided by `hasPrintAccess()` in `HRService.js`.

Current number of users and how often they submit: not checked from code.

## What it does

- Shows a request form. The form takes a purpose, stock in hand, notes, and a
  list of items (description, quantity, unit, cost per unit).
- Checks the form before saving. Attachments must be an allowed type and within
  the size limit. The app also checks for a likely duplicate from the same
  person.
- Creates a request ID from `Prefix`, `Academic Year Code`, `Separator` and the
  next sequence number. An example is `PR2627-0001`. The counter is held in the
  Config tab and bumped under a script lock.
- Writes one row to the `Requests` tab and one row per item to the `Items` tab.
  It stores attachments in a Drive folder.
- Sends a submission email, then an approval email to the Admin Head and CEO.
  Each email is sent separately, so one failure does not stop the other.
- Shows a dashboard of requests with status, and a detail view for each one.
- Builds a printable requisition with the digital signature text from the Config
  tab. The signature text states that the submission is the requester's
  authorisation.

## Bindings

| Binding field | Value |
|---|---|
| Script ID | `1w-V1fijdqj-9EzvPQLvbhGMu38mgFI5L6EvVkJ0vLbz3v4fVEAxbUi25` |
| Spreadsheet(s) | `1jkGOTo4haveVCLb6puRPyNEG7rceMKtSXo7za76FBPY` (the bound request Sheet) |
| Drive folders by name | Attachments go in a folder named from the spreadsheet's parent folder and ending `MRN-SUBMISSIONS]`, unless `Attachment Folder ID` is set in Config. Each request gets its own sub-folder named by request ID. |
| Runs as | `automations@christwood.edu.in` — the account every app must run as; the deploy job refuses to deploy as anyone else |
| Execute as | Me (`USER_DEPLOYING` in `appsscript.json`), so the deploying account |
| Web app access | Anyone in the school domain (`DOMAIN` in `appsscript.json`) |
| Live deployment | `AKfycbydj4…XAxl97xTYB8dZBlng` |
| Live version | `8` (last read) |

The web app's `/exec` URL is not written here. The Projects Tracker row holds it.

## Data it touches

| Tab | Columns by header name | Who writes them |
|---|---|---|
| `Requests` | `Request ID`, `Timestamp`, `Staff Name`, `Staff Email`, `Department`, `Purpose`, `Stock in Hand`, `Total Items`, `Total Approximate Cost (₹)`, `Attachment URLs`, `Status`, `Submitted Date`, `Notes` | `submitRequest()` appends each row and sets `Status` to `Submitted`. No code changes `Status` after that. |
| `Items` | `Request ID`, `Item #`, `Item Description`, `Quantity`, `Unit`, `Approximate Cost per Unit (₹)`, `Total Cost (₹)` | `submitRequest()` appends one row per item. |
| `Config` | Label column B, value column C (for example `Prefix`, `Next Sequence Number`, `On Submission`) | Set by staff by hand. `getNextRequestId()` writes the `Next Sequence Number` value in column C. |
| `ImportHR` | Read by column letter, set in Config (`HR Column: Staff Name`, `HR Column: Department`, `HR Column: Email ID`). Defaults are C, J and N. | Staff paste an `IMPORTRANGE` into the HR database. The URL goes in cell B2. |

The `Requests` and `Items` tabs are created by `setupSheet()`. The code reads and
writes them by fixed column position, not by header name. See the footguns.

Drive holds the uploaded attachment files. Access on each file is set to
"anyone in the domain with the link, can view".

## Triggers

No trigger is created in code. There is no `ScriptApp.newTrigger` call and no
`installTriggers`-style function. The owner of any trigger set in the Apps
Script editor cannot be verified from code.

The code has two entry points that are not installable triggers:

- `doGet(e)` in `Code.js` serves the web app on each visit.
- `onOpen()` in `SetupSheet.js` adds the `Run Initial Setup` menu item when the
  Sheet opens.

## Config and secrets

No secrets are stored in this project. Settings live in the Config tab, not in
code. The labels below are the Config tab labels that `getConfig()` reads.

- Numbering: `Prefix`, `Academic Year Code`, `Separator`, `Next Sequence Number`,
  `Sequence Padding`
- Email lists: `On Submission`, `On Principal Approval`, `On Admin Head Approval`,
  `On CEO Approval`, `On Rejection`, `Allowed Guest Emails`
- Attachments: `Attachment Folder ID`, `Max File Size (MB)`, `Allowed File Types`
- Branding and text: `School Name`, `School Logo URL`, `Digital Signature Text`
- HR import columns: `HR Column: Staff Name`, `HR Column: Department`,
  `HR Column: Email ID`
- Viewer access: the `Department Roles` section, with department, emails and
  access level

## How to operate

Before a change:

1. Confirm the change is made in this directory. Do not edit in the Apps Script
   editor.
2. Check the Config tab values that the change depends on.

After a change:

1. Push the code from this directory and run `setupSheet()` from the Sheet menu
   if the tabs have changed. The setup is safe to re-run.
2. Deploy the web app as the automations account, with access set to the school
   domain.
3. Submit a test request from a test account, then check the `Requests` and
   `Items` rows, the attachment folder, and both emails.
4. Open the dashboard and print one request.

When a request looks wrong, check its row on the `Requests` tab first. Then check
its rows on the `Items` tab.

## Known footguns

- **`onPrincipalEmails` and `onRejectionEmails` are not wired.** The lookups
  exist, but nothing calls those stages. A configured address does not mean mail
  is sent for those stages. `On Admin Head Approval` and `On CEO Approval` are
  wired. They feed one approval email, sent to the combined list without
  duplicates.
- `submitRequest()` sends the two emails in **separate** try/catch blocks. A
  `MailApp` failure in one cannot suppress the other. Do not merge the two blocks
  back into one.
- The `Requests` and `Items` tabs are read and written by fixed column position
  (columns A to M and A to G). Inserting, moving or reordering a column breaks
  reads and writes without an error. This goes against the rule to locate
  columns by header name. Do not copy this pattern into a new project.
- The HR column settings (`HR Column: …`) hold column letters. They are still
  positional. They exist because the HR import's column order is outside this
  project's control.
- The request counter increments only when the `Next Sequence Number` label is
  found on the Config tab. If the label is missing or renamed, every submission
  gets the same request ID.
- `nextSeqNumRow: -1` is a sentinel meaning "not yet located". It is not a
  Config value.
- The Config tab is protected in warning-only mode. Editors see a warning but
  edits are not blocked.
- The setup alert tells the person to deploy with "Execute as: Me". That is the
  same setting as the automation rule only if the deployer is the automations
  account.

## Change history

2026-10-20 · T-T-508b · First draft written from the code

## Could not verify

- Who owns each trigger in the Apps Script editor. The code creates none.
- The real header names on the live `Requests`, `Items` and `Config` tabs. The
  names above come from the setup code.
- Whether the live `Config` values match the defaults in the code.
- Who has edit access to the Sheet, and who sees the Sheet's protected tabs.
- Who can open the web app, and whether the live access setting matches
  `DOMAIN`.
- The exact live deployment settings for version 8. The rule says the deployer is
  the automations account, but the deployment record was not read.
- Whether `Session.getActiveUser()` returns the signed-in user under this
  deployment. The code assumes it does for the form, and the Admin Head / CEO
  approval depends on the email being read.
- Who the Admin Head, CEO, Principal and viewers are, and their current
  addresses. These are held in Config and in the Projects Tracker row. They are
  not written in this public repo.
- Who uses the system and how often. Volumes and the date of first use are not in
  the code.
- Whether approval emails arrive. The code sends them but does not record
  delivery.
- Whether anything updates the `Status` column after submission. The code does
  not, so it is probably set by hand.
- The live `Next Sequence Number` value and whether its label is present.
- The steps used to deploy version 8, and who ran them.
- The owner and contact details for the project, which the Projects Tracker row
  holds.
