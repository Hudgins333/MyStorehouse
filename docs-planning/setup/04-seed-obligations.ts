/**
 * Storehouse seed: obligations + buckets
 *
 * Inserts the 5 core obligations and their corresponding wallet buckets
 * into Supabase. Safe to run multiple times — uses upsert on obligation
 * name so duplicates are ignored.
 *
 * Usage:
 *   npx tsx docs-planning/setup/04-seed-obligations.ts
 *
 * Requirements:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local
 *   - Fill in the WALLET ADDRESSES section below before running
 *   - The 5 Circle wallets must already exist on Arc Testnet (they do as of May 16)
 *
 * After running:
 *   - Verify in Supabase Table Editor: obligations (5 rows) and buckets (5 rows)
 *   - The car_payment obligation uses a placeholder destination_address
 *     until the offramp partner (Crossmint or Coinbase Business) is finalized
 */

import { config } from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// Load env before anything else
config({ path: path.resolve(process.cwd(), ".env.local") });

// Create admin client inline so env is already loaded
const supabaseAdminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
);
// ---------------------------------------------------------------------------
// WALLET ADDRESSES — fill these in before running
// From 1Password: "Storehouse Wallets — Arc Testnet"
// ---------------------------------------------------------------------------

const WALLETS = {
  tithe:      "0x4e570076026c7636fc5bb32bab192a457c2a52df",
  taxEscrow:  "0x3f5dc29c0b824d5740a5053f4f8420a4d08551d0S",
  savings:    "0x93f1e2d244b2005354674949e7c56bd2606fe6d3",
  operating:  "0xa54dad10836b82667d2e357b01df5944ebe0d624",
  // Car payment routes via offramp — fiat destination, not an onchain wallet.
  // Use a placeholder until partner decision is finalized (by May 29).
  // Update this to the real bank account reference after partner onboards.
  carPayment: "OFFRAMP_DESTINATION_PENDING_PARTNER_DECISION",
};

// ---------------------------------------------------------------------------
// Obligation definitions
// ---------------------------------------------------------------------------

const OBLIGATIONS = [
  {
    name: "Tithe",
    type: "percentage",
    amount: 0.10,                          // 10% of every inbound
    destination_address: WALLETS.tithe,
    destination_label: "Grace Community Church",
    destination_type: "onchain",
    due_recurrence: null,
    priority: 1,                           // first fruits — always first
    current_period_target: null,
    current_period_filled: 0,
  },
  {
    name: "Tax Escrow",
    type: "percentage",
    amount: 0.25,                          // 25% set aside for taxes
    destination_address: WALLETS.taxEscrow,
    destination_label: "Tax escrow",
    destination_type: "onchain",
    due_recurrence: "quarterly",
    priority: 2,
    current_period_target: null,
    current_period_filled: 0,
  },
  {
    name: "Savings",
    type: "percentage",
    amount: 0.10,                          // 10% to savings
    destination_address: WALLETS.savings,
    destination_label: "Emergency fund",
    destination_type: "onchain",
    due_recurrence: null,
    priority: 3,
    current_period_target: null,
    current_period_filled: 0,
  },
  {
    name: "Car Payment",
    type: "fixed",
    amount: 450.00,                        // fixed monthly obligation
    destination_address: WALLETS.carPayment,
    destination_label: "Car loan servicer",
    destination_type: "fiat_offramp",      // this is the fiat leg
    due_recurrence: "monthly",
    priority: 4,
    current_period_target: 450.00,
    current_period_filled: 0,
  },
  {
    name: "Operating",
    type: "percentage",
    amount: null,                          // remainder after all above
    destination_address: WALLETS.operating,
    destination_label: "Operating",
    destination_type: "onchain",
    due_recurrence: null,
    priority: 5,                           // lowest — gets whatever's left
    current_period_target: null,
    current_period_filled: 0,
  },
] as const;

// ---------------------------------------------------------------------------
// Bucket definitions (wallet + obligation linkage)
// ---------------------------------------------------------------------------

// Bucket names map 1:1 to obligation names for clarity
const BUCKET_NAMES: Record<string, string> = {
  "Tithe":       "tithe",
  "Tax Escrow":  "tax-escrow",
  "Savings":     "savings",
  "Car Payment": "car-payment",
  "Operating":   "operating",
};

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function seed() {
  console.log("Storehouse seed: obligations + buckets");
  console.log("---------------------------------------");

  // Safety check: fail fast if wallets haven't been filled in
  const unfilled = Object.entries(WALLETS).filter(([, v]) =>
    v.startsWith("REPLACE_WITH") || v.startsWith("OFFRAMP_DESTINATION_PENDING")
  );

  if (unfilled.length > 0) {
    const names = unfilled.map(([k]) => k).join(", ");
    console.warn(`\nWARNING: The following wallet addresses are still placeholders: ${names}`);
    console.warn("Fill them in from 1Password before running this script.");
    console.warn("Continuing with placeholders — update after partner decision.\n");
  }

  // ---------------------------------------------------------------------------
  // Upsert obligations (on conflict: name -> update fields)
  // ---------------------------------------------------------------------------

  console.log("Upserting obligations...");

  const { data: obligations, error: obligationsError } = await supabaseAdminClient
    .from("obligations")
    .upsert(
      OBLIGATIONS.map((o) => ({
        ...o,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
      {
        onConflict: "name",
        ignoreDuplicates: false,           // update existing rows if name matches
      }
    )
    .select("id, name, type, amount, priority, destination_type");

  if (obligationsError) {
    console.error("Failed to upsert obligations:", obligationsError.message);
    process.exit(1);
  }

  console.log(`✓ ${obligations?.length ?? 0} obligations upserted:`);
  obligations?.forEach((o) => {
    console.log(
      `  [${o.priority}] ${o.name} (${o.type}${o.amount ? ` — ${o.type === "percentage" ? `${(o.amount * 100).toFixed(0)}%` : `$${o.amount}`}` : " — remainder"}) ${o.destination_type === "fiat_offramp" ? "→ FIAT" : "→ ONCHAIN"}`
    );
  });

  // ---------------------------------------------------------------------------
  // Upsert buckets (one per obligation)
  // ---------------------------------------------------------------------------

  console.log("\nUpserting buckets...");

  const buckets = obligations?.map((obligation) => ({
    name: BUCKET_NAMES[obligation.name] ?? obligation.name.toLowerCase(),
    obligation_id: obligation.id,
    wallet_address:
      OBLIGATIONS.find((o) => o.name === obligation.name)
        ?.destination_address ?? "",
    current_balance: 0,
    target_balance:
      obligation.type === "fixed" ? obligation.amount : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  if (!buckets?.length) {
    console.error("No obligations returned — cannot create buckets.");
    process.exit(1);
  }

  const { data: insertedBuckets, error: bucketsError } = await supabaseAdminClient
    .from("buckets")
    .upsert(buckets, {
      onConflict: "obligation_id",
      ignoreDuplicates: false,
    })
    .select("id, name, obligation_id, wallet_address");

  if (bucketsError) {
    console.error("Failed to upsert buckets:", bucketsError.message);
    process.exit(1);
  }

  console.log(`✓ ${insertedBuckets?.length ?? 0} buckets upserted:`);
  insertedBuckets?.forEach((b) => {
    const addr = b.wallet_address;
    const display =
      addr.startsWith("REPLACE_WITH") || addr.startsWith("OFFRAMP")
        ? `[PLACEHOLDER]`
        : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    console.log(`  ${b.name} → ${display}`);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  console.log("\n---------------------------------------");
  console.log("Seed complete. Verify in Supabase Table Editor:");
  console.log("  obligations: 5 rows, priorities 1-5");
  console.log("  buckets: 5 rows, one per obligation");

  if (unfilled.length > 0) {
    console.log("\nTODO: Update placeholder wallet addresses once:");
    console.log("  - Offramp partner decision finalized (by May 29)");
    console.log("  - Re-run this script to update the car_payment destination");
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
