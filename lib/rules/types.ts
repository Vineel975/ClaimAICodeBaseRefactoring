/**
 * lib/rules/types.ts
 *
 * Shared TypeScript types for the disease-rules architecture.
 *
 * Every disease (cataract, maternity, etc.) implements `DiseaseRules`.
 * The TypeScript compiler enforces all fields are present, so adding
 * a new disease cannot silently miss a configuration section.
 */

// ─── Claim Type ─────────────────────────────────────────────────────
// Add new claim types here. The TypeScript compiler will force you to
// register a corresponding DiseaseRules object in /lib/rules/index.ts
// (RULES_REGISTRY) — you cannot forget to wire it up.
export type ClaimType = "cataract" | "maternity" | "other";

// ─── Classification ─────────────────────────────────────────────────
export interface ClassificationConfig {
  /**
   * Keywords that classify a diagnosis as this disease.
   * Matching is case-insensitive substring (e.g. keyword "iol" matches "PCIOL").
   * Use lowercase, no special characters.
   */
  readonly keywords: readonly string[];

  /**
   * Priority for classification ordering.
   * Lower number = checked FIRST.
   * Use this to resolve conflicts when a diagnosis contains keywords from
   * multiple diseases (e.g. "cataract pregnancy" → maternity wins if priority lower).
   */
  readonly priority: number;
}

// ─── AI Prompts ─────────────────────────────────────────────────────
export interface PromptConfig {
  /**
   * The COMPLETE prompt sent to AI for medical admissibility extraction.
   * Should include all field instructions specific to this disease.
   * Required — every disease must have one.
   */
  readonly admissibilityExtraction: string;

  /**
   * Optional prompt for tariff line-item matching.
   * If omitted, the generic tariff prompt is used.
   */
  readonly tariffMatching?: string;

  /**
   * Optional prompt for filtering benefit-plan cappings to disease-relevant bullets.
   * If omitted, the generic benefit-summary prompt is used.
   */
  readonly benefitSummary?: string;

  /**
   * Optional prompt for previous-claim similarity comparison.
   * If omitted, the generic similarity prompt is used.
   */
  readonly previousClaimSimilarity?: string;
}

// ─── Admissibility Rules ────────────────────────────────────────────
export interface AdmissibilityContext {
  /** The AI-extracted analysis object (flexible shape — depends on prompt) */
  readonly analysis: Readonly<Record<string, unknown>>;

  /** Fields passed in from Spectra DB (patient info, policy, etc.) */
  readonly spectraFields: Readonly<Record<string, unknown>> | undefined;

  /** Job/claim identifier — useful for logging context */
  readonly claimId: string;
}

export interface AdmissibilityResult {
  /** Always true when this is returned. Null means "no rejection". */
  readonly inadmissible: true;

  /** Stable ID for this rule (used for analytics / event log). */
  readonly ruleId: string;

  /** Human-readable rejection text shown to the user. */
  readonly remarks: string;

  /** Structured details for the UI to render (varies by rule). */
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AdmissibilityRule {
  /** Stable identifier, e.g. "maternity-living-children-limit" */
  readonly id: string;

  /** Short title for logs / UI */
  readonly name: string;

  /** Plain-English description of the rule's purpose */
  readonly description: string;

  /**
   * Evaluate this rule against a claim's analysis + Spectra fields.
   * Return an AdmissibilityResult to mark inadmissible.
   * Return null to indicate this rule does NOT trigger (claim passes this rule).
   *
   * Should be pure: no side effects, no async, no logging.
   */
  evaluate(ctx: AdmissibilityContext): AdmissibilityResult | null;
}

// ─── TPA Procedure Matching ─────────────────────────────────────────
export interface TpaRule {
  /**
   * Keywords that trigger this rule.
   * ANY match (substring, case-insensitive) triggers.
   */
  readonly keywords: readonly string[];

  /**
   * Optional anti-keywords.
   * If ANY of these is present in the input, the rule does NOT trigger,
   * even if a positive keyword matches.
   */
  readonly excludeKeywords?: readonly string[];

  /** Target Level-3 procedure name to search for in TPAProcedures master (left eye / left-laterality) */
  readonly targetLevel3Left: string;

  /** Target Level-3 procedure name for right eye / right-laterality */
  readonly targetLevel3Right: string;

  /** Lower number = checked first. First matching rule wins. */
  readonly priority: number;

  /** If targetLevel3 name lookup fails in DB, use this TPA ID as default */
  readonly fallbackTpaId?: number;
}

export interface TpaConfig {
  readonly rules: readonly TpaRule[];
  /** TPA ID used when no rule matches and a coding row must still be created. */
  readonly catchAllTpaId: number;
}

// ─── Coding Row Configuration ───────────────────────────────────────
export interface CodingRowConfig {
  /**
   * ClaimsCoding.BillingType_P51 column value.
   * 201 = bill + package, 202 = bill only (no package).
   */
  readonly billingType: number;

  /**
   * ClaimsCoding.TreatementTypeID_19 column value.
   * 66 = Surgical (default for both cataract and maternity).
   */
  readonly treatmentType: number;

  /** ClaimsCoding.PackageRatio (e.g. 100.00 for 100%) */
  readonly packageRatio: number;

  /**
   * Default facility ID for "Approved Accommodation" dropdown.
   * 195 = Day Care (used for cataract). null = no default (e.g. maternity).
   */
  readonly defaultFacilityId: number | null;

  /**
   * Whether to set PackageRate to NULL in ClaimsCoding.
   * true for maternity (uses bill amount only).
   * false for cataract (uses both bill and package).
   */
  readonly packageRateNull: boolean;

  /** Additional column overrides — applied during INSERT */
  readonly customColumns?: Readonly<Record<string, unknown>>;
}

// ─── UI Behavior ────────────────────────────────────────────────────
export interface UiBehavior {
  /**
   * Show the red inadmissibility-alert section on Patient Info tab when
   * an admissibility rule has marked this claim as inadmissible.
   */
  readonly showInadmissibilityFlags: boolean;

  /**
   * Show GPLA breakdown (G/P/L/A values) on Patient Info tab.
   * True for maternity, false for others.
   */
  readonly showGPLA: boolean;

  /**
   * Filter benefit-plan ailment cappings to only disease-relevant bullets.
   * True for both cataract and maternity, false for "other".
   */
  readonly filterAilmentCappings: boolean;

  /**
   * Show eye-specific UI elements (lens type, eye selection, IOL details).
   * True for cataract, false for others.
   */
  readonly showEyeFields: boolean;
}

// ─── Master DiseaseRules Interface ──────────────────────────────────
/**
 * Every disease file (cataract.ts, maternity.ts, ...) exports
 * a single object implementing this interface.
 *
 * The interface is `readonly` throughout — disease rules are immutable
 * at runtime. To change a rule, edit the source file and redeploy.
 */
export interface DiseaseRules {
  readonly type: ClaimType;
  readonly label: string;
  readonly classification: ClassificationConfig;
  readonly prompts: PromptConfig;
  readonly admissibilityRules: readonly AdmissibilityRule[];
  readonly tpaProcedures: TpaConfig;
  readonly codingRow: CodingRowConfig;
  readonly ui: UiBehavior;
}

// ─── Type Guards / Validation ───────────────────────────────────────

/**
 * Runtime type guard: is the given value a valid ClaimType?
 * Useful when accepting claim type from external sources (URL, API, etc.).
 */
export function isClaimType(value: unknown): value is ClaimType {
  return value === "cataract" || value === "maternity" || value === "other";
}

/**
 * Safely coerce an unknown value to ClaimType.
 * Returns "other" if the value is invalid.
 */
export function coerceClaimType(value: unknown): ClaimType {
  return isClaimType(value) ? value : "other";
}
