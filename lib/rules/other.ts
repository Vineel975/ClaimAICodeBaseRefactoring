/**
 * Fallback rules for "other" claim types (not cataract or maternity).
 * Uses generic prompts and disables disease-specific UI features.
 */

import type { DiseaseRules } from "./types";

export const otherRules: DiseaseRules = {
  type: "other",
  label: "Other",

  classification: {
    priority: 99,
    keywords: [], // No keywords — matches only when nothing else does
  },

  prompts: {
    admissibilityExtraction: `
You are a medical claim analyst.

Extract from the medical records:
- diagnosis: Primary diagnosis text
- lineOfTreatment: Treatment description
- presentingComplaint: Patient's chief complaint
- icdSuggestions: Likely ICD-10 codes

Return ONLY a JSON object with these fields. Use null for missing data.
`.trim(),

    benefitSummary: `
Extract the most relevant benefit plan points based on the diagnosis.
Return a JSON array of short bullet strings (max 6 points).
`.trim(),
  },

  admissibilityRules: [],

  tpaProcedures: {
    rules: [],
    catchAllTpaId: 0,
  },

  codingRow: {
    billingType:       201,
    treatmentType:     0,
    packageRatio:      100.00,
    defaultFacilityId: null,
    packageRateNull:   false,
  },

  ui: {
    showInadmissibilityFlags: false,
    showGPLA:                 false,
    filterAilmentCappings:    false,
    showEyeFields:            false,
  },
};
