/**
 * convex/prompts.ts (POST-REFACTOR VERSION)
 *
 * All disease-specific prompt text now lives in /lib/rules/<disease>.ts.
 * This file keeps the existing function exports for backward compatibility,
 * but disease-specific prompts are now thin wrappers that delegate to the
 * rules registry.
 *
 * BEFORE: 500+ lines, disease-specific prompt text inlined and branched by claimType.
 * AFTER:  ~280 lines, disease-agnostic prompts inline, disease prompts delegated.
 *
 * Disease-specific prompts MOVED OUT of this file:
 *   - medicalAdmissibilityExtractionPrompt → rules.prompts.admissibilityExtraction
 *   - alignmentCappingsCataractPrompt      → rules.prompts.benefitSummary
 *
 * Disease-agnostic prompts that STAY in this file:
 *   - baseDocumentExtractionPrompt        (works for any bill type)
 *   - combinedTariffCalculationPrompt     (tariff structure, not disease-specific)
 *   - policyWordingsAdjustmentPrompt      (policy wording — disease-agnostic)
 *   - benefitPlanLimitExtractionPrompt    (operates on cappings string list)
 *   - tariffFileSelectionPrompt           (insurer-based, not disease)
 *   - previousClaimSimilarityPrompt       (claim-type-aware text with both branches)
 *   - benefitSectionSummaryPrompt         (claim-type-aware filtering text)
 *   - maternityGPLAExtractionPrompt       (specialized maternity helper — kept for now)
 *   - maternityBenefitRemarksPrompt       (specialized maternity helper — kept for now)
 */

import { getRules, coerceClaimType, type ClaimType } from "../lib/rules";

// ════════════════════════════════════════════════════════════════════
// DISEASE-SPECIFIC PROMPTS (delegated to rules registry)
// ════════════════════════════════════════════════════════════════════

/**
 * Returns the medical admissibility extraction prompt for the given claim type.
 * The full prompt text lives in /lib/rules/<disease>.ts → prompts.admissibilityExtraction
 *
 * @param claimType - The classified claim type. Defaults to "cataract".
 * @returns Complete prompt string ready to send to AI.
 */
export const medicalAdmissibilityExtractionPrompt = (
  claimType: ClaimType = "cataract",
): string => {
  const safe = coerceClaimType(claimType);
  return getRules(safe).prompts.admissibilityExtraction;
};

/**
 * Filter benefit-plan alignment cappings to disease-relevant bullets.
 * Now claim-type aware (previously was cataract-only).
 *
 * @param cappings - List of capping strings from the benefit plan DB.
 * @param claimType - Filter by this claim type's relevance criteria.
 */
export const alignmentCappingsPrompt = (
  cappings: string[],
  claimType: ClaimType = "cataract",
): string => {
  const safe = coerceClaimType(claimType);
  const benefitSummaryPrompt = getRules(safe).prompts.benefitSummary;

  const filterInstructions = benefitSummaryPrompt
    ? benefitSummaryPrompt
    : `Extract the most relevant alignment cappings for this claim.`;

  return `You are reviewing benefit plan alignment conditions for a health insurance claim processor.

Below is a list of alignment cappings extracted from the benefit plan. Each line is in the format "Condition Name: Details / Limits".

${cappings.join("\n")}

${filterInstructions}

RULES:
- Return only the relevant lines, one per line, in the exact same format as given.
- Do not modify, summarize, or rewrite any line.
- If no items are relevant, return exactly: NONE
- Do not add any explanation, heading, or extra text.`;
};

/**
 * @deprecated Use alignmentCappingsPrompt(cappings, "cataract") instead.
 * Kept temporarily for backward compatibility during migration.
 */
export const alignmentCappingsCataractPrompt = (cappings: string[]): string => {
  return alignmentCappingsPrompt(cappings, "cataract");
};

// ════════════════════════════════════════════════════════════════════
// DISEASE-AGNOSTIC PROMPTS (stay in this file)
// ════════════════════════════════════════════════════════════════════

export const baseDocumentExtractionPrompt = `Extract the base document information from the entire hospital bill PDF:
- For EVERY scalar field below, return an object in the shape { value, pageNumber }
- pageNumber must always be the physical PDF page index (1-based)
- Do NOT use printed page numbers shown inside the document
- Return concise field values only; never include explanations, reasoning, repeated text, or narrative outside the requested values
- CRITICAL: if you return any non-empty/non-null value for a field, you MUST also return its pageNumber
- Do not leave pageNumber blank when value is present
- If you cannot determine the exact page for a value, do not guess wildly; find the page before returning the value

Fields to extract as { value, pageNumber }:
- hospitalName: Hospital name
- patientName: Patient name
- patientAge: Patient age
- patientGender: Patient gender if mentioned
- policyNumber: Policy/member/IP number if mentioned
- invoiceNumber: Bill/invoice number if mentioned
- admissionDate: Admission date if mentioned
- dischargeDate: Discharge date if mentioned
- date: Document date
- totalAmount: Total bill amount (this is the FINAL amount AFTER any discount is applied)
- discount: Discount amount if present

Also extract DISCOUNT information if present:
- Look for "Discount", "Less: Discount", "Rebate", "Concession", "Special Discount", "Bill Discount" in the bill summary.
- This should be a positive number representing the discount given.

Also extract GST (Goods and Services Tax) information if present:
- Return GST as a single object in the shape:
  gst: {
    value: {
      gstAmount,
      cgstAmount,
      sgstAmount
    },
    pageNumber
  }
- Use ONE shared GST pageNumber for the GST block/section.
Look for GST information in summary sections, tax breakdowns, or footer areas of the bill.

Also extract HOSPITAL BILL BREAKDOWN components if present:
- hospitalBillBreakdown: Extract major components that make up the hospital bill total. Look for sections or summaries that show components like "Actual Bill", "Lens Bill", "Implant Cost", "Room Charges", "Procedure Charges", "Consumables", etc. The sum of these breakdown items should match or be close to the total hospital bill amount.
- For procedure charges, use exactly "Procedure Charges" as the component name—do not expand with sub-categories like "(Medicines / Operation Theatre / Surgeon's Fee / Anesthetist's Fees)".
- Only extract if the bill clearly shows these as separate components
- Each component should have a name (e.g., "Actual Bill", "Lens Bill") and amount

Also extract PACKAGE context:
- isAllInclusivePackage: true if hospital bill is clearly all-inclusive/package style, else false

Also extract DOCUMENT CHECKLIST in this shape:
- documentChecklist: {
    aadharCard: { value: boolean, pageNumber },
    panCard: { value: boolean, pageNumber },
    eCard: { value: boolean, pageNumber },
    invoiceForSurgical: { value: boolean, pageNumber },
    kyc: { value: boolean, pageNumber },
    claimForm: { value: boolean, pageNumber }
  }
- If a document is not present, set value to false and pageNumber to 0.

IMPORTANT NOTE ON DISCOUNT:
- The totalAmount should be the FINAL amount after discount is applied
- The discount field should contain the discount amount as a POSITIVE number
- Example: If bill summary shows "Total: 100,000" and "Less: Discount: 5,000" and "Net Amount: 95,000", then totalAmount = 95,000 and discount = 5,000

IMPORTANT NOTE ON TOTAL AMOUNTS:
Sometimes the totalAmount shown in the PDF and the sum of all individual services may not match due to legitimate calculation errors in the PDF itself. If you identify a clear mistake in the PDF (e.g., incorrect arithmetic, missing items in the total, or incorrect GST calculation), it is acceptable to extract the amounts as they appear in the PDF even if they don't match mathematically. However, if the PDF appears correct, you must be very strict and ensure the sum of all services matches the total amount (accounting for GST and discount if applicable).`;

export const combinedTariffCalculationPrompt = `You are analyzing TWO documents together:

1. HOSPITAL BILL PDF – Contains the detailed list of services actually provided (procedures, room charges, consumables, medications, implants, etc.). Use this internally to understand charge components.
2. TARIFF PDF – Contains the agreed tariff structure, package definitions, caps, limits, exclusions, and special conditions for this hospital.

Your Task
- Analyze the hospital bill to identify context (procedure, package, lens details, eye side) and use policy wordings provided in claim context for lens applicability.
- Review the tariff PDF and EXTRACT tariff values exactly as written.
- Do NOT perform payable calculation, lower-of logic, capping by billed amount, or policy-style adjustment.

Return:
  tariffExtractionItem -> ARRAY of extracted tariff components (primary field; use this everywhere):
    - Each entry must have { code, name, amount, pdfText, pdfPageNumber }.
    - Split combined entries into explicit components when present (e.g., procedure + lens).
    - Example: if row says "Rs.19,000 (excluding lens) plus Rs.7,000 maximum admissible lens cost", return two entries:
      1) { code: "PPN OPH 01 A", name: "Procedure Package (excluding lens)", amount: 19000, pdfText: "cataract (Excluding lens)-Phaco (maximum admissible lens - 7000)", pdfPageNumber: 2 }
      2) { code: "PPN OPH 01 A", name: "Lens (maximum admissible)", amount: 7000, pdfText: "cataract (Excluding lens)-Phaco (maximum admissible lens - 7000)", pdfPageNumber: 2 }
    - pdfText: copy the EXACT verbatim text fragment from the tariff PDF row/line for this item — enough to uniquely identify it by text search (minimum: the procedure name as written in the tariff).
    - pdfPageNumber: the 1-based page number in the TARIFF PDF where this item appears.
    - pdfRowTopPct: approximate vertical position of the TOP of this row as % of page height (0=top, 100=bottom). Estimate visually. Example: row is 60% down the page → 60.
    - pdfRowBottomPct: approximate vertical position of the BOTTOM of this row as % of page height. Usually pdfRowTopPct + 2 to 4 for a single-line row.
    - Do not merge procedure and lens into one entry.
    - Preserve tariff-side amounts as written; do not reduce using hospital bill amounts.
  lensType → Lens/IOL type if mentioned (e.g., Monofocal, Multifocal, Toric). If not mentioned, return exactly: "cant determine".
  lensTypePageNumber → The TARIFF PDF page index (1-based) where the lens type reference is found. If not mentioned or cannot be determined, return 0.
  lensTypeApproved -> apply exactly this logic:
    - if lensType is "cant determine", return exactly: "cant determine"
    - else if lensType is present AND policy wording indicates this lens type is not applicable/not covered/not payable, return false
    - else return true
  eyeType → Eye type for the procedure: "left eye", "right eye", or "both eyes". Determine from the diagnosis, procedure codes, doctor notes, or bill description. If not mentioned or cannot be determined, return exactly: "cant determine".
  tariffPageNumber → The TARIFF PDF page index (1-based) where the tariff reference is found. If not mentioned or cannot be determined, return 0.
  calculationNotes → 2-4 short sentences describing what was extracted from tariff (code/name/components/caps), no calculation narrative.
  clarificationNote -> 1-2 short sentences only for extraction ambiguity (e.g., unreadable amount, multiple similar rows). If none, return exactly: "cant determine".

Critical Rules
1. Do NOT cap tariff values using hospital billed amounts.
2. Do NOT convert "maximum admissible" values into billed values.
3. If tariff row says "Rs.19,000 plus Rs.7,000 lens max", extract those tariff values as-is.
4. Prefer exact numbers from tariff table text even if hospital bill has lower amounts.
5. Keep extraction faithful to tariff document wording and figures.

Return ONLY:
  tariffExtractionItem
  lensType
  lensTypePageNumber
  lensTypeApproved
  eyeType
  tariffPageNumber
  calculationNotes
  clarificationNote`;

export const policyWordingsAdjustmentPrompt = `You are given:
Policy Wordings / Benefit Plan Guidelines – Contains coverage rules, sub-limits, caps, exclusions, co-pay clauses, and special conditions.

## Your Task
- Extract the explicit benefit cap/amount that should act as the policy-side upper limit for claim approval.
- Do NOT calculate final payable or perform arithmetic with hospital/tariff values.
- Only extract what is explicitly stated in policy wording text.

## Extraction Rules
1. Identify explicit financial limits that represent a payable cap:
   - Procedure/package caps
   - Cataract/lens-related limits
   - Event-level sub-limits
2. If multiple limits exist, return the most directly applicable claim payable cap for this case context.
3. If policy wording does not provide a clear numeric cap for this case, return null.
4. Never invent, infer, estimate, or compute a value.

## Return ONLY
- benefitAmount → Numeric cap/benefit amount in INR when explicitly available; otherwise null
- adjustmentNotes → 1–2 short sentences explaining what cap was extracted, or why no explicit cap was found
- insurerType → one of: "niac", "psu", "other", "cant determine"
- policySegment → one of: "retail", "corporate", "cant determine"
- sumInsuredAmount → numeric sum insured in INR when explicit, else null
- niacFlexiFloater → true only when policy explicitly indicates NIAC Flexi Floater, else false
- hasNoCataractLimitClause → true only when wording explicitly indicates no cataract limit/cap/sublimit, else false
- geoLensCap7000Applicable → true only when wording explicitly indicates Tamil Nadu / Kerala / Kolkata / Delhi lens cap applicability, else false`;

export const benefitPlanLimitExtractionPrompt = (
  cappings: string[],
  diagnosis: string,
): string => `You are a health insurance claim processor extracting the applicable benefit plan limit for a patient's medical condition.

PATIENT DIAGNOSIS:
${diagnosis}

BENEFIT PLAN ALIGNMENT CAPPINGS (from the insurer's benefit plan database):
${cappings.join("\n")}

YOUR TASK:
From the cappings above, identify the single most applicable monetary limit (in INR) for this patient's diagnosis/condition.

Rules:
1. Look for a numeric amount (₹, Rs, INR) in the cappings that directly applies to the patient's condition.
2. If multiple limits exist, return the most specific and directly applicable one (e.g. a cataract-specific limit over a general eye limit).
3. Extract only the pure numeric value — no currency symbols, no commas. Example: if limit is ₹50,000 return 50000.
4. If no clear numeric limit is found, return null.
5. Never invent or estimate a value not explicitly present in the cappings.

Return ONLY a valid JSON object with no extra text:
{"benefitPlanLimit": <number or null>, "appliedCapping": "<the exact capping line used, or null>", "notes": "<1 sentence explanation>"}`;

export const tariffFileSelectionPrompt = (
  fileNames: string[],
  insurerCode: string,
  isPsu: boolean,
): string => `You are selecting the most appropriate tariff file for a health insurance claim.

INSURER CODE: ${insurerCode || "Unknown"}
INSURER TYPE: ${isPsu ? "PSU (Government/Public Sector Insurer)" : "Private Insurer"}

AVAILABLE TARIFF FILES:
${fileNames.map((f, i) => `${i + 1}. ${f}`).join("\n")}

SELECTION RULES (in priority order):
${isPsu ? `
PSU INSURER RULES:
P1 (Highest): Pick file whose name contains the insurer code/name — most specific match.
P2: Pick file containing "GIPSA" but NOT "SOC" — GIPSA standard tariff.
P3: Pick file containing both "GIPSA" and "SOC" — GIPSA SOC tariff.
P4: Pick file containing "All Insurer", "Pvt Insurer", or "Private Insurer".
P5: Pick file containing "FHPL", "Rate List", or "RateList" — FHPL fallback.
P6: Pick file containing "tariff".
P7 (Lowest): Any remaining file.
` : `
PRIVATE INSURER RULES:
P1 (Highest): Pick file whose name contains the insurer code/name — most specific match.
P2: Pick file containing "All Insurer", "Pvt Insurer", or "Private Insurer".
P3: Pick file containing "FHPL", "Rate List", or "RateList" — FHPL fallback.
P4: Pick file containing "tariff".
P5 (Lowest): Any remaining file.
`}

TIE-BREAKING RULE (when multiple files fall in the same priority tier):
- Extract any date from each filename.
- Pick the file with the LATEST date.
- If no date is found, prefer longer/more specific filenames.

Return ONLY a valid JSON object with no extra text:
{
  "selectedFile": "<exact filename from the list above>",
  "priorityTier": "<e.g. P1, P2, etc.>",
  "reason": "<one sentence explanation>"
}`;

/**
 * Previous-claim similarity comparison.
 *
 * Disease-aware: the similarity rules section branches on claimType.
 * This prompt stays inline (not moved to rules) because both branches
 * need to coexist in one prompt for the AI to evaluate them together
 * — moving them to per-disease files would require AI to know which
 * disease's rules to look at, defeating the purpose.
 */
export const previousClaimSimilarityPrompt = (
  currentClaim: {
    diagnosis: string;
    treatment: string;
    complaint: string;
    billAmount: number | null;
    hospital: string;
    eyeType?: string;
    deliveryType?: string;
  },
  previousClaim: {
    claimId: string;
    admissionDate: string | null;
    diagnosis: string | null;
    treatment: string | null;
    complaint: string | null;
    billAmount: number | null;
    approvedAmount: number | null;
    hospital: string | null;
  },
  benefitPlanLimit: number | null,
  claimType: ClaimType = "cataract",
): string => {
  const safe = coerceClaimType(claimType);
  return `You are a health insurance claim processor evaluating whether a current claim is similar to a previous claim for the same patient.

CLAIM TYPE: ${safe.toUpperCase()}

CURRENT CLAIM:
- Diagnosis: ${currentClaim.diagnosis}
- Treatment: ${currentClaim.treatment}
- Complaint/Condition: ${currentClaim.complaint}
- Bill Amount: ${currentClaim.billAmount ?? "Unknown"}
- Hospital: ${currentClaim.hospital}
${currentClaim.eyeType ? `- Eye: ${currentClaim.eyeType}` : ""}
${currentClaim.deliveryType ? `- Delivery Type: ${currentClaim.deliveryType}` : ""}

LATEST PREVIOUS CLAIM (same patient):
- Claim ID: ${previousClaim.claimId}
- Date: ${previousClaim.admissionDate ?? "Unknown"}
- Diagnosis: ${previousClaim.diagnosis ?? "Unknown"}
- Treatment: ${previousClaim.treatment ?? "Unknown"}
- Complaint/Condition: ${previousClaim.complaint ?? "Unknown"}
- Bill Amount: ${previousClaim.billAmount ?? "Unknown"}
- Approved Amount: ${previousClaim.approvedAmount ?? "Unknown"}
- Hospital: ${previousClaim.hospital ?? "Unknown"}

BENEFIT PLAN LIMIT: ${benefitPlanLimit ?? "Not available"}

YOUR TASK:
1. Determine if the current claim is SIMILAR to the previous claim.
${safe === "maternity"
  ? `   MATERNITY SIMILARITY RULES:
   - Normal delivery and Normal delivery = SIMILAR
   - C-Section and C-Section = SIMILAR
   - Normal delivery and C-Section = NOT SIMILAR (different delivery type, different limit applies)
   - Twins delivery = treat separately (may have surcharge)
   - Same episode of care / same pregnancy = NOT a separate claim`
  : `   CATARACT SIMILARITY RULES:
   - Left eye cataract and right eye cataract = SIMILAR (contralateral)
   - Same eye operated twice = review carefully
   - Different conditions or procedures = NOT SIMILAR`
}

2. If SIMILAR and the previous claim has an approved amount:
   - Check if the benefit plan limit covers the previously approved amount.
   - If yes → recommend approving the SAME amount as the previous claim.
   - If no → recommend approving up to the benefit plan limit.

3. If NOT SIMILAR → do not recommend any amount based on previous claim.

Return ONLY a valid JSON object with no extra text:
{
  "isSimilar": true or false,
  "similarityReason": "<one sentence explaining why similar or not>",
  "recommendedAmount": <number or null>,
  "recommendationBasis": "<one sentence: e.g. Same as previous claim approved amount of X, covered by benefit plan limit of Y>",
  "confidence": "high" or "medium" or "low"
}`;
};

/**
 * Benefit section summary — extracts disease-relevant points from a benefit
 * plan section (ailment / exclusions / copay / maternity).
 *
 * Disease-aware via claimType branches inside the prompt. Stays inline.
 */
export const benefitSectionSummaryPrompt = (
  section: "ailment" | "exclusions" | "copay" | "maternity",
  rawText: string,
  claimType?: string,
): string => {
  const safe = coerceClaimType(claimType);
  return `You are a health insurance claim processor reviewing a benefit plan.
Claim type: ${safe}

SECTION: ${
  section === "ailment"    ? "Ailment Cappings" :
  section === "exclusions" ? "Exclusions" :
  section === "copay"      ? "Co-Pay" :
  "Maternity Benefits"
}

RAW DATA:
${rawText}

${section === "ailment" ? `
TASK: Extract ONLY the benefit points that are DIRECTLY RELEVANT to a "${safe}" claim.

For cataract claims — include ONLY points about:
  Eye surgery, lens implants, IOL, phacoemulsification, cataract, ophthalmic procedures, LASIK, vitrectomy, glaucoma.
  EXCLUDE everything unrelated to eye/vision.

For maternity claims — include ONLY points about:
  Maternity, pregnancy, delivery, childbirth, C-section, LSCS, newborn care, obstetric complications.
  EXCLUDE everything unrelated to maternity.

For other claim types — include only the most relevant points based on the diagnosis.

Return a JSON array of short bullet point strings. Each point should be concise (max 15 words), specific, and include amounts/percentages where present.
Example: ["Cataract surgery covered up to Rs.40,000 per eye", "IOL implant included in limit", "Day-care procedure applicable"]

If no relevant points found, return: []
Return ONLY the raw JSON array. No markdown, no code fences, no explanation. Start your response with [ and end with ].
` : `
${section === "exclusions" ? `
List what is NOT covered or has waiting periods. Return a JSON array of short bullet strings.
Example: ["Pre-existing diseases covered after 36 months", "30-day waiting period from policy inception"]
Return ONLY the JSON array.
` : section === "copay" ? `
State the co-pay percentage/amount and when it applies. Return a JSON array of short bullet strings.
Return ONLY the raw JSON array. No markdown, no code fences. Start with [ end with ].
` : `
Extract: (1) Normal delivery limit, (2) C-Section limit, (3) childbirths covered, (4) waiting period, (5) copay exceptions.
Return a JSON array of short bullet strings with amounts.
Return ONLY the raw JSON array. No markdown, no code fences. Start with [ end with ].
`}
`}
`;
};

// ════════════════════════════════════════════════════════════════════
// SPECIALIZED MATERNITY HELPERS (kept for backward compat)
// These are standalone prompts called from specific places — moving them
// to the rules registry would require changing PromptConfig to allow
// multiple prompts per disease. Defer to v2 if needed.
// ════════════════════════════════════════════════════════════════════

export const maternityGPLAExtractionPrompt = (documentText: string): string => `You are a health insurance claim processor extracting GPLA information from maternity claim documents.

GPLA stands for:
- G = Gravida (total number of pregnancies including current)
- P = Para (number of deliveries, live or stillbirth)
- L = Living (number of currently living children) — MOST CRITICAL
- A = Abortion/Miscarriage (number of pregnancy losses)

DOCUMENT TEXT:
${documentText}

Look for GPLA notation in:
1. Ultrasound reports
2. Inpatient Initial Assessment form
3. Discharge summary
4. Doctor notes or clinical assessment
5. Any notation like "G2P1L1A0", "Gravida 2 Para 1", "2 living children", "first delivery" etc.

Extract:
- gpla: The full GPLA string if found (e.g. "G2P1L1A0")
- gravida: G value as number (total pregnancies)
- para: P value as number (deliveries)
- living: L value as number — CRITICAL for eligibility check
- abortion: A value as number
- deliveryType: "Normal" / "C-Section" / "Twins" / "Unknown" based on documents
- gestationalAge: gestational age in weeks if found (e.g. "38 weeks")
- sourceDocument: which document contained the GPLA info

Return ONLY valid JSON, no extra text:
{
  "gpla": "G2P1L1A0" or null,
  "gravida": 2 or null,
  "para": 1 or null,
  "living": 1 or null,
  "abortion": 0 or null,
  "deliveryType": "Normal" or "C-Section" or "Twins" or "Unknown",
  "gestationalAge": "38 weeks" or null,
  "sourceDocument": "Inpatient Initial Assessment" or "Ultrasound Report" or "Discharge Summary" or null
}`;

export const maternityBenefitRemarksPrompt = (remarks: string): string => `You are parsing maternity benefit plan remarks for a health insurance claim processor.

REMARKS TEXT:
${remarks}

Extract the following from the remarks:
1. normalDeliveryLimit: Maximum payable amount for Normal delivery (number in rupees)
2. cSectionLimit: Maximum payable amount for C-Section (number in rupees)
3. maxChildbirths: Maximum number of childbirths covered (number)
4. waitingPeriod: Waiting period — "Day 1" / "9 months" / "12 months" / other
5. copayException: Any special copay exception rule for maternity (text or null)
6. newbornCovered: Whether newborn baby is covered (true/false)
7. topUpAllowed: Whether top-up/super top-up can be used (true/false)

Return ONLY valid JSON:
{
  "normalDeliveryLimit": 50000 or null,
  "cSectionLimit": 75000 or null,
  "maxChildbirths": 2 or null,
  "waitingPeriod": "Day 1" or null,
  "copayException": "No copay if admissible amount above limit after deductions" or null,
  "newbornCovered": true or false,
  "topUpAllowed": true or false
}`;