/**
 * Coinbase Business off-ramp adapter (stub)
 *
 * Status: NOT IMPLEMENTED
 * The sandbox has been validated (account in good standing, API surface
 * understood). Full implementation pending v1 partner decision by May 29.
 * This adapter is the validated fallback rail — if Crossmint CSE does not
 * respond with a workable bankAccountId path by May 29, this becomes v1.
 *
 * Implementation notes for when this stub gets filled in:
 *   - Base URL (sandbox): process.env.COINBASE_BUSINESS_BASE_URL
 *   - Auth: Bearer token using process.env.COINBASE_BUSINESS_API_KEY
 *   - Quote endpoint: GET /v1/conversions/quote
 *   - Initiate endpoint: POST /v1/conversions
 *   - Status endpoint: GET /v1/conversions/:id
 *   - Bank account registered via Coinbase Business dashboard
 *     (store the ID in process.env.COINBASE_BUSINESS_BANK_ACCOUNT_ID)
 *
 * TODO(coinbase-business): implement all four methods after partner decision
 */

import type {
  QuoteParams,
  InitiateParams,
  OfframpQuote,
  OfframpResult,
  OfframpStatusResult,
  HealthCheckResult,
  CoinbaseBusinessConfig,
} from "../types";
import { NotImplementedError } from "../types";
import type { OfframpAdapter } from "../adapter";

export function createCoinbaseBusinessAdapter(
  config: CoinbaseBusinessConfig
): OfframpAdapter {
  // Validate config at construction time so startup probes catch
  // missing env vars immediately rather than at first transaction
  if (!config.apiKey) {
    throw new Error(
      "CoinbaseBusinessAdapter: apiKey is required. " +
        "Set COINBASE_BUSINESS_API_KEY in your environment."
    );
  }
  if (!config.bankAccountId) {
    throw new Error(
      "CoinbaseBusinessAdapter: bankAccountId is required. " +
        "Set COINBASE_BUSINESS_BANK_ACCOUNT_ID in your environment."
    );
  }

  return {
    provider: "coinbase_business",

    async quote(_params: QuoteParams): Promise<OfframpQuote> {
      // TODO(coinbase-business): implement quote
      // GET ${config.baseUrl}/v1/conversions/quote
      // with amount, source_currency: "USDC", target_currency: "USD"
      throw new NotImplementedError("CoinbaseBusinessAdapter", "quote");
    },

    async initiate(_params: InitiateParams): Promise<OfframpResult> {
      // TODO(coinbase-business): implement initiate
      // POST ${config.baseUrl}/v1/conversions
      // with quote_id, source_wallet_id, destination_account_id
      throw new NotImplementedError("CoinbaseBusinessAdapter", "initiate");
    },

    async getStatus(
      _providerTransactionId: string
    ): Promise<OfframpStatusResult> {
      // TODO(coinbase-business): implement getStatus
      // GET ${config.baseUrl}/v1/conversions/${providerTransactionId}
      // Map Coinbase status strings to OfframpStatus enum
      throw new NotImplementedError("CoinbaseBusinessAdapter", "getStatus");
    },

    async healthCheck(): Promise<HealthCheckResult> {
      // TODO(coinbase-business): implement healthCheck
      // Ping GET ${config.baseUrl}/v1/ping or equivalent no-op endpoint
      return {
        ok: false,
        reason: "CoinbaseBusinessAdapter is not yet implemented",
        provider: "coinbase_business",
      };
    },
  };
}
