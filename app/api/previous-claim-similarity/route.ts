/**
 * POST /api/previous-claim-similarity
 *
 * Compares the current claim against a previous claim for the same patient
 * to determine similarity and recommend an approval amount.
 *
 * Request body:
 *   {
 *     currentClaim: { ... },     // current claim details
 *     previousClaim: { ... },    // most recent previous claim
 *     benefitPlanLimit: number | null,
 *     claimType?: string,        // disease type — affects prompt fields
 *   }
 *
 * Response:
 *   {
 *     isSimilar: boolean,
 *     similarityReason: string,
 *     recommendedAmount: number | null,
 *     recommendationBasis: string,
 *     confidence: string,
 *   }
 *
 * BEFORE refactor: claimType wasn't accepted — prompt defaulted to cataract
 * AFTER refactor:  accepts and forwards claimType for disease-aware comparison
 */

import { NextRequest, NextResponse } from "next/server";
import { previousClaimSimilarityPrompt } from "@/src/prompts";
import { generateText } from "ai";
import { getModel } from "@/src/model-provider";
import { coerceClaimType } from "@/lib/rules";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      currentClaim?: {
        diagnosis: string;
        treatment: string;
        complaint: string;
        billAmount: number | null;
        hospital: string;
        eyeType?: string;
        deliveryType?: string;
      };
      previousClaim?: {
        claimId: string;
        admissionDate: string | null;
        diagnosis: string | null;
        treatment: string | null;
        complaint: string | null;
        billAmount: number | null;
        approvedAmount: number | null;
        hospital: string | null;
      };
      benefitPlanLimit?: number | null;
      claimType?: string;
    };

    if (!body.currentClaim || !body.previousClaim) {
      return NextResponse.json({
        isSimilar: false,
        recommendedAmount: null,
        recommendationBasis: "Missing data",
      });
    }

    // Safely coerce claimType. Default to cataract for backward compat
    // (when callers don't send it, original behavior was cataract).
    const claimType = coerceClaimType(body.claimType ?? "cataract");

    const { text } = await generateText({
      model: getModel({
        provider: "openrouter",
        modelName: "anthropic/claude-sonnet-4-5",
      }),
      prompt: previousClaimSimilarityPrompt(
        body.currentClaim,
        body.previousClaim,
        body.benefitPlanLimit ?? null,
        claimType,
      ),
    });

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as {
      isSimilar: boolean;
      similarityReason: string;
      recommendedAmount: number | null;
      recommendationBasis: string;
      confidence: string;
    };

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[previous-claim-similarity] error:", e);
    return NextResponse.json(
      {
        isSimilar: false,
        recommendedAmount: null,
        recommendationBasis: String(e),
      },
      { status: 500 },
    );
  }
}