import type {
  HospitalBillBreakdownItem,
  LensTypeApproval,
  PdfAnalysis,
  TariffBreakdownItem,
} from "./types";

export type LensCategory =
  | "monofocal"
  | "multifocal"
  | "other"
  | "cant determine";

export interface ClaimCalculationResult {
  hospitalBillAfterDiscount: number;
  hospitalBillBeforeDiscount: number;
  discount: number;
  insurerPayable: number;
  totalAmountApproved: number | null;
  finalInsurerPayable: number | null;
  finalInsurerPayableNotes: string;
  benefitAmount: number | null;
  tariffTotal: number | null;
  procedurePackageAmount: number | null;
  tariffLensAmount: number | null;
  hospitalLensAmount: number | null;
  completePackage: boolean;
  hasCataract: boolean;
  lensCategory: LensCategory;
  lensTypeApproved: LensTypeApproval | null;
  tariffLensExcluded: boolean;
  isNIAC: boolean;
  appliedRule: string;
}

interface CataractPolicyContext {
  isNIAC: boolean;
  isPSU: boolean;
  isNIACFlexiFloater: boolean;
  isRetailPolicy: boolean;
  isCorporatePolicy: boolean;
  hasNoCataractLimitClause: boolean;
  sumInsured: number | null;
  hasMetroSouthLensCap7000: boolean;
}

function normalizeAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^0-9.]/g, "");
    if (!cleaned) return 0;
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

function isLensComponent(name?: string | null, code?: string | null): boolean {
  return /lens|iol|implant/i.test(`${name || ""} ${code || ""}`);
}

function sumHospitalBillBreakdown(
  items?: HospitalBillBreakdownItem[] | null,
): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + normalizeAmount(item?.amount), 0);
}

function sumLensFromHospital(items?: HospitalBillBreakdownItem[] | null): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    return isLensComponent(item?.name) ? sum + normalizeAmount(item?.amount) : sum;
  }, 0);
}

function sumTariff(items?: TariffBreakdownItem[] | null): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => sum + normalizeAmount(item?.amount), 0);
}

function sumLensFromTariff(items?: TariffBreakdownItem[] | null): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    return isLensComponent(item?.name, item?.code)
      ? sum + normalizeAmount(item?.amount)
      : sum;
  }, 0);
}

function detectCataractClaim(analysis: Partial<PdfAnalysis>): boolean {
  const medicalAdmissibility = analysis.medicalAdmissibility;
  if (!medicalAdmissibility) return false;

  const diagnosis = (medicalAdmissibility.diagnosis || "").toLowerCase();
  const doctorNotes = (medicalAdmissibility.doctorNotes || "").toLowerCase();

  if (diagnosis.includes("cataract") || doctorNotes.includes("cataract")) {
    return true;
  }

  const conditionTests = Array.isArray(medicalAdmissibility.conditionTests)
    ? medicalAdmissibility.conditionTests
    : [];

  return conditionTests.some((item) => {
    const condition = (item.condition || "").toLowerCase();
    const matchedDiagnosis = (item.matchedDiagnosis || "").toLowerCase();
    return (
      condition.includes("cataract") ||
      condition.includes("a-scan") ||
      matchedDiagnosis.includes("cataract")
    );
  });
}

function getLensCategory(lensType?: string | null): LensCategory {
  const normalized = (lensType || "").trim().toLowerCase();
  if (!normalized || normalized === "cant determine") return "cant determine";
  if (/(mono|uni)focal/.test(normalized)) return "monofocal";
  if (/multifocal|bifocal|trifocal|edof|progressive/.test(normalized)) return "multifocal";
  return "other";
}

function detectLensExcludedFromPackage(analysis: Partial<PdfAnalysis>): boolean {
  const tariffItems = Array.isArray(analysis.tariffExtractionItem)
    ? analysis.tariffExtractionItem
    : [];
  const combinedText = [
    analysis.tariffNotes,
    analysis.tariffClarificationNote,
    ...tariffItems.map((item) => item.name),
    ...tariffItems.map((item) => item.code),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /excluding lens|exclusive of lens|lens excluded|without lens|excluding iol|iol excluded|excluding implant|implant excluded/.test(
    combinedText,
  );
}

function buildCataractPolicyContext(
  analysis: Partial<PdfAnalysis>,
): CataractPolicyContext {
  const aiContext = analysis.policyRuleContext;
  const insurerType = aiContext?.insurerType;
  const policySegment = aiContext?.policySegment;

  return {
    isNIAC: insurerType === "niac",
    isPSU: insurerType === "psu",
    isNIACFlexiFloater: aiContext?.niacFlexiFloater === true,
    isRetailPolicy: policySegment === "retail",
    isCorporatePolicy: policySegment === "corporate",
    hasNoCataractLimitClause: aiContext?.hasNoCataractLimitClause === true,
    sumInsured:
      typeof aiContext?.sumInsuredAmount === "number" &&
      Number.isFinite(aiContext.sumInsuredAmount) &&
      aiContext.sumInsuredAmount > 0
        ? aiContext.sumInsuredAmount
        : null,
    hasMetroSouthLensCap7000: aiContext?.geoLensCap7000Applicable === true,
  };
}

/**
 * Compute the monofocal-equivalent tariff amount.
 *
 * Rules:
 *  - Monofocal/Unifocal lens: use tariff as-is (payable irrespective of brand).
 *  - Multifocal lens: restrict to (procedure package + monofocal lens R&C).
 *    i.e. replace the multifocal lens cost with the tariff lens R&C amount.
 *  - If lens excluded from package: add lens R&C separately.
 */
function computeMonofocalEquivalent(
  lensCategory: LensCategory,
  tariffTotalRaw: number,
  tariffLensAmountRaw: number,
  procedurePackageAmountRaw: number,
  tariffLensExcluded: boolean,
): { amount: number; notes: string[] } {
  const notes: string[] = [];

  if (lensCategory === "multifocal") {
    // Multifocal → restrict to procedure package + monofocal R&C lens cost
    // The tariff lens amount IS the monofocal R&C reference from tariff
    const monofocalLensRc = tariffLensAmountRaw;
    const procedurePart = procedurePackageAmountRaw > 0
      ? procedurePackageAmountRaw
      : Math.max(tariffTotalRaw - tariffLensAmountRaw, 0);
    const restricted = procedurePart + monofocalLensRc;
    notes.push(
      `Multifocal lens detected. Restricted to monofocal/unifocal lens R&C (INR ${monofocalLensRc.toFixed(2)}) plus procedure package (INR ${procedurePart.toFixed(2)}) = INR ${restricted.toFixed(2)}.`,
    );
    return { amount: restricted, notes };
  }

  if (lensCategory === "monofocal") {
    notes.push("Monofocal/unifocal lens is payable irrespective of brand name.");
  }

  if (tariffLensExcluded) {
    // Package excludes lens — add lens R&C on top of procedure package
    const amount = procedurePackageAmountRaw + tariffLensAmountRaw;
    notes.push(
      `Tariff package excludes lens. Procedure package (INR ${procedurePackageAmountRaw.toFixed(2)}) plus monofocal lens R&C (INR ${tariffLensAmountRaw.toFixed(2)}) = INR ${amount.toFixed(2)}.`,
    );
    return { amount, notes };
  }

  return { amount: tariffTotalRaw, notes };
}

export function computeClaimCalculation(
  analysis: Partial<PdfAnalysis>,
): ClaimCalculationResult {
  const hospitalBillBreakdown = Array.isArray(analysis.hospitalBillBreakdown)
    ? analysis.hospitalBillBreakdown
    : [];
  const tariffExtractionItem = Array.isArray(analysis.tariffExtractionItem)
    ? analysis.tariffExtractionItem
    : [];

  const discount = normalizeAmount(analysis.discount?.value);
  const totalAmount = normalizeAmount(analysis.totalAmount?.value);
  const hospitalBillFromBreakdown = sumHospitalBillBreakdown(hospitalBillBreakdown);
  const tariffTotalRaw = sumTariff(tariffExtractionItem);
  const tariffTotal = tariffTotalRaw > 0 ? tariffTotalRaw : null;
  const tariffLensAmountRaw = sumLensFromTariff(tariffExtractionItem);
  const tariffLensAmount = tariffLensAmountRaw > 0 ? tariffLensAmountRaw : null;
  const procedurePackageAmountRaw =
    tariffTotalRaw > 0 ? Math.max(tariffTotalRaw - tariffLensAmountRaw, 0) : 0;
  const procedurePackageAmount =
    procedurePackageAmountRaw > 0 ? procedurePackageAmountRaw : null;
  const hospitalLensAmountRaw = sumLensFromHospital(hospitalBillBreakdown);
  const hospitalLensAmount =
    hospitalLensAmountRaw > 0 ? hospitalLensAmountRaw : null;
  const benefitAmountRaw = normalizeAmount(analysis.benefitAmount);
  const benefitAmount = benefitAmountRaw > 0 ? benefitAmountRaw : null;
  const completePackage = analysis.isAllInclusivePackage === true;
  const hospitalBillAfterDiscount =
    completePackage &&
    totalAmount > 0 &&
    hospitalBillFromBreakdown > 0 &&
    totalAmount <= hospitalBillFromBreakdown
      ? totalAmount
      : hospitalBillFromBreakdown > 0
        ? hospitalBillFromBreakdown
        : totalAmount;
  const hospitalBillBeforeDiscount =
    totalAmount > 0 ? totalAmount + discount : hospitalBillAfterDiscount;
  const baseInsurerPayable = Math.max(hospitalBillAfterDiscount, 0);
  const hasCataract = detectCataractClaim(analysis);
  const lensCategory = getLensCategory(analysis.lensType);
  const lensTypeApproved = analysis.lensTypeApproved ?? null;
  const tariffLensExcluded = detectLensExcludedFromPackage(analysis);
  const policyContext = buildCataractPolicyContext(analysis);

  let appliedRule = "standard_billed_or_tariff";
  let finalInsurerPayable: number | null = null;
  const notes: string[] = [];

  // ── NON-CATARACT ──────────────────────────────────────────────────────────
  if (!hasCataract) {
    const tariffCappedAmount =
      tariffTotal !== null
        ? Math.min(baseInsurerPayable, tariffTotal)
        : baseInsurerPayable;
    finalInsurerPayable =
      benefitAmount !== null
        ? Math.min(tariffCappedAmount, benefitAmount)
        : tariffCappedAmount;
    notes.push(
      benefitAmount !== null
        ? `No cataract-specific rule triggered. Applied lower of billed/tariff amount and policy limit INR ${benefitAmount.toFixed(2)}.`
        : "No cataract-specific rule triggered. Applied billed amount capped by available tariff when present.",
    );

  // ── CATARACT ──────────────────────────────────────────────────────────────
  } else {

    // ── NIAC Flexi Floater (highest priority NIAC rule) ───────────────────
    if (policyContext.isNIACFlexiFloater) {
      const niacFlexiCap = 24000;
      const tariffCapped =
        tariffTotal !== null ? Math.min(baseInsurerPayable, tariffTotal) : baseInsurerPayable;
      const policyCapApplied =
        benefitAmount !== null ? Math.min(tariffCapped, benefitAmount) : tariffCapped;
      finalInsurerPayable = Math.min(policyCapApplied, niacFlexiCap);
      appliedRule = "niac_flexi_floater_cap_24000";
      notes.push("NIAC Flexi Floater cataract rule applied. Maximum payable capped at INR 24,000.00.");
      if (benefitAmount !== null) {
        notes.push(`Policy cataract limit INR ${benefitAmount.toFixed(2)} considered before applying NIAC Flexi cap.`);
      }

    // ── Standard cataract logic ───────────────────────────────────────────
    } else {

      // Step A: Compute monofocal-equivalent tariff (handles multifocal restriction)
      const hasHospitalPackage =
        procedurePackageAmount !== null || (tariffTotal !== null && !tariffLensExcluded);

      const { amount: monofocalEquivalentAmount, notes: lensNotes } =
        computeMonofocalEquivalent(
          lensCategory,
          tariffTotalRaw,
          tariffLensAmountRaw,
          procedurePackageAmountRaw,
          tariffLensExcluded,
        );
      notes.push(...lensNotes);

      let allowedBeforeHospitalCap: number;

      // ── RULE 1: Policy cataract limit AND hospital package → lower of both ──
      if (benefitAmount !== null && hasHospitalPackage) {
        allowedBeforeHospitalCap = Math.min(benefitAmount, monofocalEquivalentAmount);
        appliedRule = "policy_limit_or_hospital_package_lower";
        notes.push(
          `Applied lower of policy cataract limit INR ${benefitAmount.toFixed(2)} and hospital package/R&C INR ${monofocalEquivalentAmount.toFixed(2)}.`,
        );

      // ── RULE 2: No policy limit → hospital package (monofocal only) ──────
      } else if (benefitAmount === null && hasHospitalPackage) {

        if (tariffLensExcluded) {
          // Package excludes lens — add lens R&C separately
          let packagePlusLensRc = monofocalEquivalentAmount;

          if (policyContext.isPSU) {
            // PSU-specific sub-rules
            const isRetailUpToFiveLakhs =
              policyContext.isRetailPolicy &&
              policyContext.sumInsured !== null &&
              policyContext.sumInsured <= 500000;
            const isCorporateAboveFiveLakhs =
              policyContext.isCorporatePolicy &&
              policyContext.sumInsured !== null &&
              policyContext.sumInsured > 500000;
            let payableLens = tariffLensAmountRaw;

            if (policyContext.hasMetroSouthLensCap7000 && payableLens > 0) {
              payableLens = Math.min(payableLens, 7000);
              notes.push("PSU geography lens cap applied: monofocal lens admissibility restricted to INR 7,000.00.");
            }

            packagePlusLensRc = procedurePackageAmountRaw + payableLens;

            if (isRetailUpToFiveLakhs) {
              allowedBeforeHospitalCap = packagePlusLensRc;
              appliedRule = "psu_retail_upto_5l_package_plus_lens";
              notes.push("PSU retail policy up to INR 5,00,000 sum insured: PPN package plus monofocal lens allowed.");
            } else if (isCorporateAboveFiveLakhs && policyContext.hasNoCataractLimitClause) {
              allowedBeforeHospitalCap = Math.min(packagePlusLensRc, 45000);
              appliedRule = "psu_corporate_above_5l_no_cataract_limit_cap_45000";
              notes.push("PSU corporate policy above INR 5,00,000 with no cataract limit clause: package plus monofocal lens capped at INR 45,000.00.");
            } else if (isCorporateAboveFiveLakhs) {
              allowedBeforeHospitalCap = packagePlusLensRc;
              appliedRule = "psu_corporate_above_5l_package_plus_lens";
              notes.push("PSU corporate policy above INR 5,00,000: PPN package plus monofocal lens allowed.");
            } else {
              allowedBeforeHospitalCap = packagePlusLensRc;
              appliedRule = "psu_no_policy_limit_package_plus_lens";
              notes.push("PSU no-policy-limit cataract package excludes lens: procedure package plus monofocal lens applied.");
            }
          } else {
            allowedBeforeHospitalCap = packagePlusLensRc;
            appliedRule = policyContext.isNIAC
              ? "niac_no_policy_limit_lens_excluded"
              : "no_policy_limit_package_excludes_lens";
            notes.push("No policy cataract limit found. Package excludes lens, so procedure package plus monofocal lens R&C is applied.");
          }

          // ── RULE 4: NIAC + no policy limit + package excludes lens → cap ₹50,000 ──
          if (policyContext.isNIAC) {
            allowedBeforeHospitalCap = Math.min(allowedBeforeHospitalCap, 50000);
            appliedRule = "niac_no_policy_limit_lens_excluded";
            notes.push("NIAC exception applied: payable capped at INR 50,000.00 when no policy limit exists and the package excludes lens.");
          }

        } else {
          // Package includes lens — use monofocal equivalent package
          allowedBeforeHospitalCap = monofocalEquivalentAmount;
          appliedRule = "no_policy_limit_use_hospital_package";
          notes.push(
            lensCategory === "multifocal"
              ? "No policy cataract limit found. Agreed monofocal package selected and multifocal lens cost is restricted to monofocal equivalent package value."
              : "No policy cataract limit found. Agreed monofocal hospital package selected.",
          );
        }

      // ── RULE 3: No policy limit + No package + Lens excluded → R&C lens only ──
      } else if (
        benefitAmount === null &&
        !hasHospitalPackage &&
        tariffLensExcluded &&
        tariffLensAmountRaw > 0
      ) {
        allowedBeforeHospitalCap = tariffLensAmountRaw;
        appliedRule = "no_policy_limit_no_package_lens_rc_only";
        notes.push("No policy limit and no hospital package available. Applied R&C lens amount only.");

      // ── Fallback: policy limit only, no package reference ─────────────────
      } else if (benefitAmount !== null) {
        allowedBeforeHospitalCap = Math.min(baseInsurerPayable, benefitAmount);
        appliedRule = "policy_limit_without_package";
        notes.push(`Policy cataract limit INR ${benefitAmount.toFixed(2)} applied because no package/R&C reference was available.`);

      // ── Last resort: billed amount only ───────────────────────────────────
      } else {
        allowedBeforeHospitalCap = baseInsurerPayable;
        appliedRule = "billed_amount_only";
        notes.push("Cataract detected, but no policy limit or package reference was available. Applied billed amount.");
      }

      finalInsurerPayable = Math.min(allowedBeforeHospitalCap, baseInsurerPayable);
    }
  }

  if (finalInsurerPayable !== null && finalInsurerPayable < baseInsurerPayable) {
    notes.push(
      `Final payable restricted to INR ${finalInsurerPayable.toFixed(2)} against billed amount INR ${baseInsurerPayable.toFixed(2)}.`,
    );
  }

  if (
    lensTypeApproved === false &&
    !notes.some((note) => note.toLowerCase().includes("not approved"))
  ) {
    notes.push("Lens type is marked as not approved by tariff/policy interpretation.");
  }

  return {
    hospitalBillAfterDiscount,
    hospitalBillBeforeDiscount,
    discount,
    insurerPayable: baseInsurerPayable,
    totalAmountApproved: finalInsurerPayable,
    finalInsurerPayable,
    finalInsurerPayableNotes: notes.join(" "),
    benefitAmount,
    tariffTotal,
    procedurePackageAmount,
    tariffLensAmount,
    hospitalLensAmount,
    completePackage,
    hasCataract,
    lensCategory,
    lensTypeApproved,
    tariffLensExcluded,
    isNIAC: policyContext.isNIAC,
    appliedRule,
  };
}