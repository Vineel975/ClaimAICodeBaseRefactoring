import path from "path";
import { ExtractionResult } from "./types";
import { validateSumAmount, type ValidationStatus } from "./shared-utils";
import { logger } from "./logger";

export interface FileValidation {
  file: string;
  sumOfServices: number;
  totalAmount: number;
  difference: number;
  matches: boolean;
  status: ValidationStatus;
  services: number;
  gstAmount?: number;
  sumWithGST?: number;
}

export interface EvaluationResult {
  fileValidations: FileValidation[];
  matchingFiles: number;
  mismatchingFiles: number;
}

export function evaluate(results: ExtractionResult[]): EvaluationResult {
  const fileValidations: FileValidation[] = [];
  let matchingFiles = 0;
  let mismatchingFiles = 0;

  for (const result of results) {
    // Use shared validation function
    const validation = validateSumAmount(result.analysis || ({}));

    // Count services
    let fileServicesCount = 0;
    if (result.analysis?.services && Array.isArray(result.analysis.services)) {
      fileServicesCount = result.analysis.services.length;
    }

    if (validation.matches) {
      matchingFiles++;
    } else {
      mismatchingFiles++;
    }

    const fileName = path.basename(result.filePath || "");

    fileValidations.push({
      file: fileName,
      sumOfServices: validation.sumOfServices,
      totalAmount: validation.totalAmount,
      difference: validation.difference,
      matches: validation.matches,
      status: validation.status,
      services: fileServicesCount,
      gstAmount: validation.gstAmount,
      sumWithGST: validation.sumWithGST,
    });
  }

  logger.debug(
    `[DEBUG] evaluate: Completed - matching: ${matchingFiles}, mismatching: ${mismatchingFiles}`
  );
  return {
    fileValidations: fileValidations.sort(
      (a, b) => b.difference - a.difference
    ),
    matchingFiles,
    mismatchingFiles,
  };
}
