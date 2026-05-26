"use client";

import { useEffect, useRef } from "react";
import type { ProcessingState } from "@/src/processing-service";

interface ProcessingLogsProps {
  isProcessing: boolean;
  state?: ProcessingState;
  showLogs: boolean;
  onToggleLogs: (value: boolean) => void;
  logs: Array<{ id: string; message: string }>;
}

export function ProcessingLogs({ isProcessing, state, logs }: ProcessingLogsProps) {
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom as new logs arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  // Real completion from Convex
  const realCompleted = state?.completed ?? 0;
  const realTotal     = state?.total ?? 1;
  const realPct       = realTotal > 0 ? Math.round((realCompleted / realTotal) * 100) : 0;
  const status        = state?.status ?? "unknown";
  const errorMsg      = state?.error;

  const isDone   = realPct >= 100;
  const isError  = status === "error" || !!errorMsg;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-900 text-slate-100 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${
            isError ? "bg-red-500" :
            isDone  ? "bg-green-500" :
            isProcessing ? "bg-yellow-500 animate-pulse" :
            "bg-slate-500"
          }`}></span>
          <span className="font-semibold text-slate-200">
            ClaimAI Processing Logs
          </span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-400">
            {isError ? "Error" : isDone ? "Complete" : isProcessing ? "Processing" : "Idle"}
          </span>
        </div>
        <div className="text-slate-400">
          {realCompleted}/{realTotal} ({realPct}%)
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
            <p>Waiting for backend logs...</p>
            <p className="text-[10px] text-slate-600">
              If this stays empty for more than 30 seconds, the job may not have started.
              Check Convex backend and ClaimAI Next.js server logs.
            </p>
          </div>
        ) : (
          <>
            {logs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="text-slate-500 shrink-0">›</span>
                <span className="text-slate-200 break-all whitespace-pre-wrap">{log.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </>
        )}
      </div>

      {/* Error footer */}
      {isError && errorMsg && (
        <div className="border-t border-red-800 bg-red-950 px-3 py-2 text-red-200">
          <strong>Error:</strong> {errorMsg}
        </div>
      )}
    </div>
  );
}
