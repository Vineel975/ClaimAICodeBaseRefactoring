import { NextRequest, NextResponse } from "next/server";
import { benefitPlanLimitExtractionPrompt } from "@/src/prompts";
import { generateText } from "ai";
import { getModel } from "@/src/model-provider";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      cappings?: string[];
      diagnosis?: string;
    };
    const cappings  = body?.cappings ?? [];
    const diagnosis = body?.diagnosis ?? "";

    if (cappings.length === 0) {
      return NextResponse.json({ benefitPlanLimit: null, notes: "No cappings provided" });
    }

    const { text } = await generateText({
      model: getModel({ provider: "openrouter", modelName: "anthropic/claude-sonnet-4-5" }),
      prompt: benefitPlanLimitExtractionPrompt(cappings, diagnosis),
    });

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as {
      benefitPlanLimit: number | null;
      appliedCapping: string | null;
      notes: string;
    };

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[benefit-plan-limit] error:", e);
    return NextResponse.json({ benefitPlanLimit: null, notes: String(e) }, { status: 500 });
  }
}
