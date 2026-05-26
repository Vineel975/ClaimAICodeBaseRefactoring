import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Upsert a staging job — insert if not exists, update if exists
export const upsertStagingJob = mutation({
  args: {
    claimId:            v.string(),
    slNo:               v.string(),
    status:             v.string(),
    jobId:              v.optional(v.string()),
    error:              v.optional(v.string()),
    preBenefitLimit:    v.optional(v.string()),
    preBenefitRuleName: v.optional(v.string()),
    preBenefitWarning:  v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if already exists
    const existing = await ctx.db
      .query("stagingJobs")
      .withIndex("by_claim", q => q.eq("claimId", args.claimId).eq("slNo", args.slNo))
      .first();

    if (existing) {
      // Build patch object — omit undefined fields (Convex doesn't accept undefined)
      const patch: Record<string, unknown> = {
        status: args.status,
        processedAt: args.status === "done" ? Date.now() : existing.processedAt,
      };
      if (args.jobId              !== undefined) patch.jobId              = args.jobId;
      if (args.error              !== undefined) patch.error              = args.error;
      if (args.preBenefitLimit    !== undefined) patch.preBenefitLimit    = args.preBenefitLimit;
      if (args.preBenefitRuleName !== undefined) patch.preBenefitRuleName = args.preBenefitRuleName;
      if (args.preBenefitWarning  !== undefined) patch.preBenefitWarning  = args.preBenefitWarning;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    } else {
      // Build insert object — omit undefined fields
      const insert: Record<string, unknown> = {
        claimId:   args.claimId,
        slNo:      args.slNo,
        status:    args.status,
        createdAt: Date.now(),
      };
      if (args.status === "done")              insert.processedAt        = Date.now();
      if (args.jobId              !== undefined) insert.jobId              = args.jobId;
      if (args.error              !== undefined) insert.error              = args.error;
      if (args.preBenefitLimit    !== undefined) insert.preBenefitLimit    = args.preBenefitLimit;
      if (args.preBenefitRuleName !== undefined) insert.preBenefitRuleName = args.preBenefitRuleName;
      if (args.preBenefitWarning  !== undefined) insert.preBenefitWarning  = args.preBenefitWarning;
      return await ctx.db.insert("stagingJobs", insert as never);
    }
  },
});

// Get staging job by claimId + slNo
export const getStagingJob = query({
  args: {
    claimId: v.string(),
    slNo:    v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("stagingJobs")
      .withIndex("by_claim", q => q.eq("claimId", args.claimId).eq("slNo", args.slNo))
      .first();
  },
});

// Get latest staging job for a claimId (any slNo)
export const getLatestStagingJob = query({
  args: { claimId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("stagingJobs")
      .withIndex("by_claimId", q => q.eq("claimId", args.claimId))
      .order("desc")
      .first();
  },
});
