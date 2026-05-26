import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/src/model-provider";

export async function POST(request: NextRequest) {
  try {
    const { prompt } = (await request.json()) as { prompt: string };
    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

    const { text } = await generateText({
      model: getModel({ provider: "openrouter", modelName: "anthropic/claude-sonnet-4-5" }),
      prompt,
    });

    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
