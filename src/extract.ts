import { generateObject, NoObjectGeneratedError } from "ai";
import { getModel, ModelProvider } from "./model-provider";
import {
  ExtractionResult,
  PdfAnalysis,
  PdfDocument,
  ServiceItem,
  HospitalSummaryItem,
  MedicalAdmissibilityItem,
  PolicyEnrichmentData,
} from "./types";
import {
  baseDocumentSchema,
  medicalAdmissibilityItemSchema,
} from "./models";
import {
  CostTracker,
  TokenUsage,
  createTokenUsage,
} from "./cost-tracker";
import { z } from "zod";
import {
  normalizeMedicalAdmissibility,
} from "./shared-utils";
import {
  baseDocumentExtractionPrompt,
  medicalAdmissibilityExtractionPrompt,
} from "./prompts";
import { logger } from "./logger";
import { coerceClaimType, type ClaimType } from "../lib/rules";

type DeductibleEntry = {
  serviceIndex: number;
  tariffDeductibleAmount?: number;
  policyDeductibleAmount?: number;
  nme?: number;
};

interface ProcessPdfOptions {
  fileName: string;
  pdfBuffer: Buffer;
  pdfUrl?: string; // optional URL — passed directly to AI, avoids holding buffer in AI call
  modelName: string;
  provider: ModelProvider;
  providers: any;
  baseDocument?: PdfDocument;
  medicalAdmissibility?: MedicalAdmissibilityItem | null;
  claimType?: ClaimType;
}


interface ProcessBaseDocumentOptions {
  fileName: string;
  pdfBuffer: Buffer;
  pdfUrl?: string;
  modelName: string;
  provider: ModelProvider;
  providers: any;
}

interface ProcessMedicalAdmissibilityOptions {
  fileName: string;
  pdfBuffer: Buffer;
  pdfUrl?: string;
  modelName: string;
  provider: ModelProvider;
  providers: any;
  claimType?: ClaimType;
}

const MAX_LOG_TEXT_LENGTH = 500;

function formatGeneratedTextForLog(text: string | undefined): string {
  if (!text) return "<empty>";

  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_LOG_TEXT_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_LOG_TEXT_LENGTH)}... [truncated ${normalized.length - MAX_LOG_TEXT_LENGTH} chars]`;
}

function summarizeBaseDocumentExtraction(
  object: z.infer<typeof baseDocumentSchema>,
): Record<string, unknown> {
  return {
    hospitalName: object.hospitalName?.value ?? null,
    patientName: object.patientName?.value ?? null,
    totalAmount: object.totalAmount?.value ?? null,
    hasBreakdown: Boolean(object.hospitalBillBreakdown?.length),
    checklist: object.documentChecklist,
  };
}

async function processMedicalAdmissibilityWithAI({
  fileName,
  pdfBuffer,
  pdfUrl,
  modelName,
  provider,
  providers,
  claimType = "cataract",
}: ProcessMedicalAdmissibilityOptions): Promise<{
  medicalAdmissibility: MedicalAdmissibilityItem | null;
  cost: number;
  usage: TokenUsage;
}> {
  // Safely coerce claimType — handles invalid input from upstream callers.
  // Falls back to "other" for anything not in the registry.
  const claimTypeSafe: ClaimType = coerceClaimType(claimType);

  logger.debug(
    `[DEBUG] processMedicalAdmissibilityWithAI: Starting extraction`
  );
  try {
    const { object, usage } = await generateObject({
      model: getModel({ provider, modelName }),
      schema: medicalAdmissibilityItemSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: medicalAdmissibilityExtractionPrompt(claimTypeSafe) },
            {
              type: "file",
              data: pdfBuffer,
              mediaType: "application/pdf",
              filename: fileName,
            },
          ],
        },
      ],
    });

    // getTokenCosts removed — was triggering FetchModelsError on backends without internet.
    // Token cost telemetry is non-essential.
    const costs = { totalUSD: 0 };

    const normalizedMedicalAdmissibility =
      normalizeMedicalAdmissibility(object);

    return {
      medicalAdmissibility: normalizedMedicalAdmissibility,
      cost: costs.totalUSD || 0,
      usage: createTokenUsage(usage.inputTokens || 0, usage.outputTokens || 0),
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      logger.error(
        `[ERROR] processMedicalAdmissibilityWithAI: Model failed to generate object (NoObjectGeneratedError)`
      );
      logger.error(`[ERROR] Cause:`, error.cause);
      logger.error(
        `[ERROR] Generated text snippet:`,
        formatGeneratedTextForLog(error.text)
      );
      logger.error(`[ERROR] Finish reason:`, error.finishReason);
      if (error.usage) {
        logger.error(`[ERROR] Token usage:`, error.usage);
      }
    } else {
      logger.error(
        `[ERROR] processMedicalAdmissibilityWithAI: Error occurred:`,
        error
      );
    }
    // Return null if extraction fails
    return {
      medicalAdmissibility: null,
      cost: 0,
      usage: createTokenUsage(0, 0),
    };
  }
}

async function processBaseDocumentWithAI({
  fileName,
  pdfBuffer,
  pdfUrl,
  modelName,
  provider,
  providers,
}: ProcessBaseDocumentOptions): Promise<{
  baseDocument: z.infer<typeof baseDocumentSchema>;
  cost: number;
  usage: TokenUsage;
}> {
  logger.debug(
    `[DEBUG] processBaseDocumentWithAI: Starting extraction (using full PDF)`
  );
  try {
    const { object, usage } = await generateObject({
      model: getModel({ provider, modelName }),
      schema: baseDocumentSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: baseDocumentExtractionPrompt },
            {
              type: "file",
              data: pdfBuffer,
              mediaType: "application/pdf",
              filename: fileName,
            },
          ],
        },
      ],
    });

    // getTokenCosts removed — was triggering FetchModelsError on backends without internet.
    // Token cost telemetry is non-essential.
    const costs = { totalUSD: 0 };

    logger.debug(
      `[DEBUG] processBaseDocumentWithAI: Base document extraction summary:`,
      summarizeBaseDocumentExtraction(object)
    );

    return {
      baseDocument: object,
      cost: costs.totalUSD || 0,
      usage: createTokenUsage(usage.inputTokens || 0, usage.outputTokens || 0),
    };
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      logger.error(
        `[ERROR] processBaseDocumentWithAI: Model failed to generate object (NoObjectGeneratedError)`
      );
      logger.error(`[ERROR] Cause:`, error.cause);
      logger.error(
        `[ERROR] Generated text snippet:`,
        formatGeneratedTextForLog(error.text)
      );
      logger.error(`[ERROR] Finish reason:`, error.finishReason);
      if (error.usage) {
        logger.error(`[ERROR] Token usage:`, error.usage);
      }
    } else {
      logger.error(`[ERROR] processBaseDocumentWithAI: Error occurred:`, error);
    }
    throw error;
  }
}

async function processPdfWithAI({
  fileName,
  pdfBuffer,
  pdfUrl,
  modelName,
  provider,
  providers,
  baseDocument: providedBaseDocument,
  medicalAdmissibility: providedMedicalAdmissibility,
  claimType = "cataract",
    }: ProcessPdfOptions): Promise<{
  analysis: PdfAnalysis;
  cost: number;
  usage: TokenUsage;
}> {
  logger.debug(`[DEBUG] processPdfWithAI: Starting processing`);

  // Safely coerce claimType — defensive against invalid upstream values.
  const claimTypeSafe: ClaimType = coerceClaimType(claimType);

  const costs = new CostTracker();

  let baseDocument: z.infer<typeof baseDocumentSchema>;
  let hospitalSummary: HospitalSummaryItem[] = [];
  let medicalAdmissibility: MedicalAdmissibilityItem | null = null;
  let normalizedServices: ServiceItem[] | null = null;

  logger.debug(
    `[DEBUG] processPdfWithAI: Step 1/2 - document sections (base document, hospital summary, medical admissibility)`
  );
  try {
    const hasProvidedSections = providedMedicalAdmissibility !== undefined;

    if (!providedBaseDocument) {
      logger.debug(
        `[DEBUG] processPdfWithAI: Starting base document and medical admissibility extraction`
      );
      const [baseDocResult, admissResult] = await Promise.all([
        processBaseDocumentWithAI({
          fileName,
          pdfBuffer,
          pdfUrl,
          modelName,
          provider,
          providers,
        }),
        processMedicalAdmissibilityWithAI({
          fileName,
          pdfBuffer,
          pdfUrl,
          modelName,
          provider,
          providers,
          claimType: claimTypeSafe,
        }),
      ]);

      logger.debug(
        `[DEBUG] processPdfWithAI: ✓ Base document and medical admissibility extraction completed`
      );
      baseDocument = baseDocResult.baseDocument;
      hospitalSummary = [];
      medicalAdmissibility = admissResult.medicalAdmissibility;
      costs.addCostedData(baseDocResult);
      costs.addCostedData(admissResult);
    } else if (hasProvidedSections) {
      logger.debug(`[DEBUG] processPdfWithAI: Using provided base document`);
      baseDocument = providedBaseDocument;
      hospitalSummary = [];
      medicalAdmissibility = providedMedicalAdmissibility || null;
      logger.debug(
        `[DEBUG] processPdfWithAI: ✓ Reuse complete - medical admissibility: ${medicalAdmissibility ? "present" : "missing"}`
      );
    } else {
      logger.debug(`[DEBUG] processPdfWithAI: Using provided base document`);
      logger.debug(
        `[DEBUG] processPdfWithAI: Starting medical admissibility extraction`
      );
      baseDocument = providedBaseDocument;
      const admissResult = await processMedicalAdmissibilityWithAI({
        fileName,
        pdfBuffer,
        pdfUrl,
        modelName,
        provider,
        providers,
        claimType: claimTypeSafe,
      });
      logger.debug(
        `[DEBUG] processPdfWithAI: ✓ Medical admissibility extraction completed`
      );
      hospitalSummary = [];
      medicalAdmissibility = admissResult.medicalAdmissibility;
      costs.addCostedData(admissResult);
    }
  } catch (error) {
    logger.error(`[ERROR] processPdfWithAI: Document section failed`, error);
    throw error;
  }

  logger.debug(
    `[DEBUG] processPdfWithAI: ✓ Document sections ready - hospital summary items: ${hospitalSummary.length
    }, medical admissibility: ${medicalAdmissibility ? "present" : "missing"}`
  );

  normalizedServices = [];
  const policyEnrichment: PolicyEnrichmentData = {};
  const serviceDeductibles: DeductibleEntry[] = [];

  const analysis: PdfAnalysis = {
    ...baseDocument,
    ...policyEnrichment,
    tariffNotes: "cant determine",
    tariffClarificationNote: "cant determine",
    tariffExtractionItem: [],
    isAllInclusivePackage: baseDocument.isAllInclusivePackage ?? false,
    eyeType: "cant determine",
    tariffPageNumber: null,
    services: normalizedServices || [],
    serviceDeductibles:
      serviceDeductibles.length > 0 ? serviceDeductibles : undefined,
    hospitalSummary: hospitalSummary.length > 0 ? hospitalSummary : undefined,
    medicalAdmissibility: medicalAdmissibility || undefined,
  };

  const { totalCost, usage } = costs.snapshot();
  logger.debug(
    `[DEBUG] processPdfWithAI: ✓ Processing completed (tokens: ${usage.totalTokens})`
  );
  return { analysis, cost: totalCost, usage };
}

export interface ProcessSinglePdfOptions {
  fileName: string;
  pdfBuffer: Buffer;
  pdfUrl?: string; // optional — passed to AI directly, avoids memory issues for large files
  modelName: string;
  provider: ModelProvider;
  providers: any;
  timeoutMs?: number;
  claimType?: ClaimType;
}

export interface ProcessSinglePdfResult {
  result: ExtractionResult;
  totals: {
    totalCost: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    successCount: number;
    errorCount: number;
    totalTimeMs: number;
  };
}

export async function processSinglePdf({
  fileName,
  pdfBuffer,
  pdfUrl,
  modelName,
  provider,
  providers,
  timeoutMs = 600_000,
  claimType = "cataract",
}: ProcessSinglePdfOptions): Promise<ProcessSinglePdfResult> {

  // Safely coerce claimType — handles invalid input from upstream (e.g. Spectra sending null).
  // All downstream calls use claimTypeSafe instead of the raw claimType.
  const claimTypeSafe: ClaimType = coerceClaimType(claimType);

  logger.debug(
    `[DEBUG] processSinglePdf: Starting processing - model: ${provider}/${modelName}, timeout: ${timeoutMs}ms`
  );
  const processingStartTime = Date.now();
  const processingTracker = new CostTracker();

  let successCount = 0;
  let errorCount = 0;

  const fileStartTime = Date.now();

  try {
    logger.debug(`[DEBUG] processSinglePdf: Starting processing`);
    // Initial extraction with primary model
    const {
      analysis: initialAnalysis,
      cost: initialCost,
      usage: initialUsage,
    } = await processPdfWithAI({
      fileName,
      pdfBuffer,
      pdfUrl,
      modelName,
      provider,
      providers,
      baseDocument: undefined,
      medicalAdmissibility: undefined,
      claimType: claimTypeSafe,
    });

    const initialProcessingTimeMs = Date.now() - fileStartTime;
    logger.debug(
      `[DEBUG] processSinglePdf: Initial extraction completed - time: ${initialProcessingTimeMs}ms, tokens: ${initialUsage.totalTokens}`
    );

    processingTracker.add(initialCost, initialUsage);

    // ── DISEASE-SPECIFIC BUSINESS RULES ──────────────────────────────────────
    // Applied after AI extraction. Currently only maternity has rules.
    //
    // DESIGN NOTE: This block uses inline rule evaluation rather than the
    // lib/rules `evaluateAdmissibility()` helper because the existing code
    // collects MULTIPLE rule failures into a richer maternityAdmissibilityResult
    // object (lValue, ageDays, hasMaternityExclusion, etc.) that the UI reads
    // by specific field names. The helper returns only the first failure, so
    // switching would regress the multi-rule display. A v2 task is to extend
    // the rules folder to support collect-all-failures evaluation.
    if (claimTypeSafe === "maternity") {
      const admiss = initialAnalysis.medicalAdmissibility as unknown as Record<string, unknown> | null | undefined;
      const condTests = (admiss?.conditionTests as Array<Record<string, unknown>> | undefined) ?? [];
      const remarks: string[] = [];
      let inadmissible = false;

      // ── RULE 1: Living Children Check ─────────────────────────────────────
      // Policy covers maternity for first two living children only.
      // If L (living) >= 2 at the time of admission → reject.
      // L value extracted from GPLA notation in conditionTests.
      const lEntry = condTests.find(
        (c) => typeof c.numericValue === "number" && c.unit === "living children"
      );
      const lValue = lEntry ? (lEntry.numericValue as number) : null;

      // Also check maxChildbirths from benefit plan (extracted by maternityBenefitRemarksPrompt)
      const maxChildbirths = (initialAnalysis as unknown as Record<string, unknown>).maxChildbirths as number | null ?? 2;

      if (lValue !== null && lValue >= maxChildbirths) {
        inadmissible = true;
        remarks.push(
          `REJECTED — Living Children Limit: Patient has ${lValue} living children (GPLA: ${lEntry?.reportValue ?? "N/A"}). ` +
          `Policy covers maternity for first ${maxChildbirths} living children only. ` +
          `Maternity sublimit exhausted.`
        );
      }

      // ── RULE 2: Maternity Policy Exclusion Check ───────────────────────────
      // Some policies exclude maternity entirely (Standard Exclusion 4.1.14 / Code Excl18).
      // Check if the exclusions section or policy wordings contain maternity exclusion markers.
      const exclusionText = (
        ((initialAnalysis as unknown as Record<string, unknown>).exclusionsSummary as string) ?? ""
      ).toLowerCase();
      const maternityExclusionKeywords = [
        "excl18", "4.1.14", "maternity excluded", "maternity is excluded",
        "childbirth excluded", "not covered maternity", "maternity not covered",
        "maternity not a part", "maternity costs are not"
      ];
      const hasMaternityExclusion = maternityExclusionKeywords.some(kw => exclusionText.includes(kw));
      if (hasMaternityExclusion) {
        inadmissible = true;
        remarks.push(
          `REJECTED — Policy Exclusion: Maternity and childbirth expenses are excluded under ` +
          `Standard Exclusion 4.1.14 (Code Excl18). Medical treatment traceable to childbirth ` +
          `including complicated deliveries and caesarean sections are not part of insurance coverage.`
        );
      }

      // ── RULE 3: Newborn / 30-Day Waiting Period Check ─────────────────────
      // If patient age < 30 days → check if policy waiting period applies.
      // Clause 4.3: 30-day waiting period from first policy commencement date.
      const patientAge = (initialAnalysis as unknown as Record<string, unknown>).patientAge as
        { value?: string | number } | string | number | null | undefined;
      const ageValue = typeof patientAge === "object" && patientAge !== null
        ? patientAge.value : patientAge;
      const ageStr = String(ageValue ?? "").toLowerCase().trim();

      // Parse age — look for "X days", "X day", newborn, neonate
      let ageDays: number | null = null;
      const daysMatch = ageStr.match(/^(\d+)\s*days?$/);
      if (daysMatch) ageDays = parseInt(daysMatch[1], 10);
      else if (ageStr === "newborn" || ageStr === "neonate" || ageStr === "0 days") ageDays = 0;

      const waitingPeriod = (initialAnalysis as unknown as Record<string, unknown>).waitingPeriodDays as number | null ?? 30;

      if (ageDays !== null && ageDays < waitingPeriod) {
        inadmissible = true;
        remarks.push(
          `REJECTED — Waiting Period: Patient age is ${ageDays === 0 ? "newborn" : `${ageDays} days`}. ` +
          `As per policy clause 4.3, a ${waitingPeriod}-day waiting period is applicable for each claim ` +
          `from the first policy commencement date. Claim stands denied.`
        );
      }

      // ── Apply flags to analysis ────────────────────────────────────────────
      if (inadmissible || remarks.length > 0) {
        (initialAnalysis as unknown as Record<string, unknown>).maternityAdmissibilityResult = {
          admissible: !inadmissible,
          rejectionRemarks: remarks,
          lValue,
          maxChildbirths,
          ageDays,
          hasMaternityExclusion,
          checkedAt: new Date().toISOString(),
        };
        // Surface the rejection as processingRemarks for the AI summary tab
        if (inadmissible) {
          const existing = ((initialAnalysis as unknown as Record<string, unknown>).processingRemarks as string) ?? "";
          (initialAnalysis as unknown as Record<string, unknown>).processingRemarks =
            (existing ? existing + "\n\n" : "") + remarks.join("\n\n");
        }
      }
    }
    // ── END MATERNITY BUSINESS RULES ─────────────────────────────────────────

    const result: ExtractionResult = {
      filePath: fileName,
      analysis: initialAnalysis,
      cost: initialCost,
      usage: initialUsage,
    };

    successCount++;
        const totalTimeMs = Date.now() - processingStartTime;
        const { totalCost, usage } = processingTracker.snapshot();
        logger.debug(
          `[DEBUG] processSinglePdf: Processing completed - success: ${successCount}, errors: ${errorCount}, total time: ${totalTimeMs}ms, total tokens: ${usage.totalTokens}`
        );

        return {
          result,
          totals: {
            totalCost,
            totalPromptTokens: usage.inputTokens,
            totalCompletionTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            successCount,
            errorCount,
            totalTimeMs,
          },
        };
      } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error(
      `[DEBUG] processSinglePdf: Error processing:`,
      error
    );
    logger.error(
      `[DEBUG] processSinglePdf: Error message: ${errorMessage}`
    );
    errorCount++;

    // Skip this file - don't add to results, just log and continue
  }

  const totalTimeMs = Date.now() - processingStartTime;
  const { usage } = processingTracker.snapshot();
  logger.debug(
    `[DEBUG] processSinglePdf: Processing completed with errors - success: ${successCount}, errors: ${errorCount}, total time: ${totalTimeMs}ms, total tokens: ${usage.totalTokens}`
  );

  throw new Error("Failed to process PDF");
}