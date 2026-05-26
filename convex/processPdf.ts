"use node";

import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { processSinglePdf } from "../src/extract";
import { getModel, type ModelProvider } from "../src/model-provider";
import { evaluate } from "../src/evaluator";
import { setLoggerSink } from "../src/logger";
import {
  createTokenUsage,
  sumTokenUsage,
  type TokenUsage,
} from "../src/cost-tracker";
import { computeClaimCalculation } from "../src/claim-calculation";
import type {
  EyeType,
  LensTypeApproval,
  PolicyRuleContext,
  TariffBreakdownItem,
} from "../src/types";
import {
  combinedTariffCalculationPrompt,
  policyWordingsAdjustmentPrompt,
} from "../src/prompts";
import {
  policyAdjustmentSchema,
  tariffCalculationSchema,
} from "../src/models";
import { generateObject } from "ai";
import { coerceClaimType, type ClaimType } from "../lib/rules";
import type { Id } from "./_generated/dataModel";
import {
  getBenefitPlanTextByClaimId,
  getPatientInfoDbByClaimId,
  validateExtractedPatient,
} from "../lib/db";

type TariffCatalogItem = {
  _id: string;
  fileName: string;
  relativePath: string;
  hospitalName: string;
  normalizedHospitalName: string;
  storageId: Id<"_storage">;
  uploadedAt: string;
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(2);
  return `${hours}h ${minutes}m ${seconds}s`;
}

type TariffMatchResult = {
  tariffExtractionItem?: TariffBreakdownItem[] | null;
  lensType?: string;
  lensTypeApproved?: LensTypeApproval;
  eyeType?: EyeType;
  tariffPageNumber?: number | null;
  tariffNotes?: string;
  tariffClarificationNote?: string;
  tariffCost?: number;
  tariffUsage?: TokenUsage;
  matchScore?: number;
  matchStrategy?: "fuzzy" | "token_subset";
  reason?: string;
  matchedFileName?: string;
};


function normalizeHospitalName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(
      /\b(ppn|tariff|tarrif|rate|rates|package|packages|schedule|master)\b/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}


function inferHospitalNameFromFileName(fileName: string): string {
  const withoutExt = fileName.replace(/\.pdf$/i, "");
  const normalized = normalizeHospitalName(withoutExt);
  return normalized.length > 0 ? normalized : withoutExt;
}

function normalizeAmount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/[^0-9.]/g, "");
    if (!cleaned) return 0;
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return 0;
}

function normalizeTariffBreakdown(
  breakdown: Array<{ code?: unknown; name?: unknown; amount?: unknown; pdfText?: unknown; pdfPageNumber?: unknown; pdfRowTopPct?: unknown; pdfRowBottomPct?: unknown }> | undefined,
): TariffBreakdownItem[] {
  return (breakdown || [])
    .map((item) => {
      const code = typeof item?.code === "string" ? item.code.trim() : "";
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const amount = normalizeAmount(item?.amount);
      const pdfText = typeof item?.pdfText === "string" ? item.pdfText.trim() : "";
      const pdfPageNumber = typeof item?.pdfPageNumber === "number" ? item.pdfPageNumber : 0;
      const pdfRowTopPct = typeof item?.pdfRowTopPct === "number" ? item.pdfRowTopPct : 0;
      const pdfRowBottomPct = typeof item?.pdfRowBottomPct === "number" ? item.pdfRowBottomPct : 0;
      return { code, name, amount, pdfText, pdfPageNumber, pdfRowTopPct, pdfRowBottomPct };
    })
    .filter((item) => item.amount >= 0);
}

async function extractBenefitAmountFromPolicyWordings(
  policyWordings: string,
  provider: ModelProvider,
  modelName: string,
  providers: any,
): Promise<{
  benefitAmount?: number | null;
  adjustmentNotes?: string;
  policyRuleContext?: PolicyRuleContext;
  cost: number;
  usage: TokenUsage;
}> {
  const { object, usage } = await generateObject({
    model: getModel({ provider, modelName }),
    schema: policyAdjustmentSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${policyWordingsAdjustmentPrompt}\n\nPolicy wordings:\n${policyWordings}`,
          },
        ],
      },
    ],
  });

  // getTokenCosts removed — was triggering FetchModelsError. Token cost telemetry non-essential.
  const costs = { totalUSD: 0 };

  const benefitAmount =
    object.benefitAmount !== null &&
    object.benefitAmount !== undefined &&
    Number.isFinite(object.benefitAmount)
      ? Math.max(object.benefitAmount, 0)
      : null;
  const adjustmentNotes =
    object.adjustmentNotes !== null &&
    object.adjustmentNotes !== undefined &&
    object.adjustmentNotes.trim().length > 0
      ? object.adjustmentNotes
      : undefined;

  const policyRuleContext: PolicyRuleContext = {
    insurerType:
      object.insurerType === null || object.insurerType === undefined
        ? undefined
        : object.insurerType,
    policySegment:
      object.policySegment === null || object.policySegment === undefined
        ? undefined
        : object.policySegment,
    sumInsuredAmount:
      object.sumInsuredAmount !== null &&
      object.sumInsuredAmount !== undefined &&
      Number.isFinite(object.sumInsuredAmount)
        ? Math.max(object.sumInsuredAmount, 0)
        : undefined,
    niacFlexiFloater:
      object.niacFlexiFloater === null || object.niacFlexiFloater === undefined
        ? undefined
        : object.niacFlexiFloater,
    hasNoCataractLimitClause:
      object.hasNoCataractLimitClause === null ||
      object.hasNoCataractLimitClause === undefined
        ? undefined
        : object.hasNoCataractLimitClause,
    geoLensCap7000Applicable:
      object.geoLensCap7000Applicable === null ||
      object.geoLensCap7000Applicable === undefined
        ? undefined
        : object.geoLensCap7000Applicable,
  };

  return {
    benefitAmount,
    adjustmentNotes,
    policyRuleContext,
    cost: costs.totalUSD || 0,
    usage: createTokenUsage(usage.inputTokens || 0, usage.outputTokens || 0),
  };
}

async function extractClaimTariffFromPdf(
  hospitalBillPdfBuffer: Buffer,
  tariffPdfBuffer: Buffer,
  claimContext: {
    diagnosis?: string;
    doctorNotes?: string;
    policyWordings?: string;
    hospitalBillBreakdown?: Array<{
      name?: string;
      amount?: number;
    }>;
    conditionTests?: Array<{
      condition?: string;
      matchedDiagnosis?: string;
      pageNumber?: number;
      testName?: string;
      reportValue?: string;
      numericValue?: number | null;
      unit?: string;
      status?: string;
      sourceText?: string;
    }>;
  },
  aiConfig: {
    provider: ModelProvider;
    modelName: string;
  },
  providers: any,
): Promise<{
  tariffExtractionItem: TariffBreakdownItem[];
  lensType: string;
  lensTypeApproved: LensTypeApproval;
  eyeType: EyeType;
  tariffPageNumber: number;
  tariffNotes: string;
  tariffClarificationNote: string;
  cost: number;
  usage: TokenUsage;
}> {
  const conditionTestsText = (claimContext.conditionTests || [])
    .map((ct, idx) => {
      const valueText = [ct.reportValue, ct.unit].filter(Boolean).join(" ");
      return `Condition ${idx + 1}: ${ct.condition || "N/A"} | Matched Diagnosis: ${ct.matchedDiagnosis || "N/A"} | Test: ${ct.testName || "Unknown Test"} | Value: ${valueText || "N/A"} | Status: ${ct.status || "N/A"} | Source: ${ct.sourceText || "N/A"} | Page: ${ct.pageNumber || "N/A"}`;
    })
    .join("\n");

  const hospitalBillBreakdownText = (claimContext.hospitalBillBreakdown || [])
    .map((item) => {
      const name = item.name || "Unknown";
      const amount =
        typeof item.amount === "number" && isFinite(item.amount)
          ? item.amount
          : "N/A";
      return `${name}: ${amount}`;
    })
    .join("; ");

  const contextSnippet = [
    `Diagnosis: ${claimContext.diagnosis || "Unknown"}`,
    `Doctor Notes: ${claimContext.doctorNotes || "Unknown"}`,
    `Policy Wordings: ${claimContext.policyWordings || "None"}`,
    `Hospital Bill Breakdown: ${hospitalBillBreakdownText || "None"}`,
    `Condition Tests:`,
    conditionTestsText || "None",
  ].join("\n");

  const { object, usage } = await generateObject({
    model: getModel({
      provider: aiConfig.provider,
      modelName: aiConfig.modelName,
    }),
    schema: tariffCalculationSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${combinedTariffCalculationPrompt}\n\nClaim context:\n${contextSnippet}`,
          },
          {
            type: "text",
            text: "HOSPITAL BILL PDF:",
          },
          {
            type: "file",
            data: hospitalBillPdfBuffer,
            mediaType: "application/pdf",
            filename: "hospital-bill.pdf",
          },
          {
            type: "text",
            text: "TARIFF PDF:",
          },
          {
            type: "file",
            data: tariffPdfBuffer,
            mediaType: "application/pdf",
            filename: "matched-hospital-ppn.pdf",
          },
        ],
      },
    ],
  });

  // getTokenCosts removed — was triggering FetchModelsError. Token cost telemetry non-essential.
  const costs = { totalUSD: 0 };

  const tariffExtractionItem = normalizeTariffBreakdown(object.tariffExtractionItem);

  const lensType = object.lensType.trim();
  const lensTypeApproved = object.lensTypeApproved as LensTypeApproval;
  const eyeType = object.eyeType as EyeType;

  const tariffPageNumber =
    Number.isFinite(object.tariffPageNumber) && object.tariffPageNumber > 0
      ? Math.floor(object.tariffPageNumber)
      : 0;

  const tariffNotes = object.calculationNotes.trim();
  const tariffClarificationNote = object.clarificationNote.trim();

  return {
    tariffExtractionItem,
    lensType,
    lensTypeApproved,
    eyeType,
    tariffPageNumber,
    tariffNotes,
    tariffClarificationNote,
    cost: costs.totalUSD || 0,
    usage: createTokenUsage(usage.inputTokens || 0, usage.outputTokens || 0),
  };
}

async function resolveTariffForResult(
  ctx: any,
  jobId: Id<"processJob">,
  result: { filePath: string; analysis: Record<string, any> },
  tariffCatalog: TariffCatalogItem[],
  uploadedTariffStorageId?: Id<"_storage">,
  policyWordings?: string,
  provider?: ModelProvider,
  modelName?: string,
  providers?: any,
): Promise<TariffMatchResult> {
  // If an uploaded tariff file is provided, use it directly
  if (uploadedTariffStorageId) {
    await ctx.runMutation(api.processing.addLog, {
      jobId,
      message: `[DEBUG][TARIFF] Using uploaded tariff file (storageId: ${uploadedTariffStorageId})`,
    });
    
    // Get hospital bill PDF from storage
    const jobFiles = await ctx.runQuery(api.processing.getJobFilesByJobId, {
      jobId,
    });
    const hospitalBillFile = jobFiles.find((f: { fileType?: string; fileName?: string; storageId?: Id<"_storage"> }) => {
      if (f.fileType === "hospitalBill") {
        return true;
      }
      const resultFileName = result.filePath;
      return f.fileName ? f.fileName === resultFileName : false;
    });

    if (!hospitalBillFile?.storageId) {
      return {
        reason: "hospital_bill_pdf_not_found",
        tariffCost: 0,
        tariffUsage: createTokenUsage(0, 0),
      };
    }

    const hospitalBillBlob = await ctx.storage.get(hospitalBillFile.storageId);
    if (!hospitalBillBlob) {
      return {
        reason: "hospital_bill_pdf_missing_in_storage",
        tariffCost: 0,
        tariffUsage: createTokenUsage(0, 0),
      };
    }

    const tariffBlob = await ctx.storage.get(uploadedTariffStorageId);
    if (!tariffBlob) {
      return {
        reason: "uploaded_tariff_pdf_missing_in_storage",
        tariffCost: 0,
        tariffUsage: createTokenUsage(0, 0),
      };
    }

    const hospitalBillPdfBuffer = Buffer.from(await hospitalBillBlob.arrayBuffer());
    const tariffPdfBuffer = Buffer.from(await tariffBlob.arrayBuffer());
    const medicalAdmissibility = result.analysis.medicalAdmissibility || {};
    const diagnosis =
      typeof medicalAdmissibility?.diagnosis === "string"
        ? medicalAdmissibility.diagnosis
        : undefined;
    const doctorNotes =
      typeof medicalAdmissibility?.doctorNotes === "string"
        ? medicalAdmissibility.doctorNotes
        : undefined;
    const conditionTests = Array.isArray(medicalAdmissibility?.conditionTests)
      ? medicalAdmissibility.conditionTests
      : [];
    const hospitalBillBreakdown = Array.isArray(result.analysis.hospitalBillBreakdown)
      ? result.analysis.hospitalBillBreakdown
      : [];

    let tariffExtractionItem: TariffBreakdownItem[] | null | undefined;
    let lensType: string | undefined;
    let lensTypeApproved: LensTypeApproval | undefined;
    let eyeType: EyeType | undefined;
    let tariffPageNumber: number | null | undefined;
    let tariffNotes: string | undefined;
    let tariffClarificationNote: string | undefined;
    let tariffCost = 0;
    let tariffUsage = createTokenUsage(0, 0);
    try {
      const tariffResult = await extractClaimTariffFromPdf(
        hospitalBillPdfBuffer,
        tariffPdfBuffer,
        {
          diagnosis,
          doctorNotes,
          policyWordings,
          hospitalBillBreakdown,
          conditionTests,
        },
        {
          provider: provider as ModelProvider,
          modelName: modelName as string,
        },
        providers,
      );
      tariffExtractionItem = tariffResult.tariffExtractionItem;
      lensType = tariffResult.lensType;
      lensTypeApproved = tariffResult.lensTypeApproved;
      eyeType = tariffResult.eyeType;
      tariffPageNumber = tariffResult.tariffPageNumber;
      tariffNotes = tariffResult.tariffNotes;
      tariffClarificationNote = tariffResult.tariffClarificationNote;
      tariffCost = tariffResult.cost;
      tariffUsage = tariffResult.usage;
    } catch (tariffErr) {
      // Log the error so we can debug tariff extraction failures
      await ctx.runMutation(api.processing.addLog, {
        jobId,
        message: `[ERROR][TARIFF] extractClaimTariffFromPdf threw: ${tariffErr instanceof Error ? tariffErr.message : String(tariffErr)}`,
      });
      console.error("[TARIFF] extractClaimTariffFromPdf failed:", tariffErr);
      tariffExtractionItem = undefined;
      lensType = undefined;
      lensTypeApproved = undefined;
      eyeType = undefined;
      tariffPageNumber = null;
      tariffNotes = undefined;
      tariffClarificationNote = undefined;
      tariffCost = 0;
      tariffUsage = createTokenUsage(0, 0);
    }

    return {
      tariffExtractionItem,
      lensType,
      lensTypeApproved,
      eyeType,
      tariffPageNumber,
      tariffNotes,
      tariffClarificationNote,
      tariffCost,
      tariffUsage,
      reason: tariffExtractionItem !== undefined ? "tariff_extracted_from_upload" : "tariff_not_extracted_from_upload",
      matchedFileName: jobFiles.find((f: any) => f.fileType === "tariff")?.fileName ?? undefined,
    };
  }

  return {
    tariffExtractionItem: null,
    tariffPageNumber: null,
    tariffNotes: undefined,
    tariffClarificationNote: undefined,
    reason: "missing_uploaded_tariff",
    tariffCost: 0,
    tariffUsage: createTokenUsage(0, 0),
  };
}

export const uploadTariffPdf = action({
  args: {
    fileName: v.string(),
    relativePath: v.string(),
    pdfData: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    recordId: Id<"tariffPdfs">;
    fileName: string;
    hospitalName: string;
  }> => {
    const hospitalName = inferHospitalNameFromFileName(args.fileName);
    const normalizedHospitalName = normalizeHospitalName(hospitalName);
    const buffer = Buffer.from(args.pdfData, "base64");
    const blob = new Blob([buffer], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);

    const recordId: Id<"tariffPdfs"> = await ctx.runMutation(
      api.processing.upsertTariffPdf,
      {
        fileName: args.fileName,
        relativePath: args.relativePath,
        hospitalName,
        normalizedHospitalName,
        storageId,
      },
    );

    return {
      recordId,
      fileName: args.fileName,
      hospitalName,
    };
  },
});

// Internal action that does the actual processing
export const processPdfInternal = internalAction({
  args: {
    jobId: v.id("processJob"),
    hospitalStorageId: v.id("_storage"),
    fileName: v.string(),
    tariffStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const formatLogMessage = (message: string) => {
      const timestamp = new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      return `${timestamp} [LOG] '${message}'`;
    };

    const job = await ctx.runQuery(api.processing.getJobById, {
      jobId: args.jobId,
    });
    const claimId = typeof job?.claimId === "string" ? job.claimId.trim() : "";
    // Safely coerce claimType from spectraFields — handles undefined/null/wrong types.
    // Falls back to "other" (generic prompts) instead of silently becoming "cataract".
    const rawClaimType = (job?.spectraFields as Record<string, unknown> | undefined)?.claimType;
    const claimType: ClaimType = coerceClaimType(rawClaimType);
    if (rawClaimType && rawClaimType !== claimType) {
      console.warn(
        `[processPdf] Unrecognized claimType from spectraFields: "${String(rawClaimType)}". ` +
        `Falling back to "${claimType}".`
      );
    }
    let policyWordings = "";

    if (claimId) {
      try {
        policyWordings = (await getBenefitPlanTextByClaimId(claimId))?.trim() || "";
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][POLICY] Loaded policy wordings: ${policyWordings || "None"}`,
          ),
        });
      } catch (error) {
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][POLICY] Failed to load benefit plan wording: ${error instanceof Error ? error.message : String(error)}`,
          ),
        });
      }
    }

    // Fetch PDF via public Convex storage URL using Node fetch
    // We fetch it ourselves (not passing URL to Google which can't access it)
    const hospitalUrl = await ctx.storage.getUrl(args.hospitalStorageId);
    if (!hospitalUrl) {
      throw new Error("Hospital file not found in storage");
    }
    await ctx.runMutation(api.processing.addLog, {
      jobId: args.jobId,
      message: formatLogMessage(`[DEBUG] Fetching hospital bill from storage URL`),
    });
    const hospitalFetch = await fetch(hospitalUrl);
    if (!hospitalFetch.ok) {
      throw new Error(`Failed to fetch hospital PDF from storage: ${hospitalFetch.status}`);
    }
    const hospitalBuffer = Buffer.from(await hospitalFetch.arrayBuffer());
    const hospitalSizeMb = (hospitalBuffer.byteLength / 1024 / 1024).toFixed(2);
    await ctx.runMutation(api.processing.addLog, {
      jobId: args.jobId,
      message: formatLogMessage(`[DEBUG] Hospital bill loaded: ${hospitalSizeMb} MB`),
    });

    const modelName =
      process.env.MODEL_NAME || "google/gemini-3-flash-preview";
    const provider = process.env.MODEL_PROVIDER || "openrouter";
    const timeoutMs = parseInt(process.env.FILE_TIMEOUT_MS || "450000", 10);
    await ctx.runMutation(api.processing.addLog, {
      jobId: args.jobId,
      message: formatLogMessage(`[DEBUG] Fetching model providers`),
    });

    // fetchModels() removed — backend has no outbound internet access.
    // Token cost telemetry will show as 0. Doesn't affect AI extraction.
    const providers: any = {};
    await ctx.runMutation(api.processing.addLog, {
      jobId: args.jobId,
      message: formatLogMessage("[DEBUG] Providers fetched, starting processing"),
    });

    await ctx.runMutation(api.jobMutations.updateJobStatus, {
      jobId: args.jobId,
      status: "processing",
    });

    const pendingLogMutations: Promise<void>[] = [];
    const logSink = (message: string) => {
      const mutationPromise = ctx
        .runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(message),
        })
        .then(() => undefined);
      pendingLogMutations.push(mutationPromise);
    };

    setLoggerSink(logSink);

    try {
      const fileProcessingStart = Date.now();
      const tariffCatalog = (await ctx.runQuery(
        api.processing.getTariffPdfCatalog,
      )) as TariffCatalogItem[];

      const { result, totals } = await processSinglePdf({
        fileName: args.fileName,
        pdfBuffer: hospitalBuffer,
        modelName,
        provider: provider as ModelProvider,
        providers,
        timeoutMs,
        claimType,
      });

      result.cost = totals.totalCost;

      let successCount = 0;
      const errorCount = 0;
      let totalCost = 0;
      let totalTokens = 0;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let tariffExtractedCount = 0;

      if (!result) {
        throw new Error("No processing result returned for hospital bill");
      }

      const patientValidation = await validateExtractedPatient({
        patientName: result.analysis.patientName?.value,
        patientAge: result.analysis.patientAge?.value,
        patientGender: result.analysis.patientGender?.value,
        policyNumber: result.analysis.policyNumber?.value,
      }, job?.claimId);
      result.analysis.patientValidation = patientValidation;

      const patientInfoDb = await getPatientInfoDbByClaimId(job?.claimId);
      if (patientInfoDb) {
        result.analysis.patientInfoDb = patientInfoDb;
      }

      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage(
          `[DEBUG][PATIENT_VALIDATION] status=${patientValidation.status} mismatches=${patientValidation.mismatchCount} matched=${patientValidation.matchedCount}${patientValidation.matchedMemberName ? ` member=${patientValidation.matchedMemberName}` : ""}`,
        ),
      });

      if (patientInfoDb?.sections?.length) {
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][PATIENT_DB] Loaded ${patientInfoDb.sections.length} section(s) from DB for claim ${patientInfoDb.claimId}, slno ${patientInfoDb.slNo}.`,
          ),
        });
      }

      const currentHospitalName =
        typeof result.analysis.hospitalName?.value === "string"
          ? result.analysis.hospitalName.value
          : "";
      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage(
          `[DEBUG][TARIFF] Starting tariff flow for file=${result.filePath} hospital="${currentHospitalName || "N/A"}"`,
        ),
      });

        const tariffMatch = await resolveTariffForResult(
          ctx,
          args.jobId,
          result as { filePath: string; analysis: Record<string, any> },
          tariffCatalog as TariffCatalogItem[],
          args.tariffStorageId,
          policyWordings,
          provider as ModelProvider,
          modelName,
          providers,
        );

        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Match result reason=${tariffMatch.reason || "unknown"} score=${tariffMatch.matchScore ?? "N/A"} strategy=${tariffMatch.matchStrategy || "N/A"}`,
          ),
        });

      if (tariffMatch.matchedFileName) {
        result.analysis.tariffFileName = tariffMatch.matchedFileName;
      }
      if (tariffMatch.tariffExtractionItem !== undefined && tariffMatch.tariffExtractionItem !== null) {
        result.analysis.tariffExtractionItem = tariffMatch.tariffExtractionItem;
        tariffExtractedCount++;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Extracted tariff items: ${tariffMatch.tariffExtractionItem.length}`,
          ),
        });
      }
      if (tariffMatch.lensType !== undefined) {
        result.analysis.lensType = tariffMatch.lensType;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Extracted lens type: ${tariffMatch.lensType || "N/A"}`,
          ),
        });
      }
      if (tariffMatch.lensTypeApproved !== undefined) {
        result.analysis.lensTypeApproved = tariffMatch.lensTypeApproved;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Lens type approved: ${String(tariffMatch.lensTypeApproved)}`,
          ),
        });
      }
      if (tariffMatch.tariffPageNumber !== undefined) {
        result.analysis.tariffPageNumber = tariffMatch.tariffPageNumber;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Extracted tariff page number: ${tariffMatch.tariffPageNumber}`,
          ),
        });
      }
      if (tariffMatch.eyeType !== undefined) {
        result.analysis.eyeType = tariffMatch.eyeType;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Extracted eye type: ${tariffMatch.eyeType || "N/A"}`,
          ),
        });
      }
      if (tariffMatch.tariffNotes !== undefined) {
        result.analysis.tariffNotes = tariffMatch.tariffNotes;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Extracted tariff notes (${tariffMatch.tariffNotes.length} chars)`,
          ),
        });
      }
      if (tariffMatch.tariffClarificationNote !== undefined) {
        result.analysis.tariffClarificationNote = tariffMatch.tariffClarificationNote;
        await ctx.runMutation(api.processing.addLog, {
          jobId: args.jobId,
          message: formatLogMessage(
            `[DEBUG][TARIFF] Extracted tariff clarification note (${tariffMatch.tariffClarificationNote.length} chars)`,
          ),
        });
      }
        if (tariffMatch.tariffUsage) {
          result.usage = sumTokenUsage(result.usage, tariffMatch.tariffUsage);
        }
        result.cost = (result.cost || 0) + (tariffMatch.tariffCost || 0);

        if (policyWordings) {
          try {
            const adjustment = await extractBenefitAmountFromPolicyWordings(
              policyWordings,
              provider as ModelProvider,
              modelName,
              providers,
            );
            result.analysis.benefitAmount = adjustment.benefitAmount;
            if (adjustment.policyRuleContext) {
              result.analysis.policyRuleContext = adjustment.policyRuleContext;
            }
            if (adjustment.adjustmentNotes) {
              result.analysis.finalInsurerPayableNotes =
                adjustment.adjustmentNotes;
            }
            result.usage = sumTokenUsage(result.usage, adjustment.usage);
            result.cost = (result.cost || 0) + adjustment.cost;
            await ctx.runMutation(api.processing.addLog, {
              jobId: args.jobId,
              message: formatLogMessage(
                `[DEBUG][POLICY] Extracted benefit amount: ${adjustment.benefitAmount ?? "N/A"}`,
              ),
            });
          } catch (error) {
            await ctx.runMutation(api.processing.addLog, {
              jobId: args.jobId,
              message: formatLogMessage(
                `[DEBUG][POLICY] Failed to extract benefit amount: ${error instanceof Error ? error.message : String(error)}`,
              ),
            });
          }
        }

        const claimCalculation = computeClaimCalculation(result.analysis);
        result.analysis.baseInsurerPayable = claimCalculation.insurerPayable;
        result.analysis.finalInsurerPayable =
          claimCalculation.finalInsurerPayable ?? undefined;
        result.analysis.finalInsurerPayableNotes =
          claimCalculation.finalInsurerPayableNotes || undefined;

        const processingTimeMs = Date.now() - fileProcessingStart;
        const processingTime = formatDuration(processingTimeMs);
        result.processingTimeMs = processingTimeMs;
        result.processingTime = processingTime;

        await ctx.runMutation(api.jobMutations.addJobResult, {
          jobId: args.jobId,
          filePath: result.filePath,
          analysis: result.analysis,
          usage: result.usage,
          processingTimeMs,
          processingTime,
          cost: result.cost,
        });

      successCount++;

      if (result.usage) {
        totalTokens += result.usage.totalTokens || 0;
        totalPromptTokens += result.usage.inputTokens || 0;
        totalCompletionTokens += result.usage.outputTokens || 0;
      }

      if (result.cost) {
        totalCost += result.cost;
      }

      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage(
          `[DEBUG][TARIFF] Summary: extracted=${tariffExtractedCount}, processed=1`,
        ),
      });

      // Evaluate results (for potential future use)
      evaluate([result]);

      await ctx.runMutation(api.jobMutations.updateJobStatus, {
        jobId: args.jobId,
        status: "completed",
        completed: 1,
        successCount,
        errorCount,
        totalCost,
        totalTokens,
        totalPromptTokens,
        totalCompletionTokens,
        isComplete: true,
      });

      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage("[DEBUG] Processing completed"),
      });
    } catch (error) {
      await ctx.runMutation(api.jobMutations.updateJobStatus, {
        jobId: args.jobId,
        status: "error",
        completed: 0,
        errorCount: 1,
        isComplete: true,
        error: error instanceof Error ? error.message : String(error),
      });

      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage(
          `[DEBUG] Processing failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      });
    } finally {
      setLoggerSink(null);
      await Promise.allSettled(pendingLogMutations);
    }
  },
});


// ── Lightweight tariff-only action ─────────────────────────────────────────
// Called from audit/start route after processSinglePdf completes.
// Only reads tariff PDF (small) from Convex storage — no hospital bill loading.
export const runTariffMatching = action({
  args: {
    jobId: v.id("processJob"),
    tariffStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const formatLogMessage = (message: string) => {
      const timestamp = new Date().toLocaleString("en-US", {
        year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
      });
      return `${timestamp} [LOG] '${message}'`;
    };

    const job = await ctx.runQuery(api.processing.getJobById, {
      jobId: args.jobId,
    });
    const claimId = typeof job?.claimId === "string" ? job.claimId.trim() : "";

    // Get the existing result from jobResults
    const jobResults = await ctx.runQuery(api.processing.getJobResults, {
      jobId: args.jobId,
    });
    if (!jobResults?.length) {
      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage("[DEBUG][TARIFF] No job results found — skipping tariff matching"),
      });
      return;
    }

    const jobResult = jobResults[0];
    const result = { filePath: jobResult.filePath || "", analysis: jobResult.analysis as Record<string, any> };

    let policyWordings = "";
    if (claimId) {
      try {
        policyWordings = (await getBenefitPlanTextByClaimId(claimId))?.trim() || "";
      } catch (e) {
        // non-critical
      }
    }

    const modelName = process.env.MODEL_NAME || "google/gemini-3-flash-preview";
    const provider = process.env.MODEL_PROVIDER || "openrouter";
    // fetchModels() removed — backend has no outbound internet access.
    // Token cost telemetry will show as 0. Doesn't affect AI extraction.
    const providers: any = {};

    const tariffCatalog = (await ctx.runQuery(
      api.processing.getTariffPdfCatalog,
    )) as TariffCatalogItem[];

    await ctx.runMutation(api.processing.addLog, {
      jobId: args.jobId,
      message: formatLogMessage(
        `[DEBUG][TARIFF] Starting tariff match for hospital="${result.analysis?.hospitalName?.value || "N/A"}"`,
      ),
    });

    const tariffMatch = await resolveTariffForResult(
      ctx,
      args.jobId,
      result,
      tariffCatalog,
      args.tariffStorageId,
      policyWordings,
      provider as ModelProvider,
      modelName,
      providers,
    );

    // Enrich the analysis with tariff data
    const patch: Record<string, any> = {};
    if (tariffMatch.matchedFileName) patch.tariffFileName = tariffMatch.matchedFileName;
    if (tariffMatch.tariffExtractionItem) patch.tariffExtractionItem = tariffMatch.tariffExtractionItem;
    if (tariffMatch.lensType !== undefined) patch.lensType = tariffMatch.lensType;
    if (tariffMatch.lensTypeApproved !== undefined) patch.lensTypeApproved = tariffMatch.lensTypeApproved;
    if (tariffMatch.tariffPageNumber !== undefined) patch.tariffPageNumber = tariffMatch.tariffPageNumber;
    if (tariffMatch.eyeType !== undefined) patch.eyeType = tariffMatch.eyeType;
    if (tariffMatch.tariffNotes !== undefined) patch.tariffNotes = tariffMatch.tariffNotes;
    if (tariffMatch.tariffClarificationNote !== undefined) patch.tariffClarificationNote = tariffMatch.tariffClarificationNote;

    // Update the jobResult analysis with tariff data
    if (Object.keys(patch).length > 0) {
      const updatedAnalysis = { ...result.analysis, ...patch };
      await ctx.runMutation(api.processing.updateJobResultAnalysis, {
        jobResultId: jobResult._id,
        analysis: updatedAnalysis,
      });
      await ctx.runMutation(api.processing.addLog, {
        jobId: args.jobId,
        message: formatLogMessage(
          `[DEBUG][TARIFF] Updated result with tariff data: ${Object.keys(patch).join(", ")}`,
        ),
      });
    }
  },
});