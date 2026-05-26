import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const createJob = mutation({
  args: {
    total: v.number(),
  },
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("processJob", {
      status: "idle",
      completed: 0,
      total: args.total,
      successCount: 0,
      errorCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      isComplete: false,
    });

    return jobId;
  },
});

export const updateJobStatus = mutation({
  args: {
    jobId: v.id("processJob"),
    status: v.string(),
    completed: v.optional(v.number()),
    successCount: v.optional(v.number()),
    errorCount: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    totalPromptTokens: v.optional(v.number()),
    totalCompletionTokens: v.optional(v.number()),
    isComplete: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { jobId, ...updates } = args;
    await ctx.db.patch(jobId, updates);
    return { success: true };
  },
});

export const addJobFile = mutation({
  args: {
    jobId: v.id("processJob"),
    file: v.string(),
    status: v.string(),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.union(v.literal("hospitalBill"), v.literal("tariff"), v.literal("policy"))),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("jobFiles", {
      jobId: args.jobId,
      file: args.file,
      status: args.status,
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: args.fileType,
    });
    return { success: true };
  },
});

export const addJobResult = mutation({
  args: {
    jobId: v.id("processJob"),
    filePath: v.string(),
    analysis: v.any(),
    usage: v.any(),
    processingTimeMs: v.number(),
    processingTime: v.optional(v.string()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("jobResults", {
      jobId: args.jobId,
      filePath: args.filePath,
      analysis: args.analysis,
      usage: args.usage,
      processingTimeMs: args.processingTimeMs,
      processingTime: args.processingTime,
      cost: args.cost,
    });
    return { success: true };
  },
});

export const createJobWithFiles = mutation({
  args: {
    claimId: v.string(),
    hospitalStorageId: v.id("_storage"),
    hospitalFileName: v.string(),
    tariffStorageId: v.optional(v.id("_storage")),
    tariffFileName: v.optional(v.string()),
    spectraFields: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("processJob", {
      status: "idle",
      completed: 0,
      total: 1,
      successCount: 0,
      errorCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      isComplete: false,
      claimId: args.claimId,
      spectraFields: args.spectraFields,
    });

    await ctx.db.insert("jobFiles", {
      jobId,
      file: args.hospitalFileName,
      status: "pending",
      storageId: args.hospitalStorageId,
      fileName: args.hospitalFileName,
      fileType: "hospitalBill",
    });

    if (args.tariffStorageId && args.tariffFileName) {
      await ctx.db.insert("jobFiles", {
        jobId,
        file: args.tariffFileName,
        status: "pending",
        storageId: args.tariffStorageId,
        fileName: args.tariffFileName,
        fileType: "tariff",
      });
    }

    await ctx.scheduler.runAfter(0, internal.processPdf.processPdfInternal, {
      jobId,
      hospitalStorageId: args.hospitalStorageId,
      fileName: args.hospitalFileName,
      tariffStorageId: args.tariffStorageId,
    });

    return jobId;
  },
});

export const rerunJobWithSameFiles = mutation({
  args: {
    jobId: v.id("processJob"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    const files = await ctx.db
      .query("jobFiles")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();

    const hospitalFile = files.find((f) => f.fileType === "hospitalBill");
    if (!hospitalFile?.storageId || !hospitalFile.fileName) {
      throw new Error("Hospital bill file is missing for this job");
    }

    const tariffFile = files.find((f) => f.fileType === "tariff");
    const tariffStorageId = tariffFile?.storageId;

    const existingResults = await ctx.db
      .query("jobResults")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();

    for (const result of existingResults) {
      await ctx.db.delete(result._id);
    }

    const existingLogs = await ctx.db
      .query("jobLogs")
      .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
      .collect();

    for (const log of existingLogs) {
      await ctx.db.delete(log._id);
    }

    for (const file of files) {
      await ctx.db.patch(file._id, {
        status: "pending",
      });
    }

    await ctx.db.patch(args.jobId, {
      status: "idle",
      completed: 0,
      total: 1,
      successCount: 0,
      errorCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      isComplete: false,
      error: undefined,
    });

    await ctx.scheduler.runAfter(0, internal.processPdf.processPdfInternal, {
      jobId: args.jobId,
      hospitalStorageId: hospitalFile.storageId,
      fileName: hospitalFile.fileName,
      tariffStorageId,
    });

    return { success: true };
  },
});
// ═══════════════════════════════════════════════════════════════════════════════
// ADD TO convex/jobMutations.ts — TWO mutations only (no query here)
// ═══════════════════════════════════════════════════════════════════════════════

export const createJobAndProcess = mutation({
  args: {
    claimId: v.string(),
    hospitalStorageId: v.id("_storage"),
    hospitalFileName: v.string(),
    tariffStorageId: v.optional(v.id("_storage")),
    tariffFileName: v.optional(v.string()),
    spectraFields: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("processJob", {
      status: "idle",
      completed: 0,
      total: 1,
      successCount: 0,
      errorCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      isComplete: false,
      claimId: args.claimId,
      spectraFields: args.spectraFields,
    });

    await ctx.db.insert("jobFiles", {
      jobId,
      file: args.hospitalFileName,
      status: "pending",
      storageId: args.hospitalStorageId,
      fileName: args.hospitalFileName,
      fileType: "hospitalBill",
    });

    if (args.tariffStorageId && args.tariffFileName) {
      await ctx.db.insert("jobFiles", {
        jobId,
        file: args.tariffFileName,
        status: "pending",
        storageId: args.tariffStorageId,
        fileName: args.tariffFileName,
        fileType: "tariff",
      });
    }

    return jobId;
  },
});

export const completeJobWithResult = mutation({
  args: {
    jobId: v.id("processJob"),
    analysis: v.union(v.any(), v.null()),
    filePath: v.optional(v.string()),
    usage: v.optional(v.any()),
    processingTimeMs: v.optional(v.number()),
    cost: v.optional(v.number()),
    status: v.string(),
    successCount: v.optional(v.number()),
    errorCount: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    totalPromptTokens: v.optional(v.number()),
    totalCompletionTokens: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { jobId, analysis, filePath, usage, processingTimeMs, cost, status, error, ...jobUpdates } = args;

    if (analysis !== null && analysis !== undefined) {
      await ctx.db.insert("jobResults", {
        jobId,
        filePath: filePath || "",
        analysis,
        usage: usage || {},
        processingTimeMs: processingTimeMs || 0,
        processingTime: processingTimeMs ? `${(processingTimeMs / 1000).toFixed(1)}s` : undefined,
        cost: cost || 0,
      });
    }

    const patch: Record<string, any> = {
      status,
      isComplete: true,
      completed: 1,
    };
    if (jobUpdates.successCount !== undefined) patch.successCount = jobUpdates.successCount;
    if (jobUpdates.errorCount !== undefined) patch.errorCount = jobUpdates.errorCount;
    if (jobUpdates.totalCost !== undefined) patch.totalCost = jobUpdates.totalCost;
    if (jobUpdates.totalTokens !== undefined) patch.totalTokens = jobUpdates.totalTokens;
    if (jobUpdates.totalPromptTokens !== undefined) patch.totalPromptTokens = jobUpdates.totalPromptTokens;
    if (jobUpdates.totalCompletionTokens !== undefined) patch.totalCompletionTokens = jobUpdates.totalCompletionTokens;
    if (error !== undefined) patch.error = error;

    await ctx.db.patch(jobId, patch);
    return { success: true };
  },
});


// ═══════════════════════════════════════════════════════════════════════════════
// ADD TO convex/processing.ts (where getJobById already lives)
// ═══════════════════════════════════════════════════════════════════════════════

// --- paste these two functions into processing.ts ---

// export const getJobResults = query({
//   args: { jobId: v.id("processJob") },
//   handler: async (ctx, args) => {
//     return await ctx.db
//       .query("jobResults")
//       .withIndex("by_jobId", (q) => q.eq("jobId", args.jobId))
//       .collect();
//   },
// });

// export const updateJobResultAnalysis = mutation({
//   args: {
//     jobResultId: v.id("jobResults"),
//     analysis: v.any(),
//   },
//   handler: async (ctx, args) => {
//     await ctx.db.patch(args.jobResultId, { analysis: args.analysis });
//     return { success: true };
//   },
// });
