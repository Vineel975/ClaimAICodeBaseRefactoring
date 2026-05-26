import { PdfAnalysis, MedicalAdmissibilityItem } from "./types";
import { logger } from "./logger";

export type ValidationStatus = "MATCH" | "EXCEEDS" | "BELOW" | "ERROR";

export interface ValidationResult {
  sumOfServices: number;
  totalAmount: number;
  difference: number;
  matches: boolean;
  status: ValidationStatus;
  gstAmount?: number;
  sumWithGST?: number;
}

export function normalizeMedicalAdmissibility(
  item: MedicalAdmissibilityItem,
): MedicalAdmissibilityItem | null {
  const normalizedConditionTests =
    item.conditionTests && Array.isArray(item.conditionTests)
      ? item.conditionTests
          .map((condition) => {
            const numericValue =
              condition.numericValue === null ||
              condition.numericValue === undefined ||
              Number.isNaN(Number(condition.numericValue))
                ? null
                : Number(condition.numericValue);
            return { ...condition, numericValue };
          })
          .filter(
            (condition) => condition.testName && condition.testName.trim().length > 0,
          )
      : [];

  const normalized: MedicalAdmissibilityItem = {
    ...item,
    diagnosis:
      item.diagnosis === null || item.diagnosis === undefined
        ? ""
        : item.diagnosis,
    doctorNotes:
      item.doctorNotes === null || item.doctorNotes === undefined
        ? ""
        : item.doctorNotes,
    presentingComplaint:
      item.presentingComplaint === null || item.presentingComplaint === undefined
        ? ""
        : item.presentingComplaint,
    conditionTests: normalizedConditionTests,
  };

  // Return null only if ALL meaningful fields are empty
  if (
    !normalized.diagnosis &&
    !normalized.doctorNotes &&
    !normalized.presentingComplaint &&
    !normalized.conditionTests.length
  ) {
    return null;
  }

  return normalized;
}

function parseAmount(amount: number | null | undefined): number {
  if (amount === null || amount === undefined || isNaN(amount)) return 0;
  return amount;
}

export function validateSumAmount(
  analysis: PdfAnalysis,
  tolerance: number = 1.0,
): ValidationResult {
  let sumOfServices = 0;
  let servicesCount = 0;

  if (analysis?.services) {
    for (const service of analysis.services) {
      const amount = parseAmount(
        typeof service?.amount === "number" ? service.amount : undefined,
      );
      sumOfServices += amount;
      servicesCount++;
    }
  }

  const totalAmount = parseAmount(analysis?.totalAmount?.value);
  const discountAmount = parseAmount(analysis?.discount?.value);
  const gstAmount = parseAmount(analysis?.gst?.value?.gstAmount);
  const cgstAmount = parseAmount(analysis?.gst?.value?.cgstAmount);
  const sgstAmount = parseAmount(analysis?.gst?.value?.sgstAmount);
  const calculatedGST = gstAmount || cgstAmount + sgstAmount;

  const expectedTotal = totalAmount + discountAmount;
  const sumWithGST = sumOfServices + calculatedGST;

  const diffWithoutGST = Math.abs(sumOfServices - expectedTotal);
  const diffWithGST =
    calculatedGST > 0 ? Math.abs(sumWithGST - expectedTotal) : Infinity;

  let comparisonSum: number;
  let difference: number;
  if (diffWithGST < diffWithoutGST) {
    comparisonSum = sumWithGST;
    difference = diffWithGST;
  } else {
    comparisonSum = sumOfServices;
    difference = diffWithoutGST;
  }

  const isError = servicesCount === 0;
  const matches = !isError && difference <= tolerance;
  const status: ValidationStatus = isError
    ? "ERROR"
    : matches
      ? "MATCH"
      : comparisonSum > expectedTotal
        ? "EXCEEDS"
        : "BELOW";

  logger.debug(
    `[DEBUG] validateSumAmount: Validation result - services: ${servicesCount}, sumOfServices: ${sumOfServices.toFixed(
      2,
    )}, totalAmount: ${totalAmount.toFixed(2)}, discount: ${discountAmount.toFixed(
      2,
    )}, expectedTotal: ${expectedTotal.toFixed(2)}, GST: ${calculatedGST.toFixed(
      2,
    )}, difference: ${difference.toFixed(2)}, tolerance: ${tolerance}, status: ${status}, matches: ${matches}`,
  );

  return {
    sumOfServices,
    totalAmount,
    difference,
    matches,
    status,
    gstAmount:
      diffWithGST < diffWithoutGST && calculatedGST > 0
        ? calculatedGST
        : undefined,
    sumWithGST:
      diffWithGST < diffWithoutGST && calculatedGST > 0
        ? sumWithGST
        : undefined,
  };
}