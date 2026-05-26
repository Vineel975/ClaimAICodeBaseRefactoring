import { ExtractionResult } from "./types";
import { ProcessSinglePdfResult } from "./extract";

export interface ProcessingState {
  status: "idle" | "processing" | "completed" | "error";
  files: Array<{
    file: string;
    status: "pending" | "processing" | "success" | "error";
    cost?: number;
    tokens?: number;
    timeMs?: number;
    statusMessage?: string;
  }>;
  completed: number;
  total: number;
  successCount: number;
  errorCount: number;
  totalCost: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  isComplete: boolean;
  results?: ExtractionResult[];
  totals?: ProcessSinglePdfResult["totals"];
  evaluation?: {
    matchingFiles: number;
    mismatchingFiles: number;
  };
  claimId?: string;
  error?: string;
  logs?: Array<{
    message: string;
    timestamp: string;
  }>;
}

class ProcessingService {
  private state: ProcessingState = {
    status: "idle",
    files: [],
    completed: 0,
    total: 0,
    successCount: 0,
    errorCount: 0,
    totalCost: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    isComplete: false,
    logs: [],
  };

  getState(): ProcessingState {
    return { ...this.state };
  }

  private addLog(message: string): void {
    const entry = {
      message,
      timestamp: new Date().toISOString(),
    };
    const existingLogs = this.state.logs || [];
    this.state = {
      ...this.state,
      logs: [...existingLogs, entry].slice(-500),
    };
  }

  updateState(updates: Partial<ProcessingState>): void {
    this.addLog(
      `[DEBUG] ProcessingService: Updating state - status: ${
        updates.status || this.state.status
      }, completed: ${updates.completed ?? this.state.completed}/${
        updates.total ?? this.state.total
      }, success: ${updates.successCount ?? this.state.successCount}, errors: ${
        updates.errorCount ?? this.state.errorCount
      }`
    );
    this.state = { ...this.state, ...updates };
  }

  reset(): void {
    this.state = {
      status: "idle",
      files: [],
      completed: 0,
      total: 0,
      successCount: 0,
      errorCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      isComplete: false,
      logs: [],
    };
    this.addLog("[DEBUG] ProcessingService: State reset");
  }

  updateResult(
    filePath: string,
    analysis: ExtractionResult["analysis"]
  ): boolean {
    this.addLog(`[DEBUG] ProcessingService: Updating result for ${filePath}`);
    if (!this.state.results) {
      this.addLog(`[DEBUG] ProcessingService: No results array available`);
      return false;
    }

    const resultIndex = this.state.results.findIndex(
      (r) => r.filePath === filePath
    );

    if (resultIndex === -1) {
      this.addLog(`[DEBUG] ProcessingService: Result not found`);
      return false;
    }

    const updatedResults = [...this.state.results];
    updatedResults[resultIndex] = {
      ...updatedResults[resultIndex],
      analysis,
    };

    this.state = {
      ...this.state,
      results: updatedResults,
    };

    this.addLog(`[DEBUG] ProcessingService: Result updated successfully`);
    return true;
  }

  addCustomLog(message: string): void {
    this.addLog(message);
  }
}

export const processingService = new ProcessingService();
