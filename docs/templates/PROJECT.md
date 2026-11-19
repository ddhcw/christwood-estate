# Example Project

<!-- guidance: Copy this file for each project and replace the dummy values. -->
**Slug:** `example-project`
**Org:** Christwood
**Category:** GAS Web App
**Status:** Draft
**Owner:** Example Owner
**Contact if broken:** example-owner@christwood.edu.in
**Tracker link:** https://tracker.example.test/exec?project=Example%20Project
**Repo:** `projects/example-project`
**Doc status:** Draft — not yet checked by a person

## What it is

<!-- guidance: State the project purpose in one short paragraph. -->
Example Project is a Google Apps Script project for a defined estate process.

## Who uses it

<!-- guidance: Name the user groups and their access level. -->
Estate staff use the project through its web app and spreadsheet.

## What it does

<!-- guidance: Describe the main user-visible actions and outputs. -->
It accepts requests, stores the resulting records, and provides status views.

## Bindings

<!-- guidance: Add one field group for each binding. Never include secret values. -->

| Binding field | Value |
|---|---|
| Script ID | `script-id-placeholder` |
| Spreadsheet(s) | Example Project Sheet |
| Drive folders by name | Example Project Files |
| Runs as | `automations@christwood.edu.in` — scheduled automation account |
| Execute as | User accessing the web app |
| Web app access | Anyone in Christwood |
| Live deployment | `abcdef…uvwxyz` |
| Live version | `1` |

## Data it touches

<!-- guidance: Record each tab, its columns by header name, and who writes them. -->
| Tab | Columns by header name | Who writes them |
|---|---|---|
| Requests | `Request ID`, `Status`, `Created at` | Staff and automation |

## Triggers

<!-- guidance: List function · schedule · owning account · manual twin. -->
| Function | Schedule | Owning account | Manual twin |
|---|---|---|---|
| `refreshStatus` | Daily at 06:00 | `automations@christwood.edu.in` | Run refresh from the admin menu |

## Config and secrets

<!-- guidance: List configuration key names only. Never put secret values here. -->
Configuration keys: `SPREADSHEET_ID`, `NOTIFICATION_GROUP`.

## How to operate

<!-- guidance: Give the normal runbook, including checks before and after a change. -->
Open the web app, review pending requests, and confirm the resulting status.

## Known footguns

<!-- guidance: Record easy-to-miss behaviour, limits, and repair paths. -->
- A status refresh does not repair malformed historical rows.
- Changes to column headers must be checked against every reader and writer.

## Change history

<!-- guidance: Add newest entries first in this format: yyyy-MM-dd · Ref/PR · one line. -->
2026-01-15 · T-000 · Initial project documentation.

## Could not verify

<!-- guidance: Record unknowns plainly, or write "None" after checking the project. -->
None.
