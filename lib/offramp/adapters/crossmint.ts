/**
 * Crossmint off-ramp adapter (stub)
 *
 * Status: NOT IMPLEMENTED
 * Staging API has been verified: self-serve signup confirmed, server-side
 * API key in hand, POST /api/2022-06-09/orders endpoint open to our key.
 * Validation confirmed: Base Sepolia accepted as source chain; Arc rejected
 * at the enum level (architectural path: Arc -> CCTP V2 -> Base Sepolia ->
 * this adapter). Bank account registration (bankAccountId) is pending CSE
 * response to email sent May 24. Full implementation pending that response
 * and the v1 partner decision by May 29.
 *
 * Implementation notes for when this stub gets filled in:
 *   - Staging base URL: https://staging.crossmint.com
 *   - Production base URL: https://www.crossmint.com
 *   - Auth: x-api-key header using process.env.CROSSMINT_API_KEY
 *   - Orders endpoint: POST /api/2022-06-09/orders
 *   - Status endpoint: GET /api/2022-06-09/orders/:id
 *   - bankAccountId obtained from Crossmint CSE (one-time setup per
 *     registered bank account; not self-serve via API or console)
 *     Store in process.env.CROSSMINT_BANK_ACCOUNT_ID
 *   - receiptEmail is REQUIRED by Crossmint's validator
 *     (undocumented in their llm.txt; discovered via live API test May 24)
 *
 * Crossmint bundles quote + initiate into a single Create Order call.
 * The quote() method here will call the orders endpoint in "dry run" mode
 * if available, or return a synthetic quote from the line items response.
 * Confirm with Crossmint CSE whether a separate quote endpoint exists.
 *
 * Request body shape (verified against staging):
 * {
 *   payment: {
 *     method: "base-sepolia",        // source chain
 *     currency: "usdc",
 *     payerAddress: "<sourceAddress>",
 *     receiptEmail: "<receiptEmail>"
 *   },
 *   recipient: {
 *     bankAccountId: "<bankAccountId>"
 *   },
 *   lineItems: [{
 *     currencyLocator: "fiat:usd",
 *     executionParameters: {
 *       mode: "exact-in",
 *       amount: "<usdcAmount>"
 *     }
 *   }]
 * }
 *
 * TODO(crossmint): implement all four methods after CSE responds with
 *   bankAccountId and partner decision is finalized
 */

import type {
  QuoteParams,
  InitiateParams,
  OfframpQuote,
  OfframpResult,
  OfframpStatusResult,
  HealthCheckResult,
  CrossmintConfig,
} from "../types";
import { NotImplementedError } from "../types";
import type { OfframpAdapter } from "../adapter";

export function createCrossmintAdapter(
  config: CrossmintConfig
): OfframpAdapter {
  if (!config.apiKey) {
    throw new Error(
      "CrossmintAdapter: apiKey is required. " +
        "Set CROSSMINT_API_KEY in your environment."
    );
  }
  if (!config.bankAccountId) {
    throw new Error(
      "CrossmintAdapter: bankAccountId is required. " +
        "Obtain from Crossmint CSE and set CROSSMINT_BANK_ACCOUNT_ID."
    );
  }
  if (!config.receiptEmail) {
    throw new Error(
      "CrossmintAdapter: receiptEmail is required by Crossmint's API. " +
        "Set CROSSMINT_RECEIPT_EMAIL in your environment."
    );
  }

  return {
    provider: "crossmint",

    async quote(_params: QuoteParams): Promise<OfframpQuote> {
      // TODO(crossmint): implement quote
      // Crossmint may bundle quote+initiate. Confirm with CSE whether
      // a dry-run or quote-only mode exists on POST /api/2022-06-09/orders.
      // If not, derive a synthetic quote from the lineItems pricing.
      throw new NotImplementedError("CrossmintAdapter", "quote");
    },

    async initiate(_params: InitiateParams): Promise<OfframpResult> {
      // TODO(crossmint): implement initiate
      // POST ${config.baseUrl}/api/2022-06-09/orders
      // Headers: { "x-api-key": config.apiKey, "Content-Type": "application/json" }
      // Body: see request body shape in file header above
      // Response: { orderId, status, ... } — map to OfframpResult
      throw new NotImplementedError("CrossmintAdapter", "initiate");
    },

    async getStatus(
      _providerTransactionId: string
    ): Promise<OfframpStatusResult> {
      // TODO(crossmint): implement getStatus
      // GET ${config.baseUrl}/api/2022-06-09/orders/${providerTransactionId}
      // Headers: { "x-api-key": config.apiKey }
      // Map Crossmint order status to OfframpStatus enum:
      //   "pending"    -> "initiated"
      //   "processing" -> "processing"
      //   "completed"  -> "settled"
      //   "failed"     -> "failed"
      throw new NotImplementedError("CrossmintAdapter", "getStatus");
    },

    async healthCheck(): Promise<HealthCheckResult> {
      // TODO(crossmint): implement healthCheck
      // Try GET ${config.baseUrl}/api/2022-06-09/orders with the API key
      // A 200 or 401 both confirm the endpoint is reachable
      // (401 means key is wrong but provider is up)
      return {
        ok: false,
        reason: "CrossmintAdapter is not yet implemented",
        provider: "crossmint",
      };
    },
  };
}
