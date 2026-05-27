/**
 * Storehouse OfframpAdapter interface
 *
 * Partner-agnostic abstraction for USDC -> fiat ACH off-ramp operations.
 * The Storehouse executor calls this interface; concrete implementations
 * live in adapters/coinbase-business.ts and adapters/crossmint.ts.
 *
 * Calling convention:
 *   1. quote()    — get a price quote before committing
 *   2. initiate() — execute the off-ramp using the quote
 *   3. getStatus() — poll until status is 'settled' or 'failed'
 *
 * The architectural path for v1:
 *   Arc treasury wallet
 *     -> CCTP V2 -> Base Sepolia (USDC arrives at sourceAddress)
 *     -> adapter.quote() / adapter.initiate()
 *     -> fiat ACH to registered bank account
 *
 * See lib/offramp/types.ts for all input/output types.
 */

import type {
  QuoteParams,
  InitiateParams,
  OfframpQuote,
  OfframpResult,
  OfframpStatusResult,
  HealthCheckResult,
} from "./types";

export interface OfframpAdapter {
  /**
   * The provider identifier stored in offramp_transactions.provider.
   * One of: 'coinbase_business' | 'crossmint'
   */
  readonly provider: string;

  /**
   * Get a price quote before committing to an off-ramp.
   *
   * Called by the routing agent before the off-ramp leg executes.
   * The returned quote.quoteId may be required by initiate() — pass
   * the full quote object through rather than extracting fields.
   *
   * @throws OfframpError with kind 'rate_limit' if the provider is
   *   throttling quote requests (retryable: true)
   * @throws OfframpError with kind 'provider_error' for unexpected failures
   */
  quote(params: QuoteParams): Promise<OfframpQuote>;

  /**
   * Execute the off-ramp transaction.
   *
   * Debits USDC from params.quote.sourceAddress and initiates ACH
   * transfer to the adapter's registered bank account. Returns
   * immediately with a providerTransactionId for status polling.
   *
   * Note: some providers (Crossmint) bundle quote + initiate into
   * a single API call. Those adapters may use the quote fields for
   * validation but issue only one HTTP request internally.
   *
   * @throws OfframpError with kind 'quote_expired' if the quote TTL
   *   has passed (not retryable — call quote() again first)
   * @throws OfframpError with kind 'insufficient_funds' if sourceAddress
   *   has less USDC than quote.usdcAmount (not retryable)
   * @throws OfframpError with kind 'invalid_recipient' if the registered
   *   bank account is invalid or not yet verified (not retryable)
   */
  initiate(params: InitiateParams): Promise<OfframpResult>;

  /**
   * Poll the status of a previously initiated off-ramp transaction.
   *
   * Expected status progression: initiated -> processing -> settled
   * Terminal states: settled, failed
   *
   * Poll interval recommendation: 30s for the first 5 minutes,
   * then 5 minutes until settled. Most ACH settlements complete
   * within 1-3 business days.
   *
   * @throws OfframpError with kind 'provider_error' if the provider
   *   returns an unexpected response (retryable: true)
   */
  getStatus(providerTransactionId: string): Promise<OfframpStatusResult>;

  /**
   * Verify the adapter is correctly configured and the provider is
   * reachable. Used at application startup and by monitoring probes.
   *
   * Does NOT throw — returns { ok: false, reason } on any failure
   * so callers can handle gracefully without try/catch.
   */
  healthCheck(): Promise<HealthCheckResult>;
}
