"use client";

import { useEffect, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamicImport from "next/dynamic";
import type { RefObject } from "react";
import { BenefitPlanTab } from "./tabs/benefit-plan-tab";

const PDFViewer = dynamicImport(() => import("@/components/pdf-viewer"), {
  ssr: false,
});

type ActivePdf = "hospital" | "tariff" | "benefitPlan";

interface PdfViewerPanelProps {
  activePdfFile: ActivePdf;
  onActivePdfChange: (value: ActivePdf) => void;
  hospitalBill: File | string | null;
  tariffFile: File | string | null;
  claimId?: string;
  pdfContainerRef: RefObject<HTMLDivElement | null>;
  onPdfWidthChange: (width: number) => void;
  pdfPages: { hospital: number; tariff: number };
  setPdfPages: React.Dispatch<
    React.SetStateAction<{ hospital: number; tariff: number }>
  >;
  onDocumentLoadSuccess: ({ numPages }: { numPages: number }) => void;
  onDocumentLoadError: (error: Error) => void;
  pdfWidth: number;
  pdfError: Error | null;
  showSampleData: boolean;
}

export function PdfViewerPanel({
  activePdfFile,
  onActivePdfChange,
  hospitalBill,
  tariffFile,
  claimId,
  pdfContainerRef,
  onPdfWidthChange,
  pdfPages,
  setPdfPages,
  onDocumentLoadSuccess,
  onDocumentLoadError,
  pdfWidth,
  pdfError,
  showSampleData,
}: PdfViewerPanelProps) {
  useEffect(() => {
    const containerEl = pdfContainerRef.current;
    if (!containerEl) return;

    const updateWidth = () => {
      onPdfWidthChange(Math.max(0, containerEl.clientWidth - 32));
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(() => updateWidth());
    resizeObserver.observe(containerEl);
    window.addEventListener("resize", updateWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [pdfContainerRef, onPdfWidthChange]);

  const availableFiles = useMemo(
    () =>
      [
        hospitalBill && "hospital",
        tariffFile && "tariff",
        claimId && "benefitPlan",
      ].filter(Boolean) as ActivePdf[],
    [hospitalBill, tariffFile, claimId],
  );

  const renderFileTabs = () => {
    if (availableFiles.length <= 1) return null;

    return (
      <Tabs value={activePdfFile} onValueChange={(value) => onActivePdfChange(value as ActivePdf)} className="mb-4 px-2 py-1">
        <TabsList className="w-auto">
            {hospitalBill && (
              <TabsTrigger value="hospital">
                Hospital Bill
              </TabsTrigger>
            )}
            {tariffFile && (
              <TabsTrigger value="tariff">
                Tariff Reference
              </TabsTrigger>
            )}
            {claimId && (
              <TabsTrigger value="benefitPlan">Vineel Plan</TabsTrigger>
            )}
        </TabsList>
      </Tabs>
    );
  };

  const getCurrentFile = () => {
    if (activePdfFile === "hospital" && hospitalBill) return hospitalBill;
    if (activePdfFile === "tariff" && tariffFile) return tariffFile;
    if (activePdfFile === "benefitPlan") return null;
    if (hospitalBill) return hospitalBill;
    if (tariffFile) return tariffFile;
    return null;
  };

  const currentPages =
    activePdfFile === "hospital"
      ? pdfPages.hospital
      : activePdfFile === "tariff"
        ? pdfPages.tariff
        : 0;

  const currentFile = getCurrentFile();

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderFileTabs()}
          <div
            ref={pdfContainerRef}
            className="border bg-gray-50 overflow-y-auto flex-1"
          >
            {activePdfFile === "benefitPlan" ? (
              <div className="h-full overflow-y-auto p-3">
                <BenefitPlanTab claimId={claimId} />
              </div>
            ) : currentFile ? (
              <PDFViewer
                file={currentFile}
                onLoadSuccess={({ numPages }) => {
                  setPdfPages((prev) => ({
                    ...prev,
                    [activePdfFile]: numPages,
                  }));
                  onDocumentLoadSuccess({ numPages });
                }}
                onLoadError={onDocumentLoadError}
                numPages={currentPages}
                pdfWidth={pdfWidth}
                pdfError={pdfError}
              />
            ) : showSampleData ? (
              <div className="flex flex-col items-center justify-center h-96 text-center">
                <p className="text-lg font-medium text-muted-foreground mb-2">
                  Sample Demonstration Mode
                </p>
                <p className="text-sm text-muted-foreground">
                  PDF viewer would appear here with the uploaded document
                </p>
              </div>
            ) : null}
          </div>
          {currentPages > 0 && (
            <div className="text-center text-sm text-muted-foreground">
              {currentPages} page{currentPages !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
