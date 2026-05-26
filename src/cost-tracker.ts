export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CostedData {
  cost: number;
  usage: TokenUsage;
}

export class CostTracker {
  private totalCost = 0;
  private usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  add(cost: number, tokenUsage: TokenUsage): void {
    this.totalCost += cost;
    this.usage.inputTokens += tokenUsage.inputTokens;
    this.usage.outputTokens += tokenUsage.outputTokens;
    this.usage.totalTokens += tokenUsage.totalTokens;
  }

  addCostedData(data: CostedData): void {
    this.add(data.cost, data.usage);
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  snapshot(): { totalCost: number; usage: TokenUsage } {
    return {
      totalCost: this.totalCost,
      usage: { ...this.usage },
    };
  }
}

export function createTokenUsage(
  inputTokens: number,
  outputTokens: number
): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function sumTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}
