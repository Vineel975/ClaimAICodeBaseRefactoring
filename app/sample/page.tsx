"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/navbar";
import { ResultView } from "@/components/result-view";
import type { ProcessingState } from "@/src/processing-service";
import type { ExtractionResult, PdfAnalysis } from "@/src/types";
import { sampleData } from "@/app/data/sample-data";

export default function SamplePage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [pdfError, setPdfError] = useState<Error | null>(null);

  // Create a mock state for sample data
  const state: ProcessingState = {
    status: "completed",
    files: [],
    results: [sampleData],
    logs: [],
    completed: 1,
    total: 1,
    successCount: 1,
    errorCount: 0,
    totalCost: 0,
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    isComplete: true,
    error: undefined,
  };

  const selectedFileResult: ExtractionResult = sampleData;
  const selectedAnalysis: PdfAnalysis | null =
    selectedFileResult?.analysis ||
    selectedFileResult?.fallbackAnalysis ||
    null;

  const onDocumentLoadSuccess = (_: { numPages: number }) => {};

  const onDocumentLoadError = (error: Error) => {
    setPdfError(error);
  };

  const handleStartNewReview = () => {
    router.push("/");
  };

  const handleLogout = () => {
    localStorage.removeItem("isAuthenticated");
    router.push("/login");
  };

  // Check authentication
  useEffect(() => {
    if (typeof window !== "undefined") {
      const authStatus = localStorage.getItem("isAuthenticated");
      if (authStatus === "true") {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        router.push("/login");
      }
    }
  }, [router]);

  // Initialize PDF.js worker
  useEffect(() => {
    if (typeof window !== "undefined") {
      import("react-pdf").then((module) => {
        module.pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${module.pdfjs.version}/build/pdf.worker.min.mjs`;
      });
    }
  }, []);

  if (isAuthenticated === null || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col overflow-hidden">
      <NavBar onLogout={handleLogout} onStartNewReview={handleStartNewReview} />

      <ResultView
        hospitalBill={null}
        tariffFile={null}
        showSampleData={true}
        state={state}
        isProcessing={false}
        selectedFileResult={selectedFileResult}
        selectedAnalysis={selectedAnalysis}
        onDocumentLoadSuccess={onDocumentLoadSuccess}
        onDocumentLoadError={onDocumentLoadError}
        pdfError={pdfError}
      />
    </div>
  );
}
