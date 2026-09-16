# Best Practices — Websites

Distilled from: Anita Methodist School Website (Next.js + Sanity + Vercel, with a legacy Sheets→GitHub CMS) and the One Way attendance architecture/PWA.

Two different things live here — a content website and a web-app architecture — but they share a stack lineage (Next.js / Vercel / PWA) and a few hard-won lessons.

## Content sites
- **Headless CMS over hand-rolled.** The Anita site started as Sheets-as-CMS (smart for the budget/skill constraint) and matured to **Sanity**. Once the stack can support it, prefer a real CMS to a custom token-pushing pipeline — same "non-dev editing" benefit, far less to maintain and secure.
- **Next.js App Router + one folder per page**; render CMS content via Portable Text; serve images through the CMS CDN rather than committing thousands of files to the repo.
- **Migrations: preserve old URLs.** The WP→Next.js move kept `/images/uploads/YYYY/...` paths so existing image links didn't break. Prune unreferenced assets afterward.
- **Pick one styling system.** The Anita app carries both Tailwind and styled-components — consolidate to cut bundle weight and cognitive load.

## Web apps (architecture)
- **Choose infrastructure by load profile, not familiarity.** The One Way doc's central move: the live transactional path (100+ check-ins in 15 min) must **not** touch Google Sheets, because `LockService` serialises writes and they time out. Use a concurrent store (Firestore) for live writes; demote Sheets to a **scheduled reporting layer**.
- **De-risk the riskiest assumption first.** Before building the backend, ship a throwaway PWA that proves the one thing that could sink the project (camera auto-capture on the oldest staff phone). Cheapest possible proof, then commit.
- **Honest threat modelling.** Layer anti-cheat (geofence + IP + selfie + device fingerprint) and call it "harder to fake than to do honestly," not bulletproof. Hash PINs, never store plaintext.
- **Know the free-tier traps** (e.g. Firebase phone/SMS OTP is *not* free) and write them down so nobody reaches for them later.

## PWA specifics
- `manifest.webmanifest` + service worker for installability and an offline shell; test **launched-from-home-screen (standalone)**, not just the browser tab.
- `getUserMedia` requires **HTTPS** — serve from a real URL even for tests.
- Validate on the **oldest/weakest target device**, and avoid on-device ML where a freeze would kill UX (a timed countdown beat face-detection).

## Polish & operations *(added 2026-07 — see Estate-Wide Addendum)*
- **Source colours/fonts from the shared brand kit** (`brand.json` → CSS variables / Tailwind theme) so the website matches the report cards, decks and web apps without hand-copying hexes.
- **Run Lighthouse before shipping** — budget: 90+ performance/accessibility on mobile; CMS-CDN image params (width, format) do most of the work.
- **Uptime + error monitoring:** a free uptime check on the public site and error reporting (Vercel/Sentry) routed to the admin Ops Alerts space — parents finding the site down should never be the alerting mechanism.

## Security
- Keep `.env.local` and all tokens out of version control; confirm `.gitignore` covers them. Never embed a GitHub/CMS/API token in client or committed code (the legacy Sheets-CMS stored a GitHub token in the script — the pattern to retire).
