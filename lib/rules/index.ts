/**
 * lib/rules/index.ts
 *
 * Public API for the disease-rules architecture.
 *
 * Import from here throughout the codebase:
 *   import { getRules, classifyDiagnosis, evaluateAdmissibility } from "@/lib/rules";
 *
 * To add a new disease:
 *   1. Add the new ClaimType literal to types.ts
 *   2. Create /lib/rules/<disease>.ts implementing DiseaseRules
 *   3. Import it below and add it to RULES_REGISTRY
 *   4. TypeScript will refuse to compile if any of those steps is missed.
 */

import type {
  ClaimType,
  DiseaseRules,
  AdmissibilityResult,
} from "./types";
import { isClaimType, coerceClaimType } from "./types";

import { cataractRules } from "./cataract";
import { maternityRules } from "./maternity";
import { otherRules } from "./other";

// ─── Registry ───────────────────────────────────────────────────────
/**
 * The single source of truth mapping ClaimType → DiseaseRules.
 *
 * The `Record<ClaimType, DiseaseRules>` type forces every ClaimType to
 * have a corresponding entry. Adding a new ClaimType to types.ts without
 * adding it here is a compile-time error.
 */
export const RULES_REGISTRY: Readonly<Record<ClaimType, DiseaseRules>> = Object.freeze({
  cataract: cataractRules,
  maternity: maternityRules,
  other: otherRules,
});

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get all rules for a given claim type.
 * Returns the "other" rules as a fallback for invalid input — never throws.
 *
 * @example
 *   const rules = getRules("cataract");
 *   const prompt = rules.prompts.admissibilityExtraction;
 *   if (rules.ui.showGPLA) { ... }
 */
export function getRules(claimType: ClaimType | string | undefined | null): DiseaseRules {
  const ct = coerceClaimType(claimType);
  return RULES_REGISTRY[ct];
}

/**
 * Classify a diagnosis text into a ClaimType.
 * Checks each registered disease's keyword list in priority order.
 *
 * Behavior:
 *   - Lower-priority diseases checked first (e.g. maternity priority 1 before cataract priority 2)
 *   - Empty / nullish input → "other"
 *   - No keyword matches → "other"
 *   - Case-insensitive substring matching
 *
 * @example
 *   classifyDiagnosis("G2P1L1A0 LSCS")        // → "maternity"
 *   classifyDiagnosis("Senile cataract OD")   // → "cataract"
 *   classifyDiagnosis("cataract pregnancy")   // → "maternity" (priority wins)
 *   classifyDiagnosis("Heart attack")         // → "other"
 *   classifyDiagnosis("")                     // → "other"
 *   classifyDiagnosis(null)                   // → "other"
 */
export function classifyDiagnosis(diagnosis: string | null | undefined): ClaimType {
  if (!diagnosis || typeof diagnosis !== "string") return "other";
  const trimmed = diagnosis.trim();
  if (!trimmed) return "other";

  const lower = trimmed.toLowerCase();

  // Sort registry entries by priority (ascending). Skip diseases with no keywords (e.g. "other").
  const candidates = Object.values(RULES_REGISTRY)
    .filter((r) => r.classification.keywords.length > 0)
    .sort((a, b) => a.classification.priority - b.classification.priority);

  for (const rules of candidates) {
    for (const kw of rules.classification.keywords) {
      // Defensive: skip empty keywords
      if (!kw) continue;
      if (lower.includes(kw)) {
        return rules.type;
      }
    }
  }
  return "other";
}

/**
 * Evaluate all admissibility rules for a claim type.
 * Returns the FIRST rule that triggers inadmissibility, or null if all pass.
 *
 * Each rule's evaluate() function is called in registration order. The first
 * rule returning a non-null result wins (subsequent rules are not evaluated).
 *
 * If any rule's evaluate() throws, the error is caught, logged via console.error,
 * and that rule is treated as "passed" (null). This ensures one buggy rule
 * cannot crash the entire claim processing flow.
 *
 * @example
 *   const result = evaluateAdmissibility("maternity", analysis, spectraFields, jobId);
 *   if (result) {
 *     // result.inadmissible === true
 *     // result.remarks contains rejection reason
 *     // result.details has structured info
 *   }
 */
export function evaluateAdmissibility(
  claimType: ClaimType | string | undefined | null,
  analysis: Record<string, unknown> | null | undefined,
  spectraFields: Record<string, unknown> | undefined,
  claimId: string,
): AdmissibilityResult | null {
  const rules = getRules(claimType).admissibilityRules;
  if (rules.length === 0) return null;

  const safeAnalysis = analysis ?? {};
  const ctx = { analysis: safeAnalysis, spectraFields, claimId };

  for (const rule of rules) {
    try {
      const result = rule.evaluate(ctx);
      if (result) return result;
    } catch (err) {
      // Defensive: a buggy rule should not crash claim processing.
      // Log and continue to next rule.
      // eslint-disable-next-line no-console
      console.error(
        `[rules] Admissibility rule "${rule.id}" threw an error for claim ${claimId}:`,
        err,
      );
    }
  }
  return null;
}

/**
 * Get all known claim types as an array.
 * Useful for iteration, UI dropdowns, tests.
 */
export function getAllClaimTypes(): ClaimType[] {
  return Object.keys(RULES_REGISTRY) as ClaimType[];
}

/**
 * Get a human-readable label for a claim type.
 * Returns "Other" for invalid inputs.
 */
export function getClaimTypeLabel(claimType: ClaimType | string | undefined | null): string {
  return getRules(claimType).label;
}

// ─── Re-exports for convenience ─────────────────────────────────────
export type {
  DiseaseRules,
  ClaimType,
  AdmissibilityRule,
  AdmissibilityContext,
  AdmissibilityResult,
  ClassificationConfig,
  PromptConfig,
  TpaRule,
  TpaConfig,
  CodingRowConfig,
  UiBehavior,
} from "./types";

export { isClaimType, coerceClaimType } from "./types";
export { cataractRules } from "./cataract";
export { maternityRules } from "./maternity";
export { otherRules } from "./other";
