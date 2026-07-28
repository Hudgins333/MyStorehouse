/**
 * Vetted risk templates — the safety anchor for the consent flow.
 *
 * Each tier above conservative has a set of NON-NEGOTIABLE points that its
 * cautionary statement MUST convey. Sonnet generates the caution in warm,
 * readable language; risk-caution.ts validates that generated text against
 * these required points before it is ever shown to the user. The LLM can make
 * the caution kinder, never weaker.
 *
 * Blended labels: user-facing plain language + the technical tier it maps to.
 */

export type RiskTier = "conservative" | "moderate" | "aggressive";

export interface TierProfile {
  tier: RiskTier;
  label: string;              // user-facing plain language
  oneLine: string;            // short description shown when offering choices
  lane: string;               // the technical routing lane (for logs/clarity)
  requiresConsent: boolean;
  // Points the caution MUST convey. Each has keywords the validator checks for
  // (case-insensitive; any one keyword in the set satisfies that point).
  requiredPoints: { description: string; anyOf: string[] }[];
}

export const TIER_PROFILES: Record<RiskTier, TierProfile> = {
  conservative: {
    tier: "conservative",
    label: "Keep it safe",
    oneLine: "Lend on Aave. Principal stays stable and you can withdraw anytime.",
    lane: "USDC → Aave lending",
    requiresConsent: false,
    requiredPoints: [],
  },

  moderate: {
    tier: "moderate",
    label: "Grow it carefully",
    oneLine: "Hold some ETH exposure plus lending yield. More upside, and the value can move with ETH.",
    lane: "USDC → WETH → Aave",
    requiresConsent: true,
    requiredPoints: [
      {
        description: "Value moves with ETH's price — it can go down.",
        anyOf: ["price of eth", "eth's price", "eth price", "value can fall", "value can go down", "lose value", "drop in value", "market moves"],
      },
      {
        description: "This is not principal-stable like the safe option.",
        anyOf: ["not guaranteed", "principal", "unlike the safe", "not stable", "no guarantee", "can lose"],
      },
    ],
  },

  aggressive: {
    tier: "aggressive",
    label: "Grow it boldly",
    oneLine: "Provide liquidity on Uniswap to earn trading fees — higher potential return, with real risk of loss.",
    lane: "USDC → WETH → Uniswap V3 LP",
    requiresConsent: true,
    requiredPoints: [
      {
        description: "Impermanent loss must be named and explained.",
        anyOf: ["impermanent loss", "impermanent", "divergence loss"],
      },
      {
        description: "You can end up with less than you put in.",
        anyOf: ["less than you put in", "less than you deposited", "lose part of", "lose some of", "below what you", "principal", "lose money"],
      },
      {
        description: "Returns are not guaranteed.",
        anyOf: ["not guaranteed", "no guarantee", "may not", "isn't guaranteed", "cannot promise"],
      },
    ],
  },
};

export function tierProfile(tier: RiskTier): TierProfile {
  return TIER_PROFILES[tier];
}

/** The tiers a bucket can actually be offered, in order. */
export const OFFERABLE_TIERS: RiskTier[] = ["conservative", "moderate", "aggressive"];
