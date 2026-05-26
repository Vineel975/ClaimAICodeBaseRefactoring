/**
 * POST /api/benefit-section-summary
 *
 * Filters benefit-plan section text (ailment, exclusions, copay, maternity) to
 * only the bullet points relevant to the given claim type.
 *
 * Request body:
 *   {
 *     section?:  "ailment" | "exclusions" | "copay" | "maternity";
 *     rawText?:  string;     // section content from benefit plan DB
 *     claimType?: string;    // disease / claim type for filtering
 *   }
 *
 * Response:
 *   {
 *     points: string[];      // filtered bullet points
 *     summary: string;       // concatenated for backward compat
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { benefitSectionSummaryPrompt } from "@/src/prompts";
import { generateText } from "ai";
import { getModel } from "@/src/model-provider";
import { coerceClaimType } from "@/lib/rules";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      section?: "ailment" | "exclusions" | "copay" | "maternity";
      rawText?: string;
      claimType?: string;
    };

    const section = body?.section;
    const rawText = (body?.rawText ?? "").trim();

    // Safely coerce claimType — handles undefined, null, wrong types,
    // and unknown disease names. Falls back to "other" for invalid input.
    const claimType = coerceClaimType(body?.claimType);

    if (!section || !rawText) {
      return NextResponse.json({
        points: [],
        summary: `No ${section ?? "section"} information available.`,
      });
    }

    const { text } = await generateText({
      model: getModel({
        provider: "openrouter",
        modelName: "anthropic/claude-sonnet-4-5",
      }),
      prompt: benefitSectionSummaryPrompt(section, rawText, claimType),
    });

    const trimmed = text.trim();

    // Strip markdown code fences if AI wrapped response in ```json ... ``` or ``` ... ```
    const stripped = trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    // Try to parse as JSON array of bullet points
    try {
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed)) {
        const points = parsed
          .filter(
            (p: unknown) =>
              typeof p === "string" && (p as string).trim().length > 0,
          )
          .map((p: unknown) => (p as string).trim()) as string[];
        return NextResponse.json({
          points,
          summary: points.join(" | "),
        });
      }
    } catch {
      // Not JSON — return as plain text summary
    }

    return NextResponse.json({ points: [], summary: stripped });
  } catch (e) {
    console.error("[benefit-section-summary] error:", e);
    return NextResponse.json(
      { points: [], summary: "Summary unavailable." },
      { status: 500 },
    );
  }
}