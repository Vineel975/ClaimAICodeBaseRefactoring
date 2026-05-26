import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  processJob: defineTable({
    status: v.string(),
    completed: v.number(),
    total: v.number(),
    successCount: v.number(),
    errorCount: v.number(),
    totalCost: v.number(),
    totalTokens: v.number(),
    totalPromptTokens: v.number(),
    totalCompletionTokens: v.number(),
    isComplete: v.boolean(),
    error: v.optional(v.string()),
    claimId: v.optional(v.string()),
    // Kept optional to allow old documents that have this field to pass validation.
    // Not used by any code — safe to leave here permanently.
    spectraFields: v.optional(v.any()),
  })
    .index("by_status", ["status"])
    .index("by_isComplete", ["isComplete"]),

  jobFiles: defineTable({
    jobId: v.id("processJob"),
    file: v.string(),
    status: v.string(),
    cost: v.optional(v.number()),
    tokens: v.optional(v.number()),
    timeMs: v.optional(v.number()),
    statusMessage: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.union(v.literal("hospitalBill"), v.literal("tariff"), v.literal("policy"))),
  })
    .index("by_jobId", ["jobId"])
    .index("by_jobId_status", ["jobId", "status"])
    .index("by_jobId_fileType", ["jobId", "fileType"]),

  jobResults: defineTable({
    jobId: v.id("processJob"),
    filePath: v.string(),
    analysis: v.any(),
    cost: v.optional(v.number()),
    usage: v.any(),
    processingTimeMs: v.optional(v.number()),
    processingTime: v.optional(v.string()),
    fallbackAnalysis: v.optional(v.any()),
    fallbackCost: v.optional(v.number()),
    fallbackUsage: v.optional(v.any()),
    changelogEntries: v.optional(
      v.array(
        v.object({
          id: v.string(),
          timestamp: v.string(),
          tab: v.string(),
          record: v.string(),
          field: v.string(),
          previousValue: v.string(),
          newValue: v.string(),
        })
      )
    ),
  })
    .index("by_jobId", ["jobId"])
    .index("by_filePath", ["filePath"]),

  jobLogs: defineTable({
    jobId: v.id("processJob"),
    message: v.string(),
    timestamp: v.string(),
  })
    .index("by_jobId", ["jobId"])
    .index("by_jobId_timestamp", ["jobId", "timestamp"]),

  nmeList: defineTable({
    itemName: v.string(),
  }),

  socTariff: defineTable({
    serviceCode: v.string(),
    serviceName: v.string(),
    category: v.string(),
    department: v.string(),
    tariff: v.number(),
  }),

  policySubCategoryCoverage: defineTable({
    parentCategory: v.string(),
    subCategory: v.string(),
    coverage: v.any(),
  }),

  policyEnrollment: defineTable({
    insuredName: v.string(),
    policyNumber: v.string(),
    policyStartDate: v.string(),
    policyEndDate: v.string(),
    sumInsured: v.string(),
    relationship: v.string(),
    dob: v.string(),
    gender: v.string(),
    certificateNumber: v.string(),
    tpaName: v.optional(v.string()),
  }),

  tariffPdfs: defineTable({
    fileName: v.string(),
    relativePath: v.string(),
    hospitalName: v.string(),
    normalizedHospitalName: v.string(),
    storageId: v.id("_storage"),
    uploadedAt: v.string(),
  })
    .index("by_fileName", ["fileName"])
    .index("by_normalizedHospitalName", ["normalizedHospitalName"]),

  stagingJobs: defineTable({
    claimId:            v.string(),
    slNo:               v.string(),
    jobId:              v.optional(v.string()),
    status:             v.string(),      // "pending" | "processing" | "done" | "failed"
    error:              v.optional(v.string()),
    processedAt:        v.optional(v.number()),
    createdAt:          v.number(),
    // Pre-calculated benefit plan limit
    preBenefitLimit:    v.optional(v.string()),
    preBenefitRuleName: v.optional(v.string()),
    preBenefitWarning:  v.optional(v.string()),
  })
    .index("by_claim",   ["claimId", "slNo"])
    .index("by_claimId", ["claimId"]),
});
