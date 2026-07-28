/**
 * Storehouse — Shared agent types
 *
 * TypeScript interfaces used across all four agents (Classifier, Router,
 * Validator, Executor). Single source of truth for agent input/output shapes.
 */

// ---------------------------------------------------------------------------
// Income classification (output of the Classification Agent)
// ---------------------------------------------------------------------------

export type IncomeType =
  | "paycheck"
  | "gift"
  | "refund"
  | "transfer"
  | "unknown";

export interface ClassificationResult {
  type: IncomeType;
  confidence: number; // 0.0 - 1.0
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Income event row (as it lives in the income_events table)
// ---------------------------------------------------------------------------

export interface IncomeEventRow {
  id: string;
  source_tx_hash: string;
  source_address: string;
  source_chain: string;
  amount: string; // NUMERIC from Postgres comes back as string
  cctp_required: boolean;
  cctp_transfer_id: string | null;
  classification: IncomeType | null;
  classification_confidence: number | null;
  classification_reasoning: string | null;
  received_at: string;
  status:
    | "pending"
    | "bridging"
    | "arrived_on_arc"
    | "routed"
    | "failed"
    | "manual_review";
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Routing plan (output of the Routing Agent)
// ---------------------------------------------------------------------------

export interface AllocationItem {
  obligation_id: string;
  obligation_name: string; // for readability in logs/UI
  destination_address: string;
  amount: string; // USDC amount, human-readable (e.g. "10.50")
}

export interface RoutingPlan {
  allocations: AllocationItem[];
  reasoning: string; // plain-English explanation
}

// ---------------------------------------------------------------------------
// Validator result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CLAUDE_SONNET_MODEL = "claude-sonnet-5";
// Storehouse runs Sonnet across all agents: the routing brain's plain-English
// explanations are a demo-facing product surface, and Sonnet's reasoning is
// worth the (still trivial) per-decision cost. CLAUDE_HAIKU_MODEL is retained
// as a name so classifier/router imports are unchanged, but points at Sonnet 5.
export const CLAUDE_HAIKU_MODEL = CLAUDE_SONNET_MODEL;
