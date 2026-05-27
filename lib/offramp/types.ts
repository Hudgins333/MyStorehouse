/**
 * Storehouse offramp types
 *
 * Shared types for the partner-agnostic OfframpAdapter interface.
 * All monetary amounts are strings to avoid floating-point precision loss
 * (USDC has 6 decimals; fiat has 2).
 */

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface QuoteParams {
  /** USDC amount to off-ramp, as a string (e.g. "100.000000") */
  usdcAmount: string;
  /** The address holding USDC on the source chain (Base Sepolia for v1) */
  sourceAddress: string;
  /** Target fiat currency. Defaults to USD. */
  fiatCurrency?: string;
}

export interface InitiateParams {
  /** The quote returned by adapter.quote() */
  quote: OfframpQuote;
  /** The address holding USDC on the source chain */
  sourceAddress: string;
  /** Human-readable label for the destination (e.g. "Car loan servicer") */
  destinationLabel?: string;
  /** Email for receipt (required by some providers, e.g. Crossmint) */
  receiptEmail?: string;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface OfframpQuote {
  /** Provider-specific quote ID (may be required for initiate()) */
  quoteId: string;
  /** USDC amount being off-ramped */
  usdcAmount: string;
  /** Fiat amount the recipient will receive (after fees) */
  fiatAmount: string;
  /** Fiat currency code */
  fiatCurrency: string;
  /** Provider fee in USDC */
  feeUsdc: string;
  /** Estimated settlement time in seconds from initiation */
  estimatedSettlementSeconds: number;
  /** ISO timestamp when this quote expires */
  expiresAt: string;
}

export interface OfframpResult {
  /** Provider-assigned transaction ID for polling status */
  providerTransactionId: string;
  /** Initial status immediately after initiation */
  status: OfframpStatus;
  /** Provider-specific metadata (stored in offramp_transactions.provider_metadata) */
  metadata?: Record<string, unknown>;
}

export type OfframpStatus =
  | "initiated"
  | "processing"
  | "settled"
  | "failed";

export interface OfframpStatusResult {
  providerTransactionId: string;
  status: OfframpStatus;
  /** Actual fiat amount settled (may differ slightly from quote due to FX) */
  settledFiatAmount?: string;
  /** On-chain settlement hash if available */
  settlementHash?: string;
  /** ISO timestamp when settlement completed */
  settledAt?: string;
  /** Failure reason if status is 'failed' */
  failureReason?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  /** Human-readable reason if ok is false */
  reason?: string;
  /** Provider name for logging */
  provider: string;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type OfframpErrorKind =
  | "insufficient_funds"
  | "invalid_recipient"
  | "quote_expired"
  | "rate_limit"
  | "provider_error"
  | "not_implemented"
  | "configuration_error";

export class OfframpError extends Error {
  constructor(
    public readonly kind: OfframpErrorKind,
    message: string,
    /** Whether the caller can safely retry this operation */
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "OfframpError";
  }
}

export class NotImplementedError extends OfframpError {
  constructor(adapterName: string, methodName: string) {
    super(
      "not_implemented",
      `${adapterName}.${methodName}() is not yet implemented. ` +
        `Implement this method after the v1 offramp partner decision is finalized.`,
      false
    );
    this.name = "NotImplementedError";
  }
}

// ---------------------------------------------------------------------------
// Adapter config types
// ---------------------------------------------------------------------------

export interface CoinbaseBusinessConfig {
  apiKey: string;
  /** Sandbox or production base URL */
  baseUrl: string;
  /** Registered bank account ID for fiat destination */
  bankAccountId: string;
}

export interface CrossmintConfig {
  apiKey: string;
  baseUrl: string;
  /** Registered bank account ID obtained from Crossmint CSE */
  bankAccountId: string;
  /** Email address for transaction receipts (required by Crossmint) */
  receiptEmail: string;
}
