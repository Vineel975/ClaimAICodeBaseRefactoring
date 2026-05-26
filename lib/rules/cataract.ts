/**
 * lib/rules/cataract.ts
 *
 * All cataract-specific rules in one file.
 * Add or modify cataract behavior here — no other files need to change.
 */

import type { DiseaseRules } from "./types";

export const cataractRules: DiseaseRules = {
  type: "cataract",
  label: "Cataract",

  // ─── 1. CLASSIFICATION ──────────────────────────────────────────────
  classification: {
    priority: 2, // Maternity (priority 1) is checked first
    keywords: [
      // Cataract types
      "cataract", "nuclear sclerosis", "cortical sclerosis", "nuclear cataract",
      "cortical cataract", "subcapsular", "psc", "senile cataract",
      "mature cataract", "immature cataract", "hypermature cataract",
      "traumatic cataract", "congenital cataract", "complicated cataract",
      // Lens
      "lens", "iol", "intraocular lens", "lens implant", "pciol", "foldable lens",
      "monofocal", "multifocal", "toric lens", "pseudophakia", "aphakia",
      // Surgery
      "phaco", "phacoemulsification", "sics", "ecce", "icce",
      // Eye / vision
      "eye", "ocular", "optic", "ophthalmic", "ophthalmology", "visual acuity",
      "diminution of vision", "blurred vision", "cornea", "retina", "macula",
      "vitreous", "iris", "pupil", "sclera", "conjunctiva",
      // Other eye procedures
      "lasik", "trabeculectomy", "vitrectomy", "glaucoma", "pterygium",
      "vegf", "intravitreal", "macular degeneration",
      // Retinal conditions
      "npdr", "pdr", "diabetic retinopathy", "retinal detachment",
    ],
  },

  // ─── 2. PROMPTS ─────────────────────────────────────────────────────
  // Full production prompts — ported from convex/prompts.ts to keep AI
  // extraction quality identical post-refactor.
  prompts: {
    admissibilityExtraction: `Extract medical admissibility information from this document. Look for:
- Medical diagnosis or condition statements
- Doctor's notes, clinical observations, or medical findings
- Medical admissibility check reports
- Clinical assessment sections
- Physician notes or remarks

Extract the following information as a SINGLE object:
- diagnosis: ALL medical diagnoses or conditions identified in the document, combined together as a comma-separated list.
- lineOfTreatment: The procedure performed (not the condition). Examples: "Normal Delivery", "LSCS", "Phacoemulsification with Foldable IOL Implantation". Return null if not found.
- icdCode1: The MOST SPECIFIC ICD-10-CM code for the primary diagnosis. ALWAYS return a value.
- icdCode2: ICD-10 code for secondary diagnosis or comorbidity if explicitly mentioned. Return null if only one diagnosis.
- icdCode3: ICD-10 code for a third condition if present. Return null if not applicable.
- presentingComplaint: A brief 1-2 sentence clinical summary of the patient's condition. Always return a value.
- doctorNotes: Clinical notes, observations, or remarks written by the doctor. DO NOT include formal diagnosis statements or structured lab values. Combine all notes into a single string separated by double newlines. Leave empty if not found.
- doctorNotesPageNumber: The PDF page index (1-based) where the doctor's notes appear.
- conditionTests: ONLY for Cataract diagnosis. Look for A-scan report data:
  - Axial Length (Axl.) measurements for both eyes (RE and LE)
  - K1 and K2 (corneal curvature) measurements
  - Anisometropia (Anis.) measurements
  - Sections labeled "Ascan", "A-scan", "Axial Length", or similar
  For Cataract (single entry):
    - condition: "Cataract (A-scan)"
    - matchedDiagnosis: exact diagnosis text (e.g. "cataract")
    - pageNumber: PDF page (1-based) where A-scan found
    - testName: "A-scan"
    - reportValue: "Yes" if found, "No" if not found
    - numericValue: null
    - unit: ""
    - status: "expected" if found, "missing" if not found
    - sourceText: short snippet from PDF

IMPORTANT:
- Extract ALL diagnoses and combine as comma-separated string
- Extract lineOfTreatment separately — it is the procedure performed, not the condition
- Be comprehensive in extracting all diagnoses and doctor notes
- Return schema fields only; no explanations outside requested values
- Return a SINGLE object with all diagnoses and notes combined`,

    benefitSummary: `Filter to ONLY benefit points relevant to a cataract claim.
Cataract-relevant items include anything mentioning:
  Eye surgery, lens implants, IOL, phacoemulsification, cataract, ophthalmic procedures, LASIK, vitrectomy, glaucoma, or ocular conditions.`,
  },

  // ─── 3. ADMISSIBILITY RULES ─────────────────────────────────────────
  admissibilityRules: [
    // Cataract currently has no special admissibility rules beyond standard policy checks.
    // Add rules here as policies evolve.
  ],

  // ─── 4. TPA PROCEDURE MATCHING ──────────────────────────────────────
  tpaProcedures: {
    rules: [
      // Phaco + IOL — most common
      {
        keywords: ["phaco", "phacoemulsification", "iol", "intraocular lens"],
        targetLevel3Left:  "Phacoemulsification with PCIOL Left eye",
        targetLevel3Right: "Phacoemulsification with PCIOL Right eye",
        priority: 1,
      },
      // SICS
      {
        keywords: ["sics", "small incision cataract"],
        targetLevel3Left:  "SICS Left eye",
        targetLevel3Right: "SICS Right eye",
        priority: 2,
      },
      // ECCE
      {
        keywords: ["ecce", "extracapsular"],
        targetLevel3Left:  "ECCE Left eye",
        targetLevel3Right: "ECCE Right eye",
        priority: 3,
      },
      // Catch-all for any eye/cataract reference
      {
        keywords: ["cataract", "eye surgery", "lens"],
        targetLevel3Left:  "Phacoemulsification with PCIOL Left eye",
        targetLevel3Right: "Phacoemulsification with PCIOL Right eye",
        priority: 99,
      },
    ],
    catchAllTpaId: 85, // Default cataract TPA ID
  },

  // ─── 5. CODING ROW CONFIGURATION ────────────────────────────────────
  codingRow: {
    billingType:       201,   // Both bill + package
    treatmentType:     66,    // Surgical
    packageRatio:      100.00,
    defaultFacilityId: 195,   // Day-Care facility
    packageRateNull:   false, // Cataract uses both bill AND package
  },

  // ─── 6. UI BEHAVIOR ─────────────────────────────────────────────────
  ui: {
    showInadmissibilityFlags: false,
    showGPLA:                 false,
    filterAilmentCappings:    true,
    showEyeFields:            true,
  },
};