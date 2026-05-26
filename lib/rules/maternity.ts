/**
 * lib/rules/maternity.ts
 *
 * All maternity-specific rules in one file.
 * Add or modify maternity behavior here — no other files need to change.
 */

import type { DiseaseRules } from "./types";

export const maternityRules: DiseaseRules = {
  type: "maternity",
  label: "Maternity",

  // ─── 1. CLASSIFICATION ──────────────────────────────────────────────
  classification: {
    priority: 1, // Checked BEFORE cataract — terms can overlap
    keywords: [
      // Pregnancy & delivery
      "pregnancy", "pregnant", "antenatal", "postnatal", "prenatal", "postpartum",
      "antepartum", "intrapartum", "puerperal", "puerperium",
      "delivery", "childbirth", "parturition", "labour", "labor pain",
      "lscs", "caesarean", "cesarean", "c-section", "c section",
      "normal delivery", "vaginal delivery", "spontaneous delivery", "epidural",
      // Obstetric
      "obstetric", "obstetrical", "gravida", "para ", "gpla",
      "g1p", "g2p", "g3p", "g4p", "g5p",
      // Complications
      "preeclampsia", "eclampsia", "gestational hypertension", "gestational diabetes",
      "gdm", "placenta previa", "placental abruption", "ectopic pregnancy",
      "preterm labour", "preterm labor", "foetal distress", "fetal distress",
      "polyhydramnios", "oligohydramnios", "miscarriage", "abortion", "mtp",
      "medical termination of pregnancy",
      // Newborn
      "newborn", "neonatal", "neonate", "well baby",
      // Trimester
      "trimester", "first trimester", "second trimester", "third trimester",
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
- conditionTests: Look for these maternity supporting documents:
  - Ultrasound report: gestational age, presentation (cephalic/breech), GPLA notation (e.g. G2P1L1A0)
  - Inpatient Initial Assessment form: L value (living children) — CRITICAL for eligibility
  - Discharge summary: delivery type (Normal/C-Section/Twins), complications
  For each document found, create one entry:
    - condition: "Maternity" (ALWAYS use "Maternity" as the condition for ALL entries)
    - matchedDiagnosis: e.g. "maternity", "normal delivery", "LSCS"
    - pageNumber: PDF page (1-based) where document found
    - testName: "GPLA" for ultrasound/assessment, "Delivery Type" for discharge summary
    - reportValue: extracted value e.g. "G2P1L1A0", "Normal Delivery", "C-Section"
    - numericValue: the L value as number if found (e.g. 1), else null
    - unit: "living children" if L value, else ""
    - status: "expected" if found, "missing" if not found
    - sourceText: short snippet from PDF confirming finding

MATERNITY ADDITIONAL EXTRACTIONS (return these extra fields for maternity claims):
- maternityExclusionFlag: true if you find ANY of these phrases in the document:
  "Excl18", "4.1.14", "maternity excluded", "maternity not covered", "maternity not a part",
  "childbirth excluded", "Standard Exclusion", "not covered maternity"
  Return false if none found.
- waitingPeriodDays: Extract the waiting period in days from policy/benefit text.
  Common values: 30 (if "30 days waiting"), 270 (if "9 months"), 365 (if "12 months"), 0 (if "Day 1" or "from day 1").
  Return null if not mentioned.
- exclusionsSummary: A short summary (max 200 chars) of any exclusion clauses found relating to maternity.
  Return null if none found.

IMPORTANT:
- Extract ALL diagnoses and combine as comma-separated string
- Extract lineOfTreatment separately — it is the procedure performed, not the condition
- Be comprehensive in extracting all diagnoses and doctor notes
- Return schema fields only; no explanations outside requested values
- Return a SINGLE object with all diagnoses and notes combined`,

    benefitSummary: `Filter to ONLY benefit points relevant to a maternity claim.
Maternity-relevant items include anything mentioning:
  Normal delivery, C-Section / LSCS, number of childbirths covered, waiting period for maternity, newborn / well baby care, co-pay exceptions for maternity, maternity room rent / accommodation limits.
EXCLUDE everything unrelated to maternity.`,
  },

  // ─── 3. ADMISSIBILITY RULES ─────────────────────────────────────────
  // NOTE: These rules are also evaluated inline in convex/extract.ts to
  // produce a richer multi-rule result for the UI. Keeping both implementations
  // ensures the lib/rules registry can be used standalone (e.g. for tests),
  // while extract.ts retains the multi-rule UI experience.
  admissibilityRules: [
    {
      id: "maternity-living-children-limit",
      name: "Living Children Limit",
      description:
        "Living Children count (L from GPLA) must be less than Max Childbirths " +
        "Allowed in the policy. Most policies cover maternity only for first 2 children.",
      evaluate: (ctx) => {
        const livingChildren = Number(ctx.analysis?.gplaLiving ?? 0);
        const maxChildbirths = Number(ctx.spectraFields?.maxChildbirths ?? 2);
        const age = Number(ctx.analysis?.patientAge ?? 0);
        if (livingChildren >= maxChildbirths) {
          return {
            inadmissible: true,
            ruleId: "maternity-living-children-limit",
            remarks:
              `Claim INADMISSIBLE: Patient already has ${livingChildren} living children. ` +
              `Policy covers maternity for first ${maxChildbirths} children only.`,
            details: { livingChildren, maxChildbirths, patientAge: age },
          };
        }
        return null;
      },
    },
    {
      id: "maternity-policy-exclusion",
      name: "Policy Exclusion (Excl18 / 4.1.14)",
      description:
        "If policy contains Excl18 or clause 4.1.14, maternity benefit is excluded entirely.",
      evaluate: (ctx) => {
        const exclusionFlag = ctx.analysis?.maternityExclusionFlag === true;
        if (exclusionFlag) {
          return {
            inadmissible: true,
            ruleId: "maternity-policy-exclusion",
            remarks:
              "Claim INADMISSIBLE: Policy excludes maternity treatment " +
              "(Exclusion 18 / Clause 4.1.14 applies).",
            details: {
              exclusionsSummary: ctx.analysis?.exclusionsSummary,
            },
          };
        }
        return null;
      },
    },
    {
      id: "maternity-newborn-waiting-period",
      name: "Newborn Waiting Period",
      description:
        "Newborn (age < 30 days) requires policy maternity coverage extension. " +
        "If not extended, claim is inadmissible.",
      evaluate: (ctx) => {
        const age = Number(ctx.analysis?.patientAge ?? -1);
        const hasExtension = ctx.spectraFields?.newbornCovered === true;
        if (age >= 0 && age < 30 && !hasExtension) {
          return {
            inadmissible: true,
            ruleId: "maternity-newborn-waiting-period",
            remarks:
              `Claim INADMISSIBLE: Newborn (age ${age} days) not covered. ` +
              "Newborn must be added to policy with required waiting period.",
            details: { patientAge: age },
          };
        }
        return null;
      },
    },
  ],

  // ─── 4. TPA PROCEDURE MATCHING ──────────────────────────────────────
  tpaProcedures: {
    rules: [
      {
        keywords: ["lscs", "caesarean", "c-section"],
        excludeKeywords: ["twins", "multiple", "complicated", "hysterectomy"],
        targetLevel3Left:  "Caesarean Delivery with well baby care",
        targetLevel3Right: "Caesarean Delivery with well baby care",
        priority: 5,
        fallbackTpaId: 419,
      },
      {
        keywords: ["twins", "multiple"],
        excludeKeywords: ["normal", "vaginal"],
        targetLevel3Left:  "Caesarean Delivery twins with well baby care",
        targetLevel3Right: "Caesarean Delivery twins with well baby care",
        priority: 2,
        fallbackTpaId: 420,
      },
      {
        keywords: ["complicated"],
        targetLevel3Left:  "Complicated LSCS",
        targetLevel3Right: "Complicated LSCS",
        priority: 3,
        fallbackTpaId: 422,
      },
      {
        keywords: ["hysterectomy"],
        targetLevel3Left:  "Caesarean Hysterectomy with bladder repair",
        targetLevel3Right: "Caesarean Hysterectomy with bladder repair",
        priority: 4,
        fallbackTpaId: 421,
      },
      {
        keywords: ["epidural"],
        targetLevel3Left:  "Epidural delivery with well baby care",
        targetLevel3Right: "Epidural delivery with well baby care",
        priority: 7,
        fallbackTpaId: 1340,
      },
      {
        keywords: ["twins", "multiple"],
        targetLevel3Left:  "Normal Vaginal Delivery in Twins",
        targetLevel3Right: "Normal Vaginal Delivery in Twins",
        priority: 6,
        fallbackTpaId: 405,
      },
      {
        keywords: ["normal", "vaginal", "spontaneous"],
        targetLevel3Left:  "Normal delivery with well baby care",
        targetLevel3Right: "Normal delivery with well baby care",
        priority: 8,
        fallbackTpaId: 1331,
      },
      // Catch-all for any maternity keyword — defaults to Normal Delivery
      {
        keywords: ["pregnancy", "gravida", "antenatal", "postnatal", "labour", "labor",
                   "obstetric", "full term", "preterm", "gpla", "g1p", "g2p", "g3p"],
        targetLevel3Left:  "Normal Delivery",
        targetLevel3Right: "Normal Delivery",
        priority: 99,
        fallbackTpaId: 403,
      },
    ],
    catchAllTpaId: 403, // Plain Normal Delivery
  },

  // ─── 5. CODING ROW CONFIGURATION ────────────────────────────────────
  codingRow: {
    billingType:       202,   // Bill amount only, NO package
    treatmentType:     66,    // Surgical
    packageRatio:      100.00,
    defaultFacilityId: null,  // No fixed facility — varies by hospital
    packageRateNull:   true,  // Maternity does NOT use package rate
  },

  // ─── 6. UI BEHAVIOR ─────────────────────────────────────────────────
  ui: {
    showInadmissibilityFlags: true,  // Show maternity-specific red alerts
    showGPLA:                 true,  // Display G/P/L/A breakdown
    filterAilmentCappings:    true,
    showEyeFields:            false,
  },
};