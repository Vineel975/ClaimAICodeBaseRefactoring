/**
 * POST /api/alignment-cappings
 *
 * Filters benefit-plan alignment cappings to only items relevant to the
 * given claim type.
 *
 * Request body:
 *   {
 *     cappings: string[];    // raw capping lines from benefit plan DB
 *     claimType?: string;    // disease / claim type for filtering (default: cataract)
 *   }
 *
 * Response:
 *   { filtered: string[] }   // cappings relevant to the claim type
 *
 * BEFORE refactor: hardcoded to cataract via alignmentCappingsCataractPrompt
 * AFTER refactor:  accepts claimType, uses alignmentCappingsPrompt with claim type
 */

import { NextRequest, NextResponse } from "next/server";
import { alignmentCappingsPrompt } from "@/src/prompts";
import { generateText } from "ai";
import { getModel } from "@/src/model-provider";
import { coerceClaimType } from "@/lib/rules";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      cappings?: string[];
      claimType?: string;
    };

    const cappings = body?.cappings;

    // Safely coerce claimType — defaults to "other" for invalid input
    // (caller can override by passing "cataract" or "maternity" explicitly)
    const claimType = coerceClaimType(body?.claimType ?? "cataract");

    if (!cappings || cappings.length === 0) {
      return NextResponse.json({ filtered: [] });
    }

    const { text } = await generateText({
      model: getModel({
        provider: "openrouter",
        modelName: "anthropic/claude-sonnet-4-5",
      }),
      prompt: alignmentCappingsPrompt(cappings, claimType),
    });

    if (!text || text.trim() === "NONE") {
      return NextResponse.json({ filtered: [] });
    }

    const filtered = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "NONE");

    return NextResponse.json({ filtered });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to filter cappings";
    return NextResponse.json(
      { error: message, filtered: [] },
      { status: 500 },
    );
  }
}