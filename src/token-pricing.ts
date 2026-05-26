type UsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheCreationInputTokens?: number;
};

const GEMINI_INPUT_USD_PER_MILLION = 0.5;
const GEMINI_OUTPUT_USD_PER_MILLION = 3;
const GEMINI_CACHE_INPUT_USD_PER_MILLION = 0.05;

const TOKENS_PER_MILLION = 1_000_000;

function toNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function isGeminiModel(provider: string, modelName: string): boolean {
  return (
    provider.toLowerCase().includes("gemini") ||
    modelName.toLowerCase().includes("gemini")
  );
}

export function getModelCostUsd(args: {
  provider: string;
  modelName: string;
  usage: UsageLike;
}): number {
  const { provider, modelName, usage } = args;

  if (!isGeminiModel(provider, modelName)) {
    return 0;
  }

  const inputTokens = toNonNegativeNumber(
    usage.inputTokens ?? usage.promptTokens,
  );
  const outputTokens = toNonNegativeNumber(
    usage.outputTokens ?? usage.completionTokens,
  );
  const cachedInputTokens = toNonNegativeNumber(
    usage.cachedInputTokens ?? usage.cacheCreationInputTokens,
  );

  const inputCost = (inputTokens / TOKENS_PER_MILLION) * GEMINI_INPUT_USD_PER_MILLION;
  const outputCost =
    (outputTokens / TOKENS_PER_MILLION) * GEMINI_OUTPUT_USD_PER_MILLION;
  const cacheInputCost =
    (cachedInputTokens / TOKENS_PER_MILLION) * GEMINI_CACHE_INPUT_USD_PER_MILLION;

  return inputCost + outputCost + cacheInputCost;
}
