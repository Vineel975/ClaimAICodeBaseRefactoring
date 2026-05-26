# Disease Rules Architecture

This folder centralizes ALL disease-specific behavior in one place. Every rule
related to a claim type — classification keywords, AI prompts, admissibility
rules, TPA procedure matching, coding row defaults, and UI flags — lives in a
single file per disease.

## Why This Exists

Before this folder, disease-specific rules were scattered across many files:
- Classification keywords lived in `/api/classify-claim-type/route.ts`
- AI prompts lived in `/convex/prompts.ts`
- Admissibility rules lived inside `/convex/extract.ts`
- TPA matching rules lived in `Spectra/Index.cshtml`
- Coding row defaults lived in `MedicalScrutinyController.cs`
- UI conditionals lived in `result-view.tsx`, `patient-info-tab.tsx`, etc.

Adding a new disease (e.g. cardiac) required edits to 8+ files in two codebases.
Now: create ONE file in this folder, register it, done.

## Folder Layout

```
/lib/rules/
├── types.ts          Shared TypeScript interfaces (DiseaseRules, etc.)
├── cataract.ts       All cataract rules in ONE object
├── maternity.ts      All maternity rules in ONE object
├── other.ts          Fallback rules for unmatched diagnoses
├── index.ts          Registry + public API (getRules, classifyDiagnosis, ...)
└── README.md         This file
```

## DiseaseRules Object Structure

Every disease file exports a single object implementing `DiseaseRules`:

```typescript
{
  type: "cataract",                  // Unique identifier
  label: "Cataract",                 // Human-readable name

  classification: {                  // 1. CLASSIFICATION
    priority: 2,                     //   Lower = checked first
    keywords: ["cataract", "iol", ...]
  },

  prompts: {                         // 2. AI PROMPTS
    admissibilityExtraction: "...",  //   Sent to AI for extracting fields
    tariffMatching: "...",           //   Sent to AI for tariff extraction
    benefitSummary: "..."            //   Sent to AI for ailment cappings
  },

  admissibilityRules: [              // 3. BUSINESS LOGIC RULES
    {
      id: "...",
      name: "...",
      description: "...",
      evaluate: (ctx) => { ... }     //   Returns rejection or null
    }
  ],

  tpaProcedures: {                   // 4. TPA PROCEDURE MATCHING
    rules: [
      {
        keywords: ["phaco", ...],
        targetLevel3Left:  "Phaco PCIOL Left eye",
        targetLevel3Right: "Phaco PCIOL Right eye",
        priority: 1
      }
    ],
    catchAllTpaId: 85
  },

  codingRow: {                       // 5. CLAIMSCODING ROW DEFAULTS
    billingType: 201,                //   BillingType_P51
    treatmentType: 66,               //   TreatementTypeID_19
    packageRatio: 100.00,
    defaultFacilityId: 195,          //   Day-Care = 195
    packageRateNull: false
  },

  ui: {                              // 6. UI BEHAVIOR FLAGS
    showInadmissibilityFlags: false,
    showGPLA: false,
    filterAilmentCappings: true,
    showEyeFields: true
  }
}
```

## How To Use It

### From any file — get a disease's rules

```typescript
import { getRules } from "@/lib/rules";

const rules = getRules("cataract");

// Use rules anywhere
const prompt = rules.prompts.admissibilityExtraction;
const billingType = rules.codingRow.billingType;
if (rules.ui.showGPLA) { /* show GPLA UI */ }
```

### Classify a diagnosis

```typescript
import { classifyDiagnosis } from "@/lib/rules";

const claimType = classifyDiagnosis("G2P1L1A0 LSCS");  // "maternity"
const claimType = classifyDiagnosis("Senile cataract"); // "cataract"
const claimType = classifyDiagnosis("Heart attack");    // "other"
```

### Run admissibility rules

```typescript
import { evaluateAdmissibility } from "@/lib/rules";

const result = evaluateAdmissibility(
  "maternity",
  analysisFromAI,
  spectraFields,
  claimId,
);

if (result) {
  // result.inadmissible === true
  // result.remarks contains the rejection reason
  // result.details has extra info
}
```

## How To Add a New Disease

Adding "cardiac" claim type, for example:

### Step 1 — Update `types.ts`

```typescript
export type ClaimType = "cataract" | "maternity" | "cardiac" | "other";
```

### Step 2 — Create `cardiac.ts`

Copy `cataract.ts` as a template and fill in cardiac-specific values:

```typescript
import type { DiseaseRules } from "./types";

export const cardiacRules: DiseaseRules = {
  type: "cardiac",
  label: "Cardiac",

  classification: {
    priority: 3,
    keywords: ["heart", "cardiac", "stent", "angioplasty", "bypass", ...]
  },

  prompts: {
    admissibilityExtraction: `
      Extract cardiac-specific fields:
      - procedureType (Angioplasty/CABG/Stent placement)
      - vesselsAffected
      - stentDetails (drug-eluting / bare metal)
      ...
    `.trim()
  },

  admissibilityRules: [
    // Add cardiac-specific business rules
  ],

  tpaProcedures: {
    rules: [
      { keywords: ["angioplasty", "ptca"], ... },
      { keywords: ["bypass", "cabg"], ... },
    ],
    catchAllTpaId: 0  // Default cardiac TPA ID
  },

  codingRow: {
    billingType: 201,
    treatmentType: 66,
    packageRatio: 100.00,
    packageRateNull: false
  },

  ui: {
    showInadmissibilityFlags: false,
    showGPLA: false,
    filterAilmentCappings: true,
    showEyeFields: false
  }
};
```

### Step 3 — Register in `index.ts`

```typescript
import { cardiacRules } from "./cardiac";

export const RULES_REGISTRY: Record<ClaimType, DiseaseRules> = {
  cataract:  cataractRules,
  maternity: maternityRules,
  cardiac:   cardiacRules,  // ← ADD
  other:     otherRules,
};
```

**That's it.** Classification picks it up automatically. Admissibility rules
fire automatically. Prompts get used automatically. Coding row uses the right
billing type automatically. No other files in the entire codebase need to change.

## Migrating Existing Code To Use This

The existing code can be refactored to use this folder incrementally. Here's the
mapping:

| Old Location | New Source |
|--------------|------------|
| `app/api/classify-claim-type/route.ts` — CATARACT_KEYWORDS array | `getRules("cataract").classification.keywords` |
| `app/api/classify-claim-type/route.ts` — MATERNITY_KEYWORDS array | `getRules("maternity").classification.keywords` |
| `convex/prompts.ts` — medicalAdmissibilityExtractionPrompt | `getRules(claimType).prompts.admissibilityExtraction` |
| `convex/extract.ts` — maternity inadmissibility post-processing | `evaluateAdmissibility(claimType, analysis, spectraFields, claimId)` |
| `Spectra/Index.cshtml` — `maternityRules` JS array | `getRules("maternity").tpaProcedures.rules` |
| `MedicalScrutinyController.cs` — `BillingType_P51 = 202` hardcode | `getRules(claimType).codingRow.billingType` |
| `result-view.tsx` — `if (claimType === "maternity") show GPLA` | `if (getRules(claimType).ui.showGPLA) ...` |

### Example Migration — classify-claim-type/route.ts

**Before:**
```typescript
const CATARACT_KEYWORDS = ["cataract", "iol", "phaco", ...];
const MATERNITY_KEYWORDS = ["pregnancy", "lscs", ...];

if (MATERNITY_KEYWORDS.some(kw => text.includes(kw))) return "maternity";
if (CATARACT_KEYWORDS.some(kw => text.includes(kw))) return "cataract";
return "other";
```

**After:**
```typescript
import { classifyDiagnosis } from "@/lib/rules";

const claimType = classifyDiagnosis(diagnosis);
```

### Example Migration — extract.ts admissibility checks

**Before:**
```typescript
if (claimType === "maternity") {
  const living = analysis.gplaLiving ?? 0;
  const max = spectraFields.maxChildbirths ?? 2;
  if (living >= max) {
    analysis.maternityInadmissible = true;
    analysis.maternityRemarks = `...`;
  }
  // ... more rules
}
```

**After:**
```typescript
import { evaluateAdmissibility } from "@/lib/rules";

const result = evaluateAdmissibility(claimType, analysis, spectraFields, claimId);
if (result) {
  analysis.maternityInadmissible = true;
  analysis.maternityRemarks      = result.remarks;
  analysis.inadmissibilityRule   = result.ruleId;
  analysis.inadmissibilityDetails = result.details;
}
```

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Adding a disease | Edit 8+ files in 2 repos | Create 1 file + 1 registration |
| Finding a rule | Search 5 different files | Look in `<disease>.ts` |
| Modifying a prompt | Edit `prompts.ts`, hope for no conflicts | Edit `cataract.ts` directly |
| Onboarding new dev | "Read all these files" | "Read `<disease>.ts`, you know everything" |
| Testing | Mock multiple imports | Mock one rules object |
| Disease parity | Easy to miss something | Interface forces all fields |

## Caveats / Future Work

1. **TPA matching on the Spectra C# side** — the maternity rules currently live
   in `Index.cshtml` as a JS array. To use this registry from Spectra, you'd need
   to either:
   - Expose a `/api/tpa-rules?claimType=maternity` endpoint that returns the
     rules array
   - OR duplicate the rules in both places (less ideal)

2. **Coding row INSERT in C#** — `BillingType_P51`, `TreatmentTypeID_19`, etc.
   are currently hardcoded in `MedicalScrutinyController.cs`. To use this
   registry, expose them via an API or have ClaimAI send them in the postMessage
   payload that triggers the save.

3. **Admissibility rule evaluation order** — currently first-match wins. If you
   need to evaluate ALL rules and collect all failures, modify
   `evaluateAdmissibility` in `index.ts` to return an array.

## Summary

One file per disease. All rules in one place. Single source of truth. New diseases
take 5 minutes to add instead of half a day of grepping across two codebases.
