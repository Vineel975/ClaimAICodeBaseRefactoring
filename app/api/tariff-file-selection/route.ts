import { NextRequest, NextResponse } from "next/server";
import { tariffFileSelectionPrompt } from "@/src/prompts";
import { generateText } from "ai";
import { getModel } from "@/src/model-provider";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      fileNames?: string[];
      insurerCode?: string;
      isPsu?: boolean;
    };
    const fileNames   = body?.fileNames ?? [];
    const insurerCode = body?.insurerCode ?? "";
    const isPsu       = body?.isPsu ?? false;

    if (fileNames.length === 0) {
      return NextResponse.json({ selectedFile: null, reason: "No files provided" });
    }

    if (fileNames.length === 1) {
      return NextResponse.json({ selectedFile: fileNames[0], priorityTier: "P_only", reason: "Only one file available" });
    }

    const { text } = await generateText({
      model: getModel({ provider: "openrouter", modelName: "anthropic/claude-sonnet-4-5" }),
      prompt: tariffFileSelectionPrompt(fileNames, insurerCode, isPsu),
    });

    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean) as {
      selectedFile: string;
      priorityTier: string;
      reason: string;
    };

    // Validate the selected file exists in the list
    if (!fileNames.includes(parsed.selectedFile)) {
      // AI hallucinated a file name — fall back to first file
      return NextResponse.json({ selectedFile: fileNames[0], priorityTier: "fallback", reason: "AI returned unknown filename, using first file" });
    }

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[tariff-file-selection] error:", e);
    return NextResponse.json({ selectedFile: null, reason: String(e) }, { status: 500 });
  }
}
