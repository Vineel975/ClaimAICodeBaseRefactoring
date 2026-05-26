/**
 * POST /api/classify-claim-type
 *
 * Classifies a diagnosis text into a ClaimType (cataract / maternity / other).
 *
 * Called by:
 *   - Spectra browser fallback when C# server-side classification returns "other"
 *   - Any internal code that needs to classify a diagnosis
 *
 * Request body:
 *   { diagnosis: string }
 *
 * Response:
 *   { claimType: "cataract" | "maternity" | "other", diagnosis: string }
 *
 * CORS-enabled — Spectra calls this directly from the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { classifyDiagnosis } from "@/lib/rules";

// ─── CORS headers (Spectra browser calls this directly) ─────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export const dynamic = "force-dynamic";

// ─── Types ──────────────────────────────────────────────────────────
interface ClassifyRequest {
  diagnosis?: string;
}

interface ClassifyResponse {
  claimType: "cataract" | "maternity" | "other";
  /** Echoed back for debugging / traceability */
  diagnosis: string;
}

interface ClassifyErrorResponse {
  error: string;
}

// ─── Handlers ───────────────────────────────────────────────────────

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ClassifyResponse | ClassifyErrorResponse>> {
  // Parse body defensively — malformed JSON should not crash the route
  let body: ClassifyRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate diagnosis field
  const rawDiagnosis = body?.diagnosis;
  const diagnosis =
    typeof rawDiagnosis === "string" ? rawDiagnosis.trim() : "";

  // Classify using the rules registry.
  // classifyDiagnosis() returns "other" for empty/null/invalid input,
  // so this call is safe regardless of input shape.
  const claimType = classifyDiagnosis(diagnosis);

  return NextResponse.json(
    { claimType, diagnosis },
    { status: 200, headers: CORS_HEADERS },
  );
}