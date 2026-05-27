/**
 * Storehouse offramp module
 *
 * Factory function and barrel export. The Storehouse executor imports
 * getOfframpAdapter() and calls it once at startup to get the configured
 * adapter for the current environment.
 *
 * Usage:
 *   import { getOfframpAdapter } from "@/lib/offramp";
 *   const adapter = getOfframpAdapter();
 *   const quote = await adapter.quote({ usdcAmount: "100.000000", sourceAddress: "0x..." });
 *   const result = await adapter.initiate({ quote, sourceAddress: "0x..." });
 *
 * The active provider is controlled by the OFFRAMP_PROVIDER environment
 * variable. Set it in .env.local:
 *   OFFRAMP_PROVIDER=crossmint          # or coinbase_business
 *
 * Each provider also needs its own env vars (see adapter stubs for details):
 *   Crossmint:
 *     CROSSMINT_API_KEY
 *     CROSSMINT_BANK_ACCOUNT_ID         # from CSE
 *     CROSSMINT_RECEIPT_EMAIL
 *     CROSSMINT_BASE_URL                # https://staging.crossmint.com or production
 *   Coinbase Business:
 *     COINBASE_BUSINESS_API_KEY
 *     COINBASE_BUSINESS_BANK_ACCOUNT_ID
 *     COINBASE_BUSINESS_BASE_URL
 */

import type { OfframpAdapter } from "./adapter";
import { createCoinbaseBusinessAdapter } from "./adapters/coinbase-business";
import { createCrossmintAdapter } from "./adapters/crossmint";

export type { OfframpAdapter } from "./adapter";
export type {
  QuoteParams,
  InitiateParams,
  OfframpQuote,
  OfframpResult,
  OfframpStatus,
  OfframpStatusResult,
  HealthCheckResult,
} from "./types";
export { OfframpError, NotImplementedError } from "./types";

/**
 * Returns the configured OfframpAdapter for the current environment.
 * Reads OFFRAMP_PROVIDER and the corresponding provider env vars.
 * Throws at startup if required env vars are missing — fail fast,
 * not at first transaction.
 */
export function getOfframpAdapter(): OfframpAdapter {
  const provider = process.env.OFFRAMP_PROVIDER;

  switch (provider) {
    case "coinbase_business":
      return createCoinbaseBusinessAdapter({
        apiKey: process.env.COINBASE_BUSINESS_API_KEY ?? "",
        baseUrl:
          process.env.COINBASE_BUSINESS_BASE_URL ??
          "https://api.coinbase.com/api/v3/brokerage",
        bankAccountId: process.env.COINBASE_BUSINESS_BANK_ACCOUNT_ID ?? "",
      });

    case "crossmint":
      return createCrossmintAdapter({
        apiKey: process.env.CROSSMINT_API_KEY ?? "",
        baseUrl:
          process.env.CROSSMINT_BASE_URL ?? "https://staging.crossmint.com",
        bankAccountId: process.env.CROSSMINT_BANK_ACCOUNT_ID ?? "",
        receiptEmail: process.env.CROSSMINT_RECEIPT_EMAIL ?? "",
      });

    case undefined:
    case "":
      throw new Error(
        "OFFRAMP_PROVIDER is not set. " +
          "Add OFFRAMP_PROVIDER=crossmint (or coinbase_business) to .env.local."
      );

    default:
      throw new Error(
        `OFFRAMP_PROVIDER="${provider}" is not a recognized provider. ` +
          `Valid options: crossmint, coinbase_business`
      );
  }
}
