import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/**
 * Uploads a base64-encoded PDF to Convex storage.
 * Returns a typed Id<"_storage"> — not a plain string.
 */
async function uploadBase64ToStorage(
  ctx: { storage: { generateUploadUrl: () => Promise<string> } },
  base64: string,
  contentType: string,
): Promise<Id<"_storage">> {
  const binaryStr = atob(base64);
  const bytes     = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const uploadUrl = await ctx.storage.generateUploadUrl();
  const response  = await fetch(uploadUrl, {
    method:  "POST",
    headers: { "Content-Type": contentType },
    body:    bytes,
  });

  if (!response.ok) {
    throw new Error(
      `Storage upload failed: ${response.status} ${await response.text()}`,
    );
  }

  const { storageId } = await response.json() as { storageId: Id<"_storage"> };
  return storageId;
}

// ── POST /api/claims/process ──────────────────────────────────────────────────
// Called by Spectra's StartClaimAuditProxy controller.
// Accepts hospital bill + optional tariff as base64, creates a Convex job.
// Returns: { jobId: string }
// ─────────────────────────────────────────────────────────────────────────────

http.route({
  path:    "/api/claims/process",
  method:  "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        claimId?:            string;
        hospitalBillBase64?: string;
        hospitalFileName?:   string;
        tariffBase64?:       string;
        tariffFileName?:     string;
        spectraFields?: Record<string, unknown>;
      };

      // claimId is required by createJobWithFiles (v.string(), not optional)
      const claimId = body.claimId?.trim();
      if (!claimId) {
        return jsonResponse({ error: "claimId is required" }, 400);
      }

      if (!body.hospitalBillBase64) {
        return jsonResponse({ error: "hospitalBillBase64 is required" }, 400);
      }

      // Upload hospital bill — returns typed Id<"_storage">
      const hospitalStorageId = await uploadBase64ToStorage(
        ctx,
        body.hospitalBillBase64,
        "application/pdf",
      );

      // Upload tariff — optional
      let tariffStorageId: Id<"_storage"> | undefined;
      if (body.tariffBase64) {
        tariffStorageId = await uploadBase64ToStorage(
          ctx,
          body.tariffBase64,
          "application/pdf",
        );
      }

      // createJobWithFiles args match exactly:
      //   claimId:           v.string()              — required
      //   hospitalStorageId: v.id("_storage")         — required
      //   hospitalFileName:  v.string()              — required
      //   tariffStorageId:   v.optional(v.id("_storage")) — optional
      //   tariffFileName:    v.optional(v.string())  — optional
      const jobId = await ctx.runMutation(api.jobMutations.createJobWithFiles, {
        claimId,
        hospitalStorageId,
        hospitalFileName: body.hospitalFileName ?? "hospital-bill.pdf",
        tariffStorageId,
        tariffFileName:   body.tariffFileName,
        spectraFields:    body.spectraFields,
      });

      return jsonResponse({ jobId }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }),
});

// ── GET /api/claims/status?jobId=xxx ─────────────────────────────────────────
// Returns job state + results.
// getJobById takes v.id("processJob") — cast the string from URL to that type.
// ─────────────────────────────────────────────────────────────────────────────

http.route({
  path:    "/api/claims/status",
  method:  "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const url   = new URL(request.url);
      const jobId = url.searchParams.get("jobId");

      if (!jobId) {
        return jsonResponse({ error: "jobId is required" }, 400);
      }

      // Convex IDs are just branded strings at runtime — cast is safe.
      const job = await ctx.runQuery(api.processing.getJobById, {
        jobId: jobId as Id<"processJob">,
      });

      if (!job) {
        return jsonResponse({ error: `Job not found: ${jobId}` }, 404);
      }

      return jsonResponse(job, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 500);
    }
  }),
});

// ── OPTIONS preflight handlers ────────────────────────────────────────────────

http.route({
  path:    "/api/claims/process",
  method:  "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, { status: 204, headers: corsHeaders() }),
  ),
});

http.route({
  path:    "/api/claims/status",
  method:  "OPTIONS",
  handler: httpAction(async () =>
    new Response(null, { status: 204, headers: corsHeaders() }),
  ),
});

export default http;