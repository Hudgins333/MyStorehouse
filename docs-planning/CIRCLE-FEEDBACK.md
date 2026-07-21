
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

### Follow-up (2026-07-20): same symptom, different cause — IP allowlisting

The identical failure chain reappeared after deploying to Netlify. This time the
key was not stale: it returned 200 from a local machine against both
`/v1/w3s/wallets` and the notifications publicKey endpoint, while the deployed
serverless function got `401 Unauthorized` on every publicKey fetch and
therefore returned 403 to every webhook.

Cause: the API key had an **IP allowlist** restricting it to a single address.
Serverless functions egress from rotating cloud IPs, so no request from the
deployment could ever authenticate.

This makes the diagnostic above unreliable for deployed environments — it
passes precisely when it shouldn't, because it runs from the allowlisted IP.
The key is valid; it is just not valid *from where the code runs*.

Suggested improvements, in addition to those above:
- When a request is rejected because of an IP allowlist, say so. `401 Invalid
  credentials` is indistinguishable from a rotated key and sends developers
  down the wrong path.
- Surface an IP-restriction warning in the Console when a key with an allowlist
  is used by a webhook subscriber, since webhook verification is inherently a
  server-side call from wherever the endpoint is hosted.

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
## Webhook connection test cannot pass an endpoint that verifies signatures

**Date:** July 20, 2026
**Environment:** Circle Console → Webhooks (Testnet), Next.js route handler on Netlify

### What happened

Registering a webhook subscription runs a connection test against the endpoint.
That test request arrives **unsigned** — no `x-circle-signature`, no
`x-circle-key-id`. An endpoint that verifies signatures correctly rejects it,
and Circle reports the subscription as failed.

The result is that implementing signature verification *properly* is what
prevents the subscription from activating. The only way through is to
special-case unsigned requests with a 200 while still verifying anything that
does carry a signature.

### Why it matters

The documented guidance is to verify signatures on every webhook. Following
that guidance breaks registration. A developer hits an opaque "NON 2XX / 403"
in the console with nothing indicating the probe was unsigned.

### Suggested improvements

- Sign the connection test with the same key used for real notifications, so a
  correct implementation passes unchanged.
- Failing that, document that the connection test is unsigned and show the
  expected handling.

---

## Webhook connection test does not tolerate serverless cold starts

**Date:** July 20, 2026
**Environment:** Circle Console → Webhooks (Testnet), Next.js route handler on Netlify Functions

### What happened

With the unsigned-probe case handled, the connection test still failed —
sometimes as `403`, once as *"We were not able to make a connection to the URL
specified, and received undefined."*

Function logs showed the request arriving, the signature verifying, and the
handler returning 200 on every attempt. The endpoint was working; Circle was
not seeing the response in time.

Measured round trips on the same endpoint:

- cold invocation: **~6.1s**
- warm invocation: **~0.33s**

Warming the endpoint with a request immediately before running the connection
test made it pass on the first try, and the subscription activated.

### Why it matters

Serverless is a common deployment target, and a cold start of several seconds
is normal — especially for a handler that must fetch Circle's public key over
the network before it can verify anything. The console reports this as an
endpoint failure, which sends developers debugging code that is already
correct. The two distinct error messages for what appears to be the same
timeout make it harder still.

### Suggested improvements

- Allow a longer timeout on the connection test, or retry once before failing.
- Surface the actual failure reason (timeout vs. non-2xx vs. connection
  refused) rather than collapsing them.
