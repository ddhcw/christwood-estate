# Best Practices — GAS Messaging & Posting

Distilled from: Google Chat DM Sender, Class Chat Broadcaster (chatmessages), Social Media Cross-Poster.

Three flavours of "send a message out": DMs to people (as the user), broadcast to Chat spaces (webhooks), and publish to external social platforms. Shared patterns below.

## Pick the right delivery mechanism
- **DM to a person:** use the **Chat API as the authorising user** so the message comes from a real human, not a bot — this removes the "user must message the bot first" friction that breaks most Chat automations. Requires a user-linked GCP project + Chat API enabled (paid Workspace only). (chat-dm)
- **Broadcast to a space:** use **incoming webhooks**, one per space, resolved from a **webhook-map kept as data** (a tab/CSV keyed by class/section). Adding a recipient is a config row. (chatmessages)
- **External platforms:** one **adapter module per platform** (Facebook/Instagram/LinkedIn/GBP), each encapsulating that API's auth and payload quirks. (social-media-poster)

## Reliability
- **Rate-limit bulk sends** to stay under API quotas — make it configurable and treat it as load-bearing, especially when sending as a real user whose quota/reputation is at stake. (chat-dm)
- **Status state machine** for queued sends: `DRAFT → READY → POSTING → POSTED / ERROR / SCHEDULED`, with **per-target result columns** so partial success is visible (FB posted, IG failed). (social-media-poster)
- **Idempotency on retry** — re-running the queue must not double-post; key on a sent-flag/result per target.
- **Log every send** back to the row with status (colour-coded) + acting user.

## Consistency & failure handling *(added 2026-07 — see Estate-Wide Addendum)*
- **One Chat card template estate-wide:** header with system name + emoji, key-value sections, one button deep-linking to the exact row/app view — six-plus systems post to Chat; make them recognisable at a glance.
- **Retry with exponential backoff + jitter** before marking a target `ERROR`; distinguish retryable (5xx, rate-limit) from permanent (bad token) failures.
- Failed queue runs post to the admin **Ops Alerts** space — a broken poster should never fail silently for a week.
- Know the ceilings: UrlFetch ~20k/day, email ~1,500/day; log send counts when a job runs near them.

## Triggers
- Install triggers **programmatically, clearing existing ones first**; expose via a Setup menu. Combine an installable `onEdit` (send-on-ready) with a daily time trigger (digest/batch). (chatmessages)

## Structure
- **Service-object / module-per-concern split** keeps these readable: `WebhookManager`, `MessageSender`, `LoggerService`, or one poster file per platform. The `Code.gs` handlers should be thin and delegate.

## Security
- **Webhook URLs and OAuth tokens are credentials.** Keep webhook-map sheets access-controlled; store platform tokens in **Script Properties**, never source; plan for **token refresh/expiry** (the most common failure for the social poster).

## Productisation note
`chat-dm` is the model for shipping a GAS tool publicly: MIT licence, full setup README, service-split code, rate limiting, audit log, git history. Reuse that packaging standard for anything you want to open-source or show externally.
