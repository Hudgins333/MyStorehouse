
# Circle Product Feedback — Building Storehouse on arc-commerce

## Webhook signature verification fails opaquely when API key is invalid/rotated

**Severity:** High (silent failure, hard to diagnose)
**Date:** 2026-06-10
**Environment:** Arc Testnet, Developer-Controlled Wallets, webhook notifications

### What happened

Every inbound webhook delivery began failing with `Non-2XX status code (4XX)`
in the Circle Console's webhook log. The endpoint was returning 403 because
signature verification failed. Root cause was several layers down: the
signature-verification step fetches Circle's notification public key via
`GET /v2/notifications/publicKey/{keyId}` using the account API key as a bearer
token, and that fetch was returning `401 {"code":401,"message":"Invalid
credentials."}`. The API key in use had become invalid (rotated/stale).

### Why it was hard to diagnose

The failure surfaces three layers removed from its cause, and each layer hides
the one below it:

1. Console webhook log shows only `Non-2XX status code (4XX)` — no indication
   the cause is an auth failure on a *separate* Circle API call.
2. The handler returns 403 "signature verification failed" — which points at
   the signature/payload, not at credentials.
3. The actual error (`401 Invalid credentials` on the publicKey fetch) is only
   visible if you log the response *body* — `response.statusText` alone just
   says "Unauthorized".

Compounding it: the same API key still returned non-401 responses on wallet
endpoints (a wrong *path* on `/v1/w3s/wallets` returned 404, i.e. auth passed),
and the developer-controlled-wallets SDK continued to authenticate, so the key
appeared valid everywhere except the notifications service. This strongly
suggests inbound transfers "worked recently" while webhook verification was
already broken — masking the regression.

### Suggested improvements

- When `GET /v2/notifications/publicKey/{keyId}` rejects the credential, return
  a more specific error than `401 Invalid credentials` (e.g. distinguish
  "key not found / rotated" from "key lacks notifications access").
- Surface the downstream HTTP status/body in the Console webhook-delivery log,
  or at minimum a hint that delivery failures may stem from the subscriber's
  own outbound call to Circle's publicKey endpoint.
- Document clearly that webhook signature verification depends on a *live* API
  key for the publicKey fetch — so a rotated key breaks webhooks even though
  wallet operations may still appear to function.

### Workaround / diagnostic

Test the API key directly against a known endpoint rather than trusting that
"wallets work":
`fetch("https://api.circle.com/v1/w3s/wallets?pageSize=1", { headers: { Authorization: ` + "`Bearer ${CIRCLE_API_KEY}`" + ` }})`
— a 200 confirms the key is valid for the account; a 401 means rotate/replace it.

---

## Outbound transaction notifications fire for every lifecycle state, not just terminal

**Severity:** Low (design note, not a bug)
**Date:** 2026-06-10
**Environment:** Arc Testnet, Developer-Controlled Wallets

### Observation

A single outbound transfer emits a `transactions.outbound` notification at
*each* lifecycle state: `QUEUED → SENT → CLEARED → COMPLETE`. A batch of 4
routing transfers therefore produces ~16 outbound notifications, plus inbound
notifications on each receiving (bucket) wallet. The `notification.id` is stable
across all states for a given transfer, and `notification.state` carries the
current stage.

### Implication for subscribers

Confirmation logic must filter on `state === "COMPLETE"` (or the relevant
terminal state) and be idempotent — Circle re-delivers, and the multi-state
stream means a naive "on any outbound notification, credit" would over-count.
This is reasonable behavior; flagging it because the volume and the need to
filter aren't obvious until you observe the stream. Documenting the canonical
state machine and which states are terminal would help subscribers build
correct handlers on the first try.
## Issue: Migration silently fails but reports success

**Date:** May 16, 2026
**Context:** Setting up upstream arc-commerce fork with remote Supabase project
**Severity:** Blocks first-run experience

### What happened

Ran `npx supabase db push` against a fresh remote Supabase project. All 27 migrations reported as applied successfully. `npx supabase migration list` shows Local matches Remote for all entries.

However, the `platform_config` table from migration `20250929103004_create_platform_config_table.sql` does not exist in the public schema. The app's `runPlatformInitialization` check fails with `PGRST125: Invalid path specified in request URL` on every page load.

### Impact

First-run experience is broken. Without intervention, a developer following the README cannot proceed past the homepage. The error message (`PGRST125`) does not indicate which table is missing, making it hard to diagnose.

### Likely cause

Migration body references `public.handle_updated_at()` in the trigger creation. If that function does not yet exist when this migration runs, the migration likely partially fails — table creation may succeed before the trigger creation fails silently, or the entire migration is rolled back but the tracker still marks it applied.

### Recommendation

1. Ensure `handle_updated_at` function is created in an early migration, before any migration that uses it as a trigger
2. Better error messages on platform initialization failure — at minimum, log which table query failed
3. Add a "first-run verification" step to README that checks expected tables exist after `db push`

## Issue: NEXT_PUBLIC_SUPABASE_URL must be base URL only

**Date:** May 26, 2026
**Context:** Running seed script against Storehouse-v1 Supabase project
**Severity:** Blocks all Supabase API calls silently

### What happened

The `NEXT_PUBLIC_SUPABASE_URL` environment variable had `/rest/v1/` appended
to the base project URL. The Supabase JS client constructs the REST path
internally, so the effective URL became `.supabase.co/rest/v1//rest/v1/`
(double path), causing every API call to fail with "Invalid path specified
in request URL" — the same PGRST125 error pattern as Issue 1.

### Impact

All Supabase client calls fail. Error message does not indicate the URL is
malformed — it presents as a PostgREST path error, making it hard to
diagnose without inspecting the raw URL.

### Fix

Set NEXT_PUBLIC_SUPABASE_URL to the base project URL only:
  NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co

Do not append /rest/v1/, /auth/v1/, or any path suffix.

### Recommendation

Add URL validation to the Supabase client initialization that checks for
and warns on trailing path segments. A simple check for '/rest' or '/auth'
in the URL before client creation would catch this immediately.

## App Kit Swap: cirBTC documented + faucetable on Arc Testnet, but no swap route

**Severity:** Medium (documented capability not deployable)
**Date:** 2026-06-13
**Environment:** Arc Testnet, App Kit Swap (`@circle-fin/app-kit` + `@circle-fin/adapter-circle-wallets`), Developer-Controlled Wallets

### What happened

App Kit Swap docs state: "Among testnets, only Arc Testnet supports Swap
(USDC, EURC, and cirBTC only)." cirBTC is also claimable from the Circle
faucet. However, `estimateSwap` for USDC -> cirBTC on Arc Testnet fails with:

INPUT_UNSUPPORTED_ROUTE (code 331001): "No route available"

The same call signing through the same Circle developer-controlled wallet on
the same chain succeeds for USDC -> EURC, returning a valid quote
(estimatedOutput, stopLimit, itemized provider + gas fees). So the failure is
specific to the cirBTC route, not the integration, wallet, chain, or kit setup.

### Controlled comparison (same wallet, same chain, same call)

- USDC -> EURC: ✓ quote returned (e.g. 0.10 USDC -> ~0.0989 EURC)
- USDC -> cirBTC: ✗ 331001 "No route available"

### Why it matters

cirBTC is documented as a supported Arc Testnet swap token and is faucetable,
which signals to developers that USDC<->cirBTC swaps are available. They are
not currently routable via the Stablecoin Service. This is a gap between
documented/faucetable capability and deployed routing — a developer building
against cirBTC would only discover it at swap time.

### Suggested improvements

- Either enable the USDC<->cirBTC route on Arc Testnet, or update the Swap docs
  to note cirBTC routing is not yet live on testnet.
- Where a token is faucetable but not yet swap-routable, surface that distinction
  (the faucet implies more capability than currently exists).

### Repro

`scripts/swap-probe.ts` in this repo runs `estimateSwap` for a configurable
`tokenOut` on Arc Testnet via a Circle-wallets adapter. Set tokenOut to "cirBTC"
to reproduce the 331001; "EURC" returns a valid quote.