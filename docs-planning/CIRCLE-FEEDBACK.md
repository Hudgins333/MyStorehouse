# Circle Product Feedback — Building Storehouse on arc-commerce

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
