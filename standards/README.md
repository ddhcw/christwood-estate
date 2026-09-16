# _standards — how this folder works

Shared across all contexts: Christwood, Anita Methodist, Good Shepherd (both schools), Personal.

## Files

| File | Layer | When Claude should read it |
|---|---|---|
| `project-shipping-standards.md` | Process — git, tracking, handover, feedback loops | Every conversation, as the default frame |
| `estate-wide-best-practices.md` | Technical — visual/efficiency/robustness patterns that cut across all categories | Every conversation, alongside the above |
| `category-router.md` | Router | Read first to decide which single file in `categories/` applies |
| `categories/*.md` | Category-specific technical detail | Only the one matching the task — not all nine |
| `writing-style-skill.md` | Voice/tone | When drafting anything in your voice (docs, emails, posts) — *not yet added to this folder, add your existing file here* |

## How to use in a new conversation

**In a Claude.ai Project with these files as knowledge:** just state the task. Say which org if it's not obvious ("this is for Good Shepherd").

**In plain chat, files attached manually:** something like —
> "Attached: shipping standards + estate-wide best practices + [category] file for [task]. Org: [X]."

You don't need to attach all 9 category files ever — just the router's job is to tell you (or Claude) which one.

## Note on scope

`project-shipping-standards.md` was written to be org-agnostic (uses an `{ORG}` variable). `estate-wide-best-practices.md`, `category-router.md`, and the 9 `categories/*.md` files were originally written for the Anita Methodist / AG Schools estate — the patterns and non-negotiables generalise cleanly to Christwood, Good Shepherd, and Personal projects, but example project names (MMS v2, Christwood bridge, etc.) are specific to that estate's history. Treat them as reference examples, not something every org needs to replicate.
