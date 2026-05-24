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
