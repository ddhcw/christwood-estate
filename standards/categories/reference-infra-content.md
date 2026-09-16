# Conventions — Reference: Infra, Content & Reports

These folders aren't software (infrastructure inventories, curriculum content corpora, reports & decks, and occasional empty placeholders). No engineering best-practices apply, but a few documentation/organisation conventions are worth keeping consistent — they make this material reusable as inputs to the software projects.

## Infrastructure
- Keep the **inventory-as-CSV + written setup guide + phased action plan** triad. It's a clean, reusable playbook for any new campus, relocation, or migration.
- One file = one concern (network inventory, action plan, floor plan). Date-stamp plans.

## Content corpora (curriculum, syllabus material)
- Watch for **misleading folder names** — rename folders so they don't mislead readers about what's actually inside.
- Treat curriculum corpora as a **machine-readable asset**, not just reading material — a spiral curriculum map + clean Markdown of a syllabus is a potential RAG / lesson-planning input.
- Keep **consistent naming by grade / subject / term**; that structure is what makes it programmatically useful.

## Reports & presentations
- The transferable habit: **author once in Markdown, export to many formats** (DOCX / PDF / HTML). One source of truth, no divergent copies.
- Treat `.pptx` as inspectable OOXML when you need to mine or template slide content — but **delete bulky `extracted/` XML trees** once they've served their purpose.

## Brand kit *(added 2026-07 — see Estate-Wide Addendum)*
- If a palette/brand only lives inside one deck-generation script, **lift it into a canonical `brand.json`** (colours, fonts, logo paths) kept centrally, and make decks, report cards, web apps and the website consume it — one source of visual truth, same as the Markdown-once-export-many rule for text.

## Empty / placeholder folders
- Either delete them or leave a one-line `README.md` stating intent and cross-references, so nobody wonders later whether something was lost.

## General
- A `[BRACKETED TAG]` filename convention (e.g. `[ZAMAR]`, `[REPORTS TRUST 2026 …]`) makes files self-describing and sortable across an org's shared drive. Worth keeping wherever it's already in use.
