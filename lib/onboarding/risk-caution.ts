/**
 * Cautionary-statement generator + validator.
 *
 * For a tier that requires consent, Sonnet writes a warm, plain-language
 * caution; this module validates that the generated text conveys every
 * NON-NEGOTIABLE point from the vetted template (risk-template.ts). If a point
 * is missing, it retries; if it still can't produce a complete caution, it
 * falls back to a plain template-built statement rather than showing the user
 * an incomplete one. The LLM can make the caution kinder, never weaker.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_SONNET_MODEL } from "../agents/types";
import { tierProfile, type RiskTier } from "./risk-template";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Which required points, if any, the text fails to convey. */
function missingPoints(text: string, tier: RiskTier): string[] {
  const profile = tierProfile(tier);
  const hay = text.toLowerCase();
  return profile.requiredPoints
    .filter((pt) => !pt.anyOf.some((kw) => hay.includes(kw.toLowerCase())))
    .map((pt) => pt.description);
}

// Pre-written, complete cautions per consent tier. Used if the model is
// unavailable or can't produce a validated caution. These are themselves
// written to satisfy every required point, so the user always sees a real,
// complete warning — never the validator's internal checklist.
const FALLBACK_CAUTIONS: Record<string, (bucket: string) => string> = {
  moderate: (bucket) =>
    `Before I set "${bucket}" to Grow it carefully: this moves part of your money into ETH, so its value will rise and fall with ETH's price — it can genuinely go down. Unlike the safe option, your balance here is not guaranteed to stay stable. Reply "yes" if you're comfortable with that, or choose a safer option.`,
  aggressive: (bucket) =>
    `Before I set "${bucket}" to Grow it boldly: this converts part of your USDC to ETH and provides liquidity on Uniswap to earn trading fees. It exposes you to impermanent loss — if ETH's price moves a lot, you can end up with less than you put in. Returns are not guaranteed. Reply "yes" only if you're genuinely comfortable with that risk, or choose a safer option.`,
};

/** Deterministic fallback caution — real prose, satisfies all required points. */
function fallbackCaution(tier: RiskTier, bucketName: string): string {
  const builder = FALLBACK_CAUTIONS[tier];
  return builder ? builder(bucketName) : "";
}

const SYSTEM = `You write a short, warm, plain-language caution for someone choosing a risk level for part of their savings in a stewardship app.

Rules:
- Be honest and clear, not scary or salesy. A caring friend who won't let them misunderstand the risk.
- 2-4 sentences. No jargon beyond the one required term if given.
- You MUST clearly convey every point in REQUIRED_POINTS. Say them plainly; do not soften them away.
- End by asking them to reply "yes" to confirm or pick a safer option.
- Output ONLY the caution text. No preamble, no markdown.`;

/**
 * Produce a validated caution for a consent-requiring tier.
 * Returns the exact text to show (and later log verbatim as the consent record).
 */
export async function generateCaution(tier: RiskTier, bucketName: string): Promise<string> {
  const profile = tierProfile(tier);
  if (!profile.requiresConsent) return ""; // conservative: nothing to consent to

  const required = profile.requiredPoints.map((pt) => `- ${pt.description}`).join("\n");
  const userPrompt =
    `Risk level: ${profile.label} (${profile.lane}) for the bucket "${bucketName}".\n\n` +
    `REQUIRED_POINTS (all must be clearly conveyed):\n${required}`;

  // Up to 2 attempts; validate each against the required points.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await anthropic.messages.create({
        model: CLAUDE_SONNET_MODEL,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("").trim();
      if (text && missingPoints(text, tier).length === 0) {
        return text;
      }
    } catch {
      // fall through to fallback
      break;
    }
  }

  // Couldn't get a complete caution from the model — use the safe template one.
  return fallbackCaution(tier, bucketName);
}

export { missingPoints };
