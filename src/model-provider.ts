import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LanguageModelV3 } from "@ai-sdk/provider";

export type ModelProvider = "openai" | "openrouter";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});


export function getModel({
  provider,
  modelName,
}: {
  provider: ModelProvider;
  modelName: string;
}): LanguageModelV3 {
  if (provider === "openai") {
    return openai.responses(modelName);
  }

  return openrouter.chat(modelName);
}
