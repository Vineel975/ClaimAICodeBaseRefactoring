"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { tabsListVariants } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProcessingState } from "@/src/processing-service";
import type { ExtractionResult, PdfAnalysis, TariffBreakdownItem } from "@/src/types";
import { ChangeLog } from "@/src/changelog";
import { computeClaimCalculation } from "@/src/claim-calculation";
import { ProcessingLogs } from "./result-view/processing-logs";
import { pdfjs } from "./pdf-viewer";
import { PdfViewerPanel } from "./result-view/pdf-viewer-panel";
import { PatientInfoTab } from "./result-view/tabs/patient-info-tab";
import { MedicalAdmissibilityTab } from "./result-view/tabs/medical-admissibility-tab";
import { FinancialSummaryTab } from "./result-view/tabs/financial-summary-tab";
import { useMutation as useConvexMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ChevronDown, Save } from "lucide-react";
import { coerceClaimType, type ClaimType } from "@/lib/rules";

function getBasename(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

interface ResultViewProps {
  hospitalBill: File | string | null;
  tariffFile: File | string | null;
  tariffFileName?: string | null;
  showSampleData: boolean;
  state: ProcessingState | undefined;
  isProcessing: boolean;
  selectedFileResult: ExtractionResult | null;
  selectedAnalysis: PdfAnalysis | null;
  onDocumentLoadSuccess: ({ numPages }: { numPages: number }) => void;
  onDocumentLoadError: (error: Error) => void;
  pdfError: Error | null;
  spectraFields?: {
    availedAccommodationId?: string;
    facilityOptions?: Array<{ id: string; text: string }>;
    [key: string]: unknown;
  } | null;
  availedAccommodationOverride?: string;
}

// ── Save split-button with dropdown ──────────────────────────────────────────
function SaveDropdown({
  onSave,
  onSaveAndRaiseQuery,
  onDontSaveAndRaiseQuery,
  isSaving,
}: {
  onSave: () => void;
  onSaveAndRaiseQuery: () => void;
  onDontSaveAndRaiseQuery: () => void;
  isSaving: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex w-full">
      {/* Main Save button */}
      <Button
        type="button"
        disabled={isSaving}
        onClick={onSave}
        className="flex-1 rounded-r-none !border-emerald-700 !bg-emerald-600 !text-white hover:!bg-emerald-700"
      >
        <Save className="mr-1.5 h-4 w-4" />
        {isSaving ? "Saving..." : "Save"}
      </Button>

      {/* Chevron dropdown trigger */}
      <button
        type="button"
        disabled={isSaving}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-r-md border-l border-emerald-700 bg-emerald-600 px-2 text-white hover:bg-emerald-700 disabled:opacity-50"
        aria-label="More save options"
      >
        <ChevronDown className="h-4 w-4" />
      </button>

      {/* Dropdown menu */}
      {open && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-md border border-border bg-background shadow-lg">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
              onClick={() => { setOpen(false); onSaveAndRaiseQuery(); }}
            >
              <Save className="h-4 w-4 text-emerald-600" />
              Save and raise query
            </button>
            <div className="mx-3 border-t border-border" />
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted"
              onClick={() => { setOpen(false); onDontSaveAndRaiseQuery(); }}
            >
              <ChevronDown className="h-4 w-4 text-amber-500" />
              Don&apos;t save and raise query
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ResultView({
  hospitalBill,
  tariffFile,
  showSampleData,
  state,
  isProcessing,
  selectedFileResult,
  selectedAnalysis,
  onDocumentLoadSuccess,
  onDocumentLoadError,
  pdfError,
  tariffFileName: tariffFileNameProp,
  spectraFields,
  availedAccommodationOverride,
}: ResultViewProps) {
  const updateResult = useConvexMutation(api.processing.updateResult);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);
  const [pdfWidth, setPdfWidth] = useState<number>(800);
  const [activePdfFile, setActivePdfFile] = useState<
    "hospital" | "tariff" | "benefitPlan"
  >("hospital");
  const [pdfPages, setPdfPages] = useState<{
    hospital: number;
    tariff: number;
  }>({
    hospital: 0,
    tariff: 0,
  });
  // Per-page rotation state: key = pageIndex, value = 0|90|180|270
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  // Per-page zoom state: key = pageIndex, value = scale factor (default 1.0)
  const [pageZooms, setPageZooms] = useState<Record<number, number>>({});
  // Tracks the last populated ICD code from the Diagnosis-Linked section
  const [lastIcdCodeFromTab, setLastIcdCodeFromTab] = useState<string>("");
  const rotatePage = useCallback((pageIndex: number, direction: "cw" | "ccw") => {
    setPageRotations((prev) => ({
      ...prev,
      [pageIndex]: ((prev[pageIndex] ?? 0) + (direction === "cw" ? 90 : -90) + 360) % 360,
    }));
  }, []);

  const zoomPage = useCallback((pageIndex: number, direction: "in" | "out") => {
    setPageZooms((prev) => {
      const current = prev[pageIndex] ?? 1.0;
      const next = direction === "in"
        ? Math.min(current + 0.25, 3.0)
        : Math.max(current - 0.25, 0.5);
      return { ...prev, [pageIndex]: Math.round(next * 100) / 100 };
    });
  }, []);

  // Inject rotation buttons onto each react-pdf Page via DOM observation
  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!container) return;

    const addButtons = () => {
      const pages = container.querySelectorAll<HTMLElement>(".react-pdf__Page");
      pages.forEach((page, idx) => {
        if (page.querySelector(".claimai-rotate-btn")) return; // already added
        const wrapper = document.createElement("div");
        wrapper.className = "claimai-rotate-btn";
        wrapper.style.cssText = "position:absolute;top:6px;right:6px;z-index:10;display:flex;gap:4px;opacity:0;transition:opacity .15s;pointer-events:none;";
        page.style.position = "relative";

        const pageLabel = document.createElement("span");
        pageLabel.textContent = `P${idx + 1}`;
        pageLabel.style.cssText = "background:rgba(0,0,0,.5);color:#fff;font-size:10px;border-radius:3px;padding:2px 5px;display:flex;align-items:center;";
        wrapper.appendChild(pageLabel);

        const makBtn = (label: string, dir: "cw" | "ccw") => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.title = dir === "cw" ? "Rotate clockwise" : "Rotate counter-clockwise";
          btn.innerHTML = dir === "cw"
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.55"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-4.55"/></svg>`;
          btn.style.cssText = "background:rgba(0,0,0,.5);border:none;border-radius:3px;padding:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;";
          btn.addEventListener("click", (e) => { e.stopPropagation(); rotatePage(idx, dir); });
          return btn;
        };
        wrapper.appendChild(makBtn("↺", "ccw"));
        wrapper.appendChild(makBtn("↻", "cw"));

        // Zoom buttons
        const makZoomBtn = (label: string, dir: "in" | "out") => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.title = dir === "in" ? "Zoom in" : "Zoom out";
          btn.innerHTML = dir === "in"
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
          btn.style.cssText = "background:rgba(0,0,0,.5);border:none;border-radius:3px;padding:3px;cursor:pointer;display:flex;align-items:center;justify-content:center;";
          btn.addEventListener("click", (e) => { e.stopPropagation(); zoomPage(idx, dir); });
          return btn;
        };
        wrapper.appendChild(makZoomBtn("−", "out"));
        wrapper.appendChild(makZoomBtn("+", "in"));

        page.appendChild(wrapper);
        page.addEventListener("mouseenter", () => { wrapper.style.opacity = "1"; wrapper.style.pointerEvents = "auto"; });
        page.addEventListener("mouseleave", () => { wrapper.style.opacity = "0"; wrapper.style.pointerEvents = "none"; });
      });
    };

    // Apply CSS rotation and zoom to pages based on state
    const applyRotations = () => {
      const pages = container.querySelectorAll<HTMLElement>(".react-pdf__Page");
      pages.forEach((page, idx) => {
        const rotation = pageRotations[idx] ?? 0;
        const zoom     = pageZooms[idx] ?? 1.0;
        const transform = `rotate(${rotation}deg) scale(${zoom})`;
        const canvas = page.querySelector<HTMLElement>("canvas");
        if (canvas) { canvas.style.transform = transform; canvas.style.transformOrigin = "top left"; }
        const inner = page.querySelector<HTMLElement>(".react-pdf__Page__canvas");
        if (inner) { inner.style.transform = transform; inner.style.transformOrigin = "top left"; }
      });
    };

    const observer = new MutationObserver(() => { addButtons(); applyRotations(); });
    observer.observe(container, { childList: true, subtree: true });
    addButtons();
    applyRotations();

    return () => observer.disconnect();
  }, [pdfContainerRef, rotatePage, pageRotations, zoomPage, pageZooms, activePdfFile]);
  const reportSections = useMemo(
    () => [
      { id: "patient", label: "Patient Info" },
      { id: "medicalAdmissibility", label: "Medical Admissibility" },
      { id: "financialSummary", label: "Summary" },
    ],
    [],
  );
  const [activeSection, setActiveSection] = useState(reportSections[0].id);
  const reportScrollRef = useRef<HTMLDivElement>(null);
  const [editedAnalysis, setEditedAnalysis] = useState<PdfAnalysis | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [presentingComplaint, setPresentingComplaint] = useState("");
  const [processingRemarks,   setProcessingRemarks]   = useState("");
  const [doctorNotes,         setDoctorNotes]         = useState("");
  const [availedAccommodation, setAvailedAccommodation] = useState("");

  // claimType — derived from Mst_PropoertyValues PropertyID=87 (466=Cataract, 469=Maternity)
  // coerceClaimType handles undefined, null, wrong types, and unknown values safely.
  // Falls back to "other" (uses generic prompts) for any invalid input.
  const claimType: ClaimType = coerceClaimType(spectraFields?.claimType);
  const isMaternity = claimType === "maternity";
  console.log(`[ClaimAI] ── Claim Type Detection ──`);
  console.log(`[ClaimAI] claimDiagnosisId: ${spectraFields?.claimDiagnosisId ?? "not set"}`);
  console.log(`[ClaimAI] claimType: ${claimType.toUpperCase()}`);
  console.log(`[ClaimAI] isMaternity: ${isMaternity}`);
  const [selectedAvailedId,   setSelectedAvailedId]   = useState<string>("");
  const [facilityOptionsState, setFacilityOptionsState] = useState<Array<{id:string;text:string}>>([]);

  // Listen for messages from Spectra parent (facilityOptions, etc.)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      console.log("[ClaimAI] iframe received postMessage:", event.data?.source, event.data?.type);
      if (event.data?.source !== "spectra") return;
      if (event.data?.type === "setFacilityOptions") {
        const opts = event.data.options as Array<{id:string;text:string}>;
        if (opts?.length > 0) {
          setFacilityOptionsState(opts);
          console.log("[ClaimAI] Received facilityOptions:", opts.length);
        }
        const availedId = event.data.availedId as string;
        if (availedId) setSelectedAvailedId(availedId);
      }
      if (event.data?.type === "codingProcedureLimitResult") {
        console.log("[ClaimAI] Dispatching claimai:codingLimitResult event:", event.data);
        window.dispatchEvent(new CustomEvent("claimai:codingLimitResult", { detail: event.data }));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  const [selectedApprovedId,  setSelectedApprovedId]  = useState<string>("195"); // Day-care default
  const [dbBenefitPlanLimit, setDbBenefitPlanLimit] = useState<number | null>(null);
  const [benefitPlanSnapshot, setBenefitPlanSnapshot] = useState<Record<string, unknown> | null>(null);
  const changeLogRef = useRef(new ChangeLog());
  const pendingChangesRef = useRef(new ChangeLog()); // Track pending changes separately
  const [changeLogVersion, setChangeLogVersion] = useState(0);
  const changeLog = changeLogRef.current;
  const pendingChanges = pendingChangesRef.current;
  const [logContentVisible, setLogContentVisible] = useState(true);
  const [isLogsPanelForced, setIsLogsPanelForced] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; message: string }>>([]);
  const [reviewDecision, setReviewDecision] = useState<
    "approve" | "deny" | "query" | null
  >(null);
  const [isQueryDialogOpen, setIsQueryDialogOpen] = useState(false);
  const [queryType, setQueryType] = useState("");
  const [queryMessage, setQueryMessage] = useState("");
  // Stores the AI-determined approved accommodation ID — computed in background
  // when analysis loads so it's ready instantly when Save is clicked
  const approvedAccommodationRef = useRef<string | null>(null);

  // Helper to trigger re-render when changelog updates
  const updateChangeLog = () => {
    setChangeLogVersion((v) => v + 1);
  };

  // Helper to add pending change entry (not added to changelog until save)
  const addChangeLogEntry = (
    tab: string,
    record: string,
    field: string,
    previousValue: string | number | null | undefined,
    newValue: string | number | null | undefined,
  ) => {
    // Add to pending changes instead of changelog
    pendingChanges.addEntry(tab, record, field, previousValue, newValue);
    updateChangeLog();
  };

  // Set active PDF file to first available file
  useEffect(() => {
    if (hospitalBill && activePdfFile !== "hospital") {
      setActivePdfFile("hospital");
    } else if (!hospitalBill && tariffFile && activePdfFile !== "tariff") {
      setActivePdfFile("tariff");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalBill, tariffFile]);

  // Consume backend debug logs directly from processing state
  useEffect(() => {
    if (!state?.logs) return;
    const formatted = state.logs.map((entry, idx) => ({
      id: `${entry.timestamp}-${idx}`,
      message: entry.message,
    }));
    setLogs(formatted);
  }, [state?.logs]);

  // Initialize editedAnalysis when selectedAnalysis changes
  // Use a ref to track the last initialized filePath to avoid resetting on re-renders
  const lastInitializedFilePathRef = useRef<string | null>(null);
  useEffect(() => {
    const currentFilePath = selectedFileResult?.filePath;
    // Only initialize if filePath changed (don't reset on re-renders with same file)
    if (
      selectedAnalysis &&
      selectedFileResult &&
      currentFilePath !== lastInitializedFilePathRef.current
    ) {
      setEditedAnalysis(JSON.parse(JSON.stringify(selectedAnalysis)));

      // Restore changelog from saved data instead of clearing it
      if (
        selectedFileResult.changelogEntries &&
        selectedFileResult.changelogEntries.length > 0
      ) {
        changeLog.load(selectedFileResult.changelogEntries);
      } else {
        changeLog.clear(); // Only clear if no saved changelog exists
      }
      // Clear pending changes when switching files
      pendingChanges.clear();
      updateChangeLog();
      lastInitializedFilePathRef.current = currentFilePath || null;
    }
  }, [selectedFileResult?.filePath, selectedAnalysis, selectedFileResult]);

  // Use editedAnalysis for display, fallback to selectedAnalysis
  // This ensures all tabs use the latest edited data
  const displayAnalysis = useMemo(() => {
    return editedAnalysis || selectedAnalysis;
  }, [editedAnalysis, selectedAnalysis]);

  // Handler to scroll PDF to a specific page
  const handleScrollToPage = (pageNumber: number) => {
    if (!pdfContainerRef.current || !pageNumber || pageNumber <= 0) return;

    // Ensure hospital bill is active for medical admissibility
    if (hospitalBill) {
      setActivePdfFile("hospital");
    }

    // Small delay to ensure PDF pages are rendered
    setTimeout(() => {
      if (!pdfContainerRef.current) return;

      // Find the page element by its data-page-number attribute
      const pageElements =
        pdfContainerRef.current.querySelectorAll("[data-page-number]");

      for (const el of Array.from(pageElements)) {
        const pageNum = parseInt(
          (el as HTMLElement).getAttribute("data-page-number") || "0",
        );
        if (pageNum === pageNumber) {
          // Scroll to the page element
          (el as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
          break;
        }
      }
    }, 100);
  };

  const clearTariffHighlights = () => {
    document.querySelectorAll(".tariff-highlight").forEach((el) => {
      const h = el as HTMLElement;
      h.classList.remove("tariff-highlight");
      h.style.background = "";
      h.style.borderRadius = "";
      h.style.outline = "";
      h.style.mixBlendMode = "";
    });
    // Also remove canvas overlay highlights (Strategy B for scanned PDFs)
    document.querySelectorAll(".tariff-highlight-overlay").forEach(el => el.remove());
  };

  // Clear highlights when clicking anywhere outside the tariff rows
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If click is NOT inside a tariff row (green card) or the PDF panel, clear
      if (!target.closest(".tariff-row-clickable") && !target.closest(".react-pdf__Page__textContent")) {
        clearTariffHighlights();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Pending highlight request — survives re-renders caused by setActivePdfFile
  const pendingHighlightRef = useRef<{ pageNumber: number; highlightText?: string; highlightName?: string; rowTopPct?: number; rowBottomPct?: number } | null>(null);
  const highlightAttemptsRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runHighlight = () => {
    const req = pendingHighlightRef.current;
    console.log("[tariff-highlight] runHighlight called, req=", req, "pdfContainerRef=", !!pdfContainerRef.current);
    if (!req || !pdfContainerRef.current) return;

    const { pageNumber, highlightText, highlightName, rowTopPct, rowBottomPct } = req;

    const normalize = (s: string) => s.replace(/[,\s]+/g, " ").trim().toLowerCase();

    const getSpanTopPx = (span: HTMLElement): number | null => {
      const top = span.style.top;
      if (top) {
        const calcMatch = top.match(/\*\s*([\d.]+)px/);
        if (calcMatch) return parseFloat(calcMatch[1]);
        if (top.endsWith("px")) return parseFloat(top);
        if (top.endsWith("%")) return parseFloat(top);
      }
      return null;
    };

    const applyHighlight = (span: HTMLElement) => {
      span.classList.add("tariff-highlight");
      span.style.background = "rgba(251, 191, 36, 0.45)";
      span.style.borderRadius = "2px";
      span.style.outline = "1px solid rgba(217, 119, 6, 0.6)";
      span.style.mixBlendMode = "multiply";
    };

    // Find wrapper
    const wrappers = pdfContainerRef.current.querySelectorAll("[data-page-number]");
    console.log("[tariff-highlight] wrappers found=", wrappers.length,
      "innerHTML snippet=", pdfContainerRef.current.innerHTML.slice(0, 300));
    let targetWrapper: HTMLElement | null = null;
    for (const el of Array.from(wrappers)) {
      if (parseInt((el as HTMLElement).getAttribute("data-page-number") || "0") === pageNumber) {
        targetWrapper = el as HTMLElement;
        break;
      }
    }

    if (!targetWrapper) {
      if (highlightAttemptsRef.current < 15) {
        highlightAttemptsRef.current++;
        highlightTimerRef.current = setTimeout(runHighlight, 400);
      }
      return;
    }

    // Scroll to page — use instant scroll so the page enters viewport immediately,
    // which triggers react-pdf to render its text layer synchronously.
    targetWrapper.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" });

    if (!highlightText && !highlightName) {
      pendingHighlightRef.current = null;
      return;
    }

    // react-pdf lazy-renders text layer only when page is in viewport.
    // After scrollIntoView, give the browser a moment to render, then search.
    // Use document-wide query to find spans for this specific page number.
    const pageEl = targetWrapper.querySelector(`[data-page-number="${pageNumber}"].react-pdf__Page`) 
                ?? targetWrapper.querySelector(".react-pdf__Page");
    const textLayer = pageEl
      ? pageEl.querySelector(".react-pdf__Page__textContent")
      : targetWrapper.querySelector(".react-pdf__Page__textContent");

    const spans = textLayer ? Array.from(textLayer.querySelectorAll("span")) as HTMLElement[] : [];
    console.log("[tariff-highlight] targetWrapper found, textLayer=", !!textLayer, "spans=", spans.length);

    if (spans.length === 0) {
      if (highlightAttemptsRef.current < 5) {
        // Give react-pdf a few chances to render the text layer
        highlightAttemptsRef.current++;
        const delay = Math.min(300 + highlightAttemptsRef.current * 300, 1200);
        highlightTimerRef.current = setTimeout(runHighlight, delay);
        return;
      }
      // Text layer never populated — this is a scanned PDF.
      // Fall through to Strategy B (pdfjs direct text extraction + canvas overlay).
    }

    // Clear old highlights
    clearTariffHighlights();

    const normName    = highlightName ? normalize(highlightName) : "";
    const normAmount  = highlightText ? normalize(String(highlightText)) : "";
    const amountDigits = normAmount.replace(/[^0-9]/g, "");
    const nameWords   = normName.split(" ").filter(w => w.length > 3);

    const positionedSpans = spans.filter(s => getSpanTopPx(s) !== null);
    console.log("[tariff-highlight] positionedSpans=", positionedSpans.length, "of", spans.length,
      "sample span style=", spans[0]?.getAttribute("style"), "sample text=", spans[0]?.textContent?.slice(0,30));
    const allTops = [...new Set(
      positionedSpans.map(s => getSpanTopPx(s)).filter(t => t !== null) as number[]
    )].sort((a, b) => a - b);

    const highlightLine = (anchorTop: number) => {
      const anchorIdx = allTops.findIndex(t => Math.abs(t - anchorTop) <= 2);
      const linesToHighlight = new Set([anchorIdx]);
      if (anchorIdx + 1 < allTops.length) {
        const nextTop = allTops[anchorIdx + 1];
        const nextText = positionedSpans
          .filter(s => Math.abs(getSpanTopPx(s)! - nextTop) <= 2)
          .map(s => s.textContent || "").join("");
        if (Math.abs(nextTop - anchorTop) < 15 && !/[0-9]/.test(nextText)) {
          linesToHighlight.add(anchorIdx + 1);
        }
      }
      positionedSpans.forEach(span => {
        const t = getSpanTopPx(span)!;
        const idx = allTops.findIndex(v => Math.abs(v - t) <= 2);
        if (linesToHighlight.has(idx)) applyHighlight(span);
      });
    };

    // Detect Excel-converted PDFs by tariff filename
    const isExcelPdf = !!(tariffFileNameProp && (
      tariffFileNameProp.toLowerCase().endsWith(".xlsx") ||
      tariffFileNameProp.toLowerCase().endsWith(".xls")
    ));
    console.log("[tariff-highlight] isExcelPdf=", isExcelPdf, "tariffFileName=", tariffFileNameProp);

    // STRATEGY A: text search via DOM spans — works for all PDFs with embedded text
    // Use highlightName first (more specific), fall back to highlightText
    const searchTarget = highlightName || highlightText || "";
    if (searchTarget && searchTarget.length > 3) {
      const searchWords = normalize(searchTarget).split(" ").filter(w => w.length > 3);
      if (searchWords.length > 0) {
        let bestSpan: HTMLElement | null = null;
        let bestHits = 0;
        for (const span of positionedSpans) {
          const t = normalize(span.textContent || "");
          if (!t) continue;
          const hits = searchWords.filter(w => t.includes(w)).length;
          if (hits > bestHits) { bestHits = hits; bestSpan = span; }
        }
        // Threshold: 1 hit for Excel/short names, 2 for regular PDFs
        const threshold = isExcelPdf ? 1 : Math.min(2, searchWords.length);
        console.log("[tariff-highlight] Strategy A: searchTarget=", searchTarget, "words=", searchWords, "bestHits=", bestHits, "threshold=", threshold, "bestSpan text=", bestSpan?.textContent);
        if (bestSpan && bestHits >= threshold) {
          const spanStyle = bestSpan.getAttribute("style") || "";
          const isRotated = spanStyle.includes("rotate(-90deg)") || spanStyle.includes("rotate(90deg)");
          if (isRotated) {
            applyHighlight(bestSpan);
          } else {
            highlightLine(getSpanTopPx(bestSpan)!);
          }
          pendingHighlightRef.current = null;
          return;
        }
      }
    }

    // STRATEGY B: AI-provided row coordinates — only for scanned PDFs with no text layer
    // (Strategy A above handles all text-based PDFs including Excel-converted ones)
    if (!isExcelPdf && rowTopPct && rowBottomPct && rowTopPct > 0) {
      console.log("[tariff-highlight] Strategy B: using AI coordinates", rowTopPct, rowBottomPct);
      const canvas = targetWrapper.querySelector("canvas") as HTMLCanvasElement | null;
      if (canvas) {
        const canvasRect   = canvas.getBoundingClientRect();
        const containerRect = pdfContainerRef.current!.getBoundingClientRect();
        const scrollTop    = pdfContainerRef.current!.scrollTop;

        const canvasOffsetTop  = canvasRect.top  - containerRect.top  + scrollTop;
        const canvasOffsetLeft = canvasRect.left - containerRect.left;
        const canvasHeight     = canvasRect.height;
        const canvasWidth      = canvasRect.width;

        // Convert % of page to px within canvas
        const topPx    = canvasOffsetTop  + (rowTopPct    / 100) * canvasHeight;
        const bottomPx = canvasOffsetTop  + (rowBottomPct / 100) * canvasHeight;
        const height   = Math.max(bottomPx - topPx, 14);

        pdfContainerRef.current!.querySelectorAll(".tariff-highlight-overlay").forEach(el => el.remove());

        const overlay = document.createElement("div");
        overlay.className = "tariff-highlight-overlay";
        overlay.style.cssText = `
          position: absolute;
          left: ${canvasOffsetLeft}px;
          top: ${topPx}px;
          width: ${canvasWidth}px;
          height: ${height}px;
          background: rgba(251, 191, 36, 0.35);
          border-top: 2px solid rgba(217, 119, 6, 0.8);
          border-bottom: 2px solid rgba(217, 119, 6, 0.8);
          pointer-events: none;
          z-index: 10;
        `;
        (pdfContainerRef.current as HTMLElement).style.position = "relative";
        pdfContainerRef.current!.appendChild(overlay);
        console.log("[tariff-highlight] Strategy B: overlay at top=", topPx, "height=", height);
      }
      pendingHighlightRef.current = null;
      return;
    }

    // Group into lines
    const lineMap = new Map<number, HTMLElement[]>();
    for (const span of positionedSpans) {
      const t = getSpanTopPx(span)!;
      const existing = [...lineMap.keys()].find(k => Math.abs(k - t) <= 2);
      if (existing !== undefined) lineMap.get(existing)!.push(span);
      else lineMap.set(t, [span]);
    }

    // Detect "column layout" PDFs (Excel-converted) where all amounts are on one line
    // and all names are on another separate line. In this case we match by index position.
    const allLines = [...lineMap.entries()]
      .map(([top, lineSpans]) => ({
        top,
        spans: lineSpans,
        text: normalize(lineSpans.map(s => s.textContent || "").join(" ")),
        rawSpans: lineSpans,
      }))
      .filter(l => l.text.trim().length > 0)
      .sort((a, b) => a.top - b.top);

    // Check if this is a column-layout PDF:
    // One line has mostly numbers, another has mostly text (procedure names)
    const amountsLine = allLines.find(l => {
      const digits = l.text.replace(/[^0-9]/g, "");
      const nonDigits = l.text.replace(/[0-9\s|,]/g, "");
      return digits.length > nonDigits.length && l.rawSpans.length >= 3;
    });
    const namesLine = allLines.find(l => {
      const nonDigits = l.text.replace(/[0-9\s|,]/g, "");
      const digits = l.text.replace(/[^0-9]/g, "");
      return nonDigits.length > digits.length && l.rawSpans.length >= 3;
    });

    if (amountsLine && namesLine && amountsLine !== namesLine) {
      // Column layout — find index of target amount in amounts line
      // then highlight the span at the same index in names line
      const amountSpans = amountsLine.rawSpans;
      let amountIdx = -1;
      for (let i = 0; i < amountSpans.length; i++) {
        const spanDigits = (amountSpans[i].textContent || "").replace(/[^0-9]/g, "");
        if (spanDigits === amountDigits) { amountIdx = i; break; }
      }

      // Find name span by matching name words
      const nameSpans = namesLine.rawSpans;
      let nameIdx = -1;
      if (nameWords.length > 0) {
        let bestHits = 0;
        for (let i = 0; i < nameSpans.length; i++) {
          const t = normalize(nameSpans[i].textContent || "");
          const hits = nameWords.filter(w => t.includes(w)).length;
          if (hits > bestHits) { bestHits = hits; nameIdx = i; }
        }
      }
      // Fallback to same index as amount
      if (nameIdx === -1 && amountIdx !== -1) nameIdx = amountIdx;

      // Highlight matched name span and its corresponding amount span
      if (nameIdx !== -1 && nameIdx < nameSpans.length) {
        const t = getSpanTopPx(nameSpans[nameIdx]);
        if (t !== null) highlightLine(t);
      }
      if (amountIdx !== -1 && amountIdx < amountSpans.length) applyHighlight(amountSpans[amountIdx]);

      pendingHighlightRef.current = null;
      return;
    }

    // Standard layout — find best matching line using amount + name
    const topValues = [...lineMap.keys()].sort((a, b) => a - b);

    // Strategy 1: find the amount span directly (most reliable anchor)
    let amountAnchorTop: number | null = null;
    if (amountDigits.length > 0) {
      for (const span of positionedSpans) {
        const spanDigits = (span.textContent || "").replace(/[^0-9]/g, "");
        if (spanDigits === amountDigits) {
          amountAnchorTop = getSpanTopPx(span);
          break;
        }
      }
    }

    // Strategy 2: find the name span (most words matching)
    let nameAnchorTop: number | null = null;
    if (nameWords.length > 0) {
      let bestHits = 0;
      for (const span of positionedSpans) {
        const t = normalize(span.textContent || "");
        const hits = nameWords.filter(w => t.includes(w)).length;
        if (hits > bestHits) { bestHits = hits; nameAnchorTop = getSpanTopPx(span); }
      }
    }

    // If both found, highlight both their lines + any lines in between
    if (amountAnchorTop !== null && nameAnchorTop !== null) {
      const minTop = Math.min(amountAnchorTop, nameAnchorTop);
      const maxTop = Math.max(amountAnchorTop, nameAnchorTop);
      // Only highlight lines between name and amount if they're close (same entry)
      // Use a generous threshold: up to 4 lines apart
      const minIdx = topValues.findIndex(v => Math.abs(v - minTop) <= 2);
      const maxIdx = topValues.findIndex(v => Math.abs(v - maxTop) <= 2);
      if (minIdx !== -1 && maxIdx !== -1 && (maxIdx - minIdx) <= 4) {
        // Highlight all lines from name to amount (inclusive)
        for (let i = minIdx; i <= maxIdx; i++) {
          const lineTop = topValues[i];
          positionedSpans.forEach(span => {
            const t = getSpanTopPx(span);
            if (t !== null && Math.abs(t - lineTop) <= 2) applyHighlight(span);
          });
        }
      } else {
        // Too far apart — just highlight the two individual spans
        positionedSpans.forEach(span => {
          const t = getSpanTopPx(span);
          if (t === null) return;
          if (amountAnchorTop !== null && Math.abs(t - amountAnchorTop) <= 2) {
            const digits = (span.textContent || "").replace(/[^0-9]/g, "");
            if (digits === amountDigits) applyHighlight(span);
          }
          if (nameAnchorTop !== null && Math.abs(t - nameAnchorTop) <= 2) {
            const txt = normalize(span.textContent || "");
            if (nameWords.some(w => txt.includes(w))) applyHighlight(span);
          }
        });
      }
      pendingHighlightRef.current = null;
      return;
    }

    // Only one anchor found — highlight just that line
    const singleAnchorTop = amountAnchorTop ?? nameAnchorTop;
    if (singleAnchorTop === null) { pendingHighlightRef.current = null; return; }
    highlightLine(singleAnchorTop);

    pendingHighlightRef.current = null;
  };

  const handleScrollToTariffPage = (pageNumber?: number | null, highlightText?: string, highlightName?: string, rowTopPct?: number, rowBottomPct?: number) => {
    if (!pageNumber || pageNumber <= 0) return;
    if (!tariffFile) return;

    // Cancel any pending highlight
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    pendingHighlightRef.current = { pageNumber, highlightText, highlightName, rowTopPct, rowBottomPct };
    highlightAttemptsRef.current = 0;

    console.log("[tariff-highlight] scheduling runHighlight, page=", pageNumber, "text=", highlightText, "name=", highlightName);
    setActivePdfFile("tariff");
    // Start after tab switch renders
    highlightTimerRef.current = setTimeout(() => {
      console.log("[tariff-highlight] setTimeout fired, calling runHighlight");
      runHighlight();
    }, 300);
  };

  const formatAmountValue = (amount?: number | null) => {
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
      return "—";
    }
    return amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const claimCalculation = useMemo(() => {
    if (!displayAnalysis) return null;
    return computeClaimCalculation(displayAnalysis);
  }, [displayAnalysis]);

  // Track user-edited amounts from FinancialSummaryTab
  const [editedAmounts, setEditedAmounts] = useState<{
    claimed: number | null;
    tariff: number | null;
    approved: number | null;
  }>({ claimed: null, tariff: null, approved: null });

  // AI snapshot — stores the values AI originally populated so we can
  // detect if the doctor changed anything before clicking Save
  const [aiSnapshot, setAiSnapshot] = useState<Record<string, string> | null>(null);

  // Update snapshot with AI amounts once financial summary calculates them
  // Uses a ref to avoid re-render loop
  const snapshotAmountsSet = useRef(false);
  useEffect(() => {
    if (!aiSnapshot || snapshotAmountsSet.current) return;
    if (!claimCalculation && !displayAnalysis) return;

    const approvedAmt = claimCalculation?.finalInsurerPayable
      ?? claimCalculation?.insurerPayable
      ?? displayAnalysis?.finalInsurerPayable
      ?? 0;
    const billedAmt = claimCalculation?.hospitalBillAfterDiscount
      ?? claimCalculation?.hospitalBillBeforeDiscount
      ?? (displayAnalysis?.totalAmount as {value?: number} | undefined)?.value
      ?? 0;
    const tariffAmt = (displayAnalysis?.tariffExtractionItem as Array<{amount?: number}> | undefined)
      ?.reduce((s, i) => s + (i.amount ?? 0), 0) ?? 0;

    if (approvedAmt > 0 || billedAmt > 0) {
      snapshotAmountsSet.current = true;
      setAiSnapshot(prev => prev ? {
        ...prev,
        "Approved Amount":        approvedAmt > 0 ? String(approvedAmt) : "",
        "Hospital Bill Amount":   billedAmt   > 0 ? String(billedAmt)   : "",
        "Tariff Amount":          tariffAmt   > 0 ? String(tariffAmt)   : "",
        "Approved Accommodation": selectedApprovedId ?? "",
        "Availed Accommodation":  selectedAvailedId  ?? "",
        // Capture initial text field values at the moment amounts load
        // This is the correct "AI value" — what was there before doctor touched anything
        "Processing Remarks": processingRemarks.trim(),
        "Doctor Notes":       doctorNotes.trim(),
      } : prev);
    }
  }, [claimCalculation, displayAnalysis, aiSnapshot, selectedApprovedId, selectedAvailedId]);
  // Note: processingRemarks/doctorNotes not in deps — snapshotAmountsSet.current
  // ensures this only runs once so we capture their initial AI-loaded values correctly

  // Financial Summary Calculations
  const financialSummaryTotals = useMemo(() => {
    if (!claimCalculation) {
      return {
        hospitalBillAfterDiscount: 0,
        hospitalBillBeforeDiscount: 0,
        discount: 0,
        totalTariffDeductible: 0,
        totalTariffOverflow: 0,
        policyCoverageWithinTariff: 0,
        totalNME: 0,
        insurerPayable: 0,
        patientPayable: 0,
        cataractSublimit: null,
      };
    }
    return {
      hospitalBillAfterDiscount: claimCalculation.hospitalBillAfterDiscount,
      hospitalBillBeforeDiscount: claimCalculation.hospitalBillBeforeDiscount,
      discount: claimCalculation.discount,
      totalTariffDeductible: 0,
      totalTariffOverflow: 0,
      policyCoverageWithinTariff: 0,
      totalNME: 0,
      insurerPayable: claimCalculation.insurerPayable,
      patientPayable: 0,
      cataractSublimit: null,
    };
  }, [claimCalculation]);

  const finalInsurerPayable =
    claimCalculation?.finalInsurerPayable ?? displayAnalysis?.finalInsurerPayable;
  const finalInsurerPayableNotes =
    claimCalculation?.finalInsurerPayableNotes ||
    displayAnalysis?.finalInsurerPayableNotes;

  // ── Build pre-populated query message from validation failures ───────────────
  // Collects all field mismatches and missing investigation reports,
  // formats them as a structured query message.
  const buildQueryMessage = (): { type: string; message: string } => {
    const lines: string[] = [];

    // 1. Field validation mismatches from patientInfoDb sections
    if (displayAnalysis?.patientInfoDb?.sections?.length) {
      const allRows = displayAnalysis.patientInfoDb.sections.flatMap((s) => s.rows);

      const normalizeVal = (v: string | number | boolean | null | undefined): string =>
        String(v ?? "").trim();

      const normalizeDate = (s: string): string => {
        const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (iso) return iso[1];
        const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,"0")}-${dmy[1].padStart(2,"0")}`;
        return s;
      };

      const normalizeGender = (s: string): string => {
        const g = s.toLowerCase();
        if (g === "1" || g === "f" || g === "female") return "female";
        if (g === "2" || g === "m" || g === "male")   return "male";
        return g;
      };

      const fieldChecks: Array<{
        label: string;
        aiValue: string | null | undefined;
        aliases: string[];
        normalize?: (s: string) => string;
      }> = [
        { label: "Patient Name",    aiValue: displayAnalysis.patientName?.value as string,    aliases: ["membername","patientname","name"] },
        { label: "Patient Age",     aiValue: String(displayAnalysis.patientAge?.value ?? ""), aliases: ["age","patientage"] },
        { label: "Gender",          aiValue: displayAnalysis.patientGender?.value as string,  aliases: ["gender","genderid"], normalize: normalizeGender },
        { label: "Policy Number",   aiValue: displayAnalysis.policyNumber?.value as string,   aliases: ["uhidno","uhid","patientuhid","policyno","policynumber"] },
        { label: "Hospital Name",   aiValue: displayAnalysis.hospitalName?.value as string,   aliases: ["hospitalname","providername","name"] },
        { label: "Admission Date",  aiValue: displayAnalysis.admissionDate?.value as string,  aliases: ["dateofadmission","doa","admissiondate"], normalize: normalizeDate },
        { label: "Document Date",   aiValue: displayAnalysis.date?.value as string,           aliases: ["dateofbill","documentdate","billdate","date","createddate"] , normalize: normalizeDate },
      ];

      const normalizeKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

      for (const check of fieldChecks) {
        if (!check.aiValue) continue;
        const norm = check.normalize ?? ((s: string) => s.trim().toLowerCase().replace(/\s+/g," "));
        const aiNorm = norm(check.aiValue);
        if (!aiNorm) continue;

        // Find DB value using aliases
        let dbVal: string | null = null;
        for (const alias of check.aliases) {
          for (const row of allRows) {
            for (const [k, v] of Object.entries(row)) {
              if (normalizeKey(k) === alias && v !== null && v !== undefined && String(v).trim()) {
                dbVal = String(v).trim();
                break;
              }
            }
            if (dbVal) break;
          }
          if (dbVal) break;
        }

        if (!dbVal) continue;
        const dbNorm = norm(dbVal);
        if (aiNorm !== dbNorm) {
          lines.push(`• ${check.label}: "${check.aiValue}" in medical bill vs "${dbVal}" in Spectra DB`);
        }
      }
    }

    // 2. Missing investigation reports from conditionTests
    const conditionTests = (
      displayAnalysis?.medicalAdmissibility as
        | { conditionTests?: Array<{ testName: string; status: string }> }
        | null | undefined
    )?.conditionTests ?? [];

    const missingTests = conditionTests.filter((t) => t.status === "missing");
    for (const t of missingTests) {
      lines.push(`• ${t.testName} report is missing in the provided medical documents`);
    }

    if (!lines.length) return { type: "", message: "" };

    const message = "The following discrepancies/issues were found during claim review:\n\n"
      + lines.join("\n")
      + "\n\nPlease provide clarification or submit the correct documents.";

    return { type: "billing", message };
  };

  // ── Determine approved accommodation using AI ────────────────────────────────
  // Fetches benefit plan room rules + uses tariff/bill context to ask Claude
  // which facility option best matches what the patient is eligible for.
  // Sends data to Spectra parent via postMessage on Save click.
  // Populates: Aprv Accommodation + Probable Diagnosis + Present Complaint
  // Pre-populate presentingComplaint from AI extraction only
  useEffect(() => {
    if (presentingComplaint || !displayAnalysis) return;
    const admissibility = displayAnalysis?.medicalAdmissibility as {
      presentingComplaint?: string | null;
    } | null | undefined;
    if (admissibility?.presentingComplaint) {
      setPresentingComplaint(admissibility.presentingComplaint);
    }

    // Capture AI snapshot when analysis first loads — only editable fields tracked
    if (displayAnalysis && !aiSnapshot) {
      const snap: Record<string, string> = {};
      const admiss = displayAnalysis?.medicalAdmissibility as Record<string, unknown> | null | undefined;
      // Only fields the doctor can edit inside the iframe
      snap["Presenting Complaint"] = (admiss?.presentingComplaint as string) ?? "";
      snap["Processing Remarks"]   = "";  // starts empty — doctor fills it in
      snap["Doctor Notes"]         = "";  // starts empty — doctor fills it in
      snap["Hospital Bill Amount"] = "";  // set when financial summary loads
      snap["Tariff Amount"]        = "";  // set when financial summary loads
      snap["Approved Amount"]      = "";  // set when financial summary loads
      snap["Approved Accommodation"] = ""; // set from spectraFields
      snap["Availed Accommodation"]  = ""; // set from spectraFields
      setAiSnapshot(snap);
    }
  }, [displayAnalysis]);

  // Pre-populate doctorNotes and availedAccommodation from spectraFields
  useEffect(() => {
    if (availedAccommodationOverride) {
      setAvailedAccommodation(availedAccommodationOverride);
    }
    // Set selected IDs from spectraFields
    if (spectraFields?.availedAccommodationId) {
      setSelectedAvailedId(spectraFields.availedAccommodationId as string);
    }
    if (availedAccommodationOverride) {
      // Find ID matching the override text
      const match = (spectraFields?.facilityOptions as Array<{id:string;text:string}>|undefined)
        ?.find(o => o.text === availedAccommodationOverride);
      if (match) setSelectedAvailedId(match.id);
    }
    if (spectraFields?.availedAccommodation) {
      setAvailedAccommodation((spectraFields.availedAccommodation as string) ?? "");
    }
    const claimId = state?.claimId?.trim();
    if (!claimId || doctorNotes) return;
    // Try spectraFields first (fast path)
    if (spectraFields?.doctorNotes) {
      setDoctorNotes((spectraFields.doctorNotes as string) ?? "");
      return;
    }
    // Fallback: fetch directly from server
    fetch(`/api/doctor-notes?claimId=${encodeURIComponent(claimId)}`)
      .then((r) => r.json())
      .then((data) => { if (data.doctorNotes) setDoctorNotes(data.doctorNotes); })
      .catch(() => {});
  }, [state?.claimId, spectraFields]);


  // Fetch benefit plan snapshot for alignment conditions
  useEffect(() => {
    const claimId = state?.claimId?.trim();
    if (!claimId || benefitPlanSnapshot) return;
    let cancelled = false;
    fetch("/api/benefit-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setBenefitPlanSnapshot((d as { snapshot?: Record<string, unknown> }).snapshot ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.claimId]);

  const sendAccommodationToSpectra = async () => {
    if (!(window.parent && window.parent !== window)) {
      return;
    }

    // ── Approved Accommodation ───────────────────────────────────────────────
    const facilityId =
      approvedAccommodationRef.current ??
      (spectraFields?.availedAccommodationId as string | undefined) ??
      null;

    if (facilityId) {
      window.parent.postMessage(
        { source: "claimai", type: "setApprovedAccommodation", facilityId },
        "*",
      );
    } else {
      window.parent.postMessage(
        { source: "claimai", type: "copyAvailedToApproved" },
        "*",
      );
    }

    // ── Clinical / Treatment Details ─────────────────────────────────────────
    const diagnosis        = displayAnalysis?.medicalAdmissibility?.diagnosis        ?? null;
    const lineOfTreatment  = (displayAnalysis?.medicalAdmissibility as { lineOfTreatment?: string | null } | null | undefined)?.lineOfTreatment ?? null;

    // ── ICD codes — collect all 7 levels from the conditionKey "__icd__" ─────
    // icdLevels is local to medical-admissibility-tab; read from DOM state via event
    // We pass the diagnosis text so Spectra can look it up in its MasterData.ICD10

    // Infer hospital treatment type: Surgical or Medical
    const diagLower = (diagnosis ?? "").toLowerCase();
    const lineOfTreatmentLower = (lineOfTreatment ?? "").toLowerCase();
    const combined = `${diagLower} ${lineOfTreatmentLower}`;
    const hospTreatmentKeyword =
      /cataract|phaco|surger|cholecyst|appendic|hernia|fracture|ortho|laparoscop|bypass|angioplasty|stent|arthroplasty|joint replacement|spine|neurosurg|tumor|carcinoma|resection|transplant|excision|biopsy|repair|fixation/.test(combined)
        ? "surgical"
        : /pneumonia|infection|fever|diabet|hypertension|asthma|copd|bronchit|cardiac arrest|myocardial|renal failure|hepatitis|conservative|medical management|iv antibio|chemotherapy/.test(combined)
        ? "medical"
        : null;

    const procedureHint  = `${diagnosis ?? ""} ${lineOfTreatment ?? ""}`.toLowerCase();

    // Package amount = total medical bill from hospital (after discount if applicable)
    const packageAmount  = editedAmounts.claimed
                        ?? claimCalculation?.hospitalBillAfterDiscount
                        ?? claimCalculation?.hospitalBillBeforeDiscount
                        ?? (displayAnalysis?.totalAmount?.value ?? 0);

    // Tariff amount = sum of all extracted tariff line items (or doctor's edit)
    const tariffAmountTotal = editedAmounts.tariff
                            ?? (displayAnalysis?.tariffExtractionItem as Array<{amount?: number}> | null | undefined)
                                ?.reduce((s, i) => s + (i.amount ?? 0), 0)
                            ?? 0;

    // Eligible / Payable amount sent to coding = MINIMUM of:
    //   - Approved Amount displayed in iframe (doctor edits / finalInsurerPayable)
    //   - Total medical bill
    //   - Tariff amount (if extracted)
    //   - Benefit plan limit (if computed from DB)
    // Only positive values are considered — zero/null values are skipped.
    const baseApproved = editedAmounts.approved
                       ?? claimCalculation?.finalInsurerPayable
                       ?? displayAnalysis?.finalInsurerPayable
                       ?? claimCalculation?.insurerPayable
                       ?? 0;

    const eligibleCandidates: number[] = [];
    if (baseApproved      > 0) eligibleCandidates.push(baseApproved);
    if (packageAmount     > 0) eligibleCandidates.push(packageAmount);
    if (tariffAmountTotal > 0) eligibleCandidates.push(tariffAmountTotal);
    if (dbBenefitPlanLimit && dbBenefitPlanLimit > 0) eligibleCandidates.push(dbBenefitPlanLimit);

    const eligibleAmount = eligibleCandidates.length > 0
                         ? Math.min(...eligibleCandidates)
                         : 0;

    console.log("[ClaimAI] Eligible amount calculation:", {
      baseApproved,
      packageAmount,
      tariffAmountTotal,
      dbBenefitPlanLimit,
      chosen: eligibleAmount,
    });

    // Send clinical details immediately — don't wait for ICD fetch
    if (diagnosis || lineOfTreatment || presentingComplaint.trim() || hospTreatmentKeyword || processingRemarks.trim() || doctorNotes.trim()) {
      window.parent.postMessage(
        {
          source:               "claimai",
          type:                 "setClinicalDetails",
          diagnosis:            diagnosis             ?? "",
          lineOfTreatment:      lineOfTreatment       ?? "",
          presentingComplaint:  presentingComplaint.trim(),
          processingRemarks:    processingRemarks.trim(),
          doctorNotes:          doctorNotes.trim(),
          hospTreatmentKeyword: hospTreatmentKeyword  ?? "",
          icdSlots:             [],
          procedureHint:        procedureHint,
          eligibleAmount:       eligibleAmount,
          packageAmount:        packageAmount,
        },
        "*",
      );
    }

    // Send billing details to Spectra for Bill Details automation
    // Reuse tariffAmountTotal that was already calculated above for eligibleAmount.
    const tariffAmtForBilling = tariffAmountTotal;
    if (packageAmount > 0 || tariffAmtForBilling > 0) {
      window.parent.postMessage(
        {
          source:             "claimai",
          type:               "setBillingDetails",
          hospitalBillAmount: packageAmount,
          tariffAmount:       tariffAmtForBilling,
          totalAmountApproved: eligibleAmount,
        },
        "*",
      );
    }

    // Fetch ICD codes in background and send as separate message
    if (diagnosis) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const icdRes = await fetch(`/api/icd?diagnosis=${encodeURIComponent(diagnosis)}`, { signal: controller.signal });
        clearTimeout(timer);
        if (icdRes.ok) {
          const icdData = await icdRes.json() as { slots?: Array<{ code: string; description: string; level: number } | null> };
          const icdSlots = icdData.slots ?? [];

          // Override with doctor-selected ICD code from Diagnosis-Linked section if available
          const finalIcdCode = lastIcdCodeFromTab.trim() || undefined;

          window.parent.postMessage(
            {
              source:        "claimai",
              type:          "setIcdSlots",
              icdSlots,
              procedureHint,
              eligibleAmount,
              packageAmount,
              lastIcdCode:   finalIcdCode, // explicit override — takes priority in Spectra
            },
            "*",
          );
        }
      } catch { /* ignore */ }
    }
  };

  const determineApprovedAccommodation = async (): Promise<string | null> => {
    try {
      const claimId = state?.claimId?.trim();
      const facilityOptions = (spectraFields?.facilityOptions as Array<{ id: string; text: string }> | undefined) ?? [];
      const availedId = spectraFields?.availedAccommodationId as string | undefined;
      if (!claimId || !facilityOptions.length || !availedId) return availedId ?? null;

      // Find availed room text
      const availedOption = facilityOptions.find((f) => f.id === availedId);
      const availedText = availedOption?.text ?? availedId;

      // Fetch benefit plan room conditions
      let roomNotes = "";
      let roomRows: Array<Record<string, unknown>> = [];
      try {
        const bpRes = await fetch("/api/benefit-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimId }),
        });
        if (bpRes.ok) {
          const bpData = await bpRes.json() as {
            snapshot?: {
              remarks?: {
                room?: Array<Record<string, unknown>>;
                main?: Array<Record<string, unknown>>;
              };
            };
          };
          const mainRow = bpData?.snapshot?.remarks?.main?.[0] ?? {};
          roomNotes = String(mainRow["RoomNotes"] ?? "").trim();
          roomRows = bpData?.snapshot?.remarks?.room ?? [];
        }
      } catch { /* use empty */ }

      // Collect tariff room rent cap
      const tariffItems = displayAnalysis?.tariffExtractionItem ?? [];
      const roomRentCapItem = tariffItems.find((t) =>
        /room\s*rent\s*cap/i.test(t.name) || /accommodation\s*cap/i.test(t.name)
      );
      const roomRentCap = roomRentCapItem ? `₹${roomRentCapItem.amount}/day` : null;

      // Collect hospital bill room charges
      const billSummary = displayAnalysis?.hospitalSummary ?? [];
      const roomChargeItem = billSummary.find((s) =>
        /room/i.test(s.serviceName) || /accommodation/i.test(s.serviceName)
      );
      const roomCharge = roomChargeItem ? `₹${roomChargeItem.amount}` : null;

      // Days in hospital
      const admDate = displayAnalysis?.admissionDate?.value;
      const disDate = displayAnalysis?.dischargeDate?.value;
      let days: number | null = null;
      if (admDate && disDate) {
        const d1 = new Date(admDate), d2 = new Date(disDate);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
          days = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000));
        }
      }

      // Build prompt — using string concat to avoid nested template literal syntax errors
      const facilityList = facilityOptions.map((f) => "  " + f.id + ": " + f.text).join("\n");
      const roomRowsText = roomRows.length > 0
        ? "Room details: " + JSON.stringify(roomRows)
        : "";
      const roomChargeNum = (days && roomCharge)
        ? Math.round(Number(String(roomCharge).replace(/[^0-9]/g, "")) / days)
        : 0;
      const roomChargePerDay = (days && roomCharge)
        ? " over " + String(days) + " days (approx Rs." + String(roomChargeNum) + "/day)"
        : "";

      const prompt = [
        "You are a health insurance claim auditor. Based on the following information, decide which approved accommodation type should be applied.",
        "",
        "AVAILED ACCOMMODATION (what patient used): " + availedText,
        "",
        "AVAILABLE ACCOMMODATION OPTIONS (id - name):",
        facilityList,
        "",
        "BENEFIT PLAN ROOM CONDITIONS:",
        roomNotes || "(no room notes in benefit plan)",
        roomRowsText,
        "",
        "TARIFF ROOM RENT CAP: " + (roomRentCap ?? "(not specified in tariff)"),
        "",
        "HOSPITAL ROOM CHARGES: " + (roomCharge ?? "(not found in bill summary)") + roomChargePerDay,
        "",
        "INSTRUCTIONS:",
        "1. Compare the availed accommodation with the benefit plan room conditions and tariff cap.",
        "2. If the availed room is within the eligible limit, approve the same room type.",
        "3. If the availed room exceeds the limit (e.g. private room but policy covers semi-private), approve the highest eligible room type.",
        "4. If no room conditions are specified, approve same as availed.",
        "5. Return ONLY a JSON object with exactly this shape, no explanation:",
        '{"facilityId": "<id from options above>", "reason": "<one sentence reason>"}',
      ].join("\n");

      const response = await fetch("/api/accommodation-recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      if (!response.ok) return availedId;

      const data = await response.json() as { text?: string };
      const text = data.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return availedId;

      const parsed = JSON.parse(jsonMatch[0]) as { facilityId?: string; reason?: string };
      const recommendedId = parsed?.facilityId?.toString().trim();

      // Validate the returned ID is in the options list
      if (recommendedId && facilityOptions.some((f) => f.id === recommendedId)) {
        console.log("[ClaimAI] Accommodation recommendation:", parsed.reason);
        return recommendedId;
      }
      return availedId;
    } catch (err) {
      console.warn("[ClaimAI] determineApprovedAccommodation error:", err);
      return spectraFields?.availedAccommodationId ?? null;
    }
  };

  // Run accommodation determination in background as soon as data is available
  // so the result is ready by the time Save is clicked (no delay on save)
  // Placed here — after displayAnalysis and determineApprovedAccommodation are defined
  useEffect(() => {
    approvedAccommodationRef.current = null;
    if (!spectraFields?.availedAccommodationId || !spectraFields?.facilityOptions?.length) return;
    if (!displayAnalysis) return;

    let cancelled = false;
    const run = async () => {
      const result = await determineApprovedAccommodation();
      if (!cancelled) approvedAccommodationRef.current = result;
    };
    void run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spectraFields?.availedAccommodationId, displayAnalysis]);

  const handleSave = async () => {
    if (!editedAnalysis || !selectedFileResult) return;

    setIsSaving(true);
    try {
      // Move pending changes to changelog before saving
      // Group by tab+record+field to merge multiple changes to same field
      // Get all entries (not reversed, so we can process chronologically)
      const allPendingEntries = pendingChanges.getEntries().reverse(); // Reverse to get chronological order
      const mergedEntries = new Map<
        string,
        {
          tab: string;
          record: string;
          field: string;
          originalValue: string;
          finalValue: string;
        }
      >();

      // Group entries by tab+record+field
      const entriesByKey = new Map<string, typeof allPendingEntries>();
      allPendingEntries.forEach((entry) => {
        const key = `${entry.tab}|${entry.record}|${entry.field}`;
        if (!entriesByKey.has(key)) {
          entriesByKey.set(key, []);
        }
        entriesByKey.get(key)!.push(entry);
      });

      // For each field, use the first entry's previousValue and last entry's newValue
      entriesByKey.forEach((entries, key) => {
        // Entries are already in chronological order
        const firstEntry = entries[0];
        const lastEntry = entries[entries.length - 1];
        mergedEntries.set(key, {
          tab: firstEntry.tab,
          record: firstEntry.record,
          field: firstEntry.field,
          originalValue: firstEntry.previousValue,
          finalValue: lastEntry.newValue,
        });
      });

      // Add merged entries to changelog
      mergedEntries.forEach((entry) => {
        changeLog.addEntry(
          entry.tab,
          entry.record,
          entry.field,
          entry.originalValue,
          entry.finalValue,
        );
      });
      // Clear pending changes after moving to changelog
      pendingChanges.clear();
      updateChangeLog();

      // Serialize changelog entries for persistence
      const changelogEntries = changeLog.serialize();

      const recalculatedClaim = computeClaimCalculation(editedAnalysis);
      const analysisToSave: PdfAnalysis = {
        ...editedAnalysis,
        baseInsurerPayable: recalculatedClaim.insurerPayable,
        benefitAmount:
          recalculatedClaim.benefitAmount ?? editedAnalysis.benefitAmount,
        finalInsurerPayable:
          recalculatedClaim.finalInsurerPayable ?? undefined,
        finalInsurerPayableNotes:
          recalculatedClaim.finalInsurerPayableNotes || undefined,
      };

      await updateResult({
        filePath: selectedFileResult.filePath,
        analysis: analysisToSave,
        changelogEntries:
          changelogEntries.length > 0 ? changelogEntries : undefined,
      });

      setEditedAnalysis(analysisToSave);

      // Don't use alert() — it blocks postMessage flow in iframe context.
      // Spectra will show its own toast via claimAISaveComplete postMessage.

      // Send Refer to Insurer data — built from field mismatches + missing documents
      // Uses buildQueryMessage() which checks:
      //   1. Name/Age/Gender/Policy/Hospital/Date mismatches vs Spectra DB
      //   2. Missing investigation reports from conditionTests
      const referQuery = buildQueryMessage();
      if (referQuery.message.trim()) {
        window.parent.postMessage(
          {
            source:   "claimai",
            type:     "setReferToInsurer",
            remarks:  referQuery.message.trim(),
          },
          "*",
        );
      }

      // Wait for Spectra to process all preceding postMessages before firing claimAISaveComplete
      await new Promise(resolve => setTimeout(resolve, 800));

      // ── METRICS: Compare AI snapshot vs current editable field values ──────────
      // Only tracks fields the doctor can actually edit inside the iframe
      const changedFields: Array<{ field: string; aiValue: string; userValue: string }> = [];
      if (aiSnapshot) {
        const currentValues: Record<string, string> = {
          "Presenting Complaint":   presentingComplaint.trim(),
          "Processing Remarks":     processingRemarks.trim(),
          "Doctor Notes":           doctorNotes.trim(),
          "Hospital Bill Amount":   editedAmounts.claimed  != null ? String(editedAmounts.claimed)  : "",
          "Tariff Amount":          editedAmounts.tariff   != null ? String(editedAmounts.tariff)   : "",
          "Approved Amount":        editedAmounts.approved != null ? String(editedAmounts.approved) : "",
          "Approved Accommodation": selectedApprovedId ?? "",
          "Availed Accommodation":  selectedAvailedId  ?? "",
        };
        Object.entries(currentValues).forEach(([field, currVal]) => {
          const aiVal = (aiSnapshot[field] ?? "").toString().trim();
          const curr  = (currVal ?? "").toString().trim();

          // For text fields (Remarks, Notes): log if doctor typed anything different
          // from what was there when AI loaded (even if AI value was empty)
          const isTextField = field === "Processing Remarks" || field === "Doctor Notes";
          if (isTextField) {
            if (curr && curr !== aiVal) {
              changedFields.push({ field, aiValue: aiVal || "(empty)", userValue: curr });
            }
          } else {
            // For numeric/dropdown fields: only log if AI had a value AND doctor changed it
            if (aiVal && curr && aiVal !== curr) {
              changedFields.push({ field, aiValue: aiVal, userValue: curr });
            }
          }
        });
      }
      // ── END METRICS ─────────────────────────────────────────────────────────────

      // Notify Spectra: save complete — read jobId from URL path /job/{jobId}
      const urlJobId = typeof window !== "undefined"
        ? window.location.pathname.split("/").filter(Boolean).pop() ?? ""
        : "";
      window.parent.postMessage(
        {
          source:        "claimai",
          type:          "claimAISaveComplete",
          jobId:         urlJobId,
          changedFields, // doctor-modified fields for metrics logging
        },
        "*",
      );
    } catch (error) {
      console.error("Error saving:", error);
      alert(
        error instanceof Error
          ? error.message
          : "Failed to save changes. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = useMemo(() => {
    if (!editedAnalysis || !selectedAnalysis) return false;
    return JSON.stringify(editedAnalysis) !== JSON.stringify(selectedAnalysis);
  }, [editedAnalysis, selectedAnalysis]);

  const changeLogEntries = useMemo(
    () => changeLog.getEntries(),
    [changeLogVersion, changeLog],
  );

  const fileName = selectedFileResult
    ? getBasename(selectedFileResult.filePath)
    : "—";

  const handleAnalysisUpdate = (
    updater: (analysis: PdfAnalysis) => PdfAnalysis,
  ) => {
    setEditedAnalysis((prev) => {
      const base = prev || selectedAnalysis;
      if (!base) return prev;
      const updated = updater({ ...base });
      return updated;
    });
  };

  // Show processing logs when:
  // 1. Currently processing
  // 2. Status is idle
  // 3. No analysis available (regardless of status) - this includes error cases
  const hasLogs = (state?.logs?.length ?? 0) > 0;
  const isAwaitingResults =
    isProcessing || state?.status === "idle" || !selectedAnalysis;
  const shouldShowProcessingLogs =
    !showSampleData && (isAwaitingResults || isLogsPanelForced);
  const canToggleLogsPanel = !showSampleData && !isAwaitingResults && hasLogs;

  useEffect(() => {
    if (
      (!hasLogs || showSampleData) &&
      isLogsPanelForced &&
      !isAwaitingResults
    ) {
      setIsLogsPanelForced(false);
    }
  }, [hasLogs, isLogsPanelForced, isAwaitingResults, showSampleData]);

  const handlePdfWidthChange = (width: number) => {
    setPdfWidth(width);
  };

  useEffect(() => {
    const container = reportScrollRef.current;
    if (!container) return;

    const sectionElements = reportSections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (sectionElements.length === 0) return;

    let raf = 0;
    const updateActive = () => {
      raf = 0;
      const containerTop = container.getBoundingClientRect().top;
      const activationOffset = 80;
      let current = sectionElements[0].id;

      for (const section of sectionElements) {
        const offset = section.getBoundingClientRect().top - containerTop;
        if (offset <= activationOffset) {
          current = section.id;
        } else {
          break;
        }
      }

      setActiveSection(current);
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateActive);
    };

    const onResize = () => {
      updateActive();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    updateActive();

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [reportSections, selectedFileResult?.filePath]);

  return (
    <main className="flex-1 w-full h-full overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        {/* Tabs Content - Left Side */}
        <ResizablePanel
          defaultSize={40}
          className="flex h-full min-w-0 flex-col overflow-hidden border-r border-slate-200/80 bg-gradient-to-b from-slate-50 to-white"
        >
          {shouldShowProcessingLogs ? (
            <ProcessingLogs
              isProcessing={isProcessing}
              state={state}
              showLogs={logContentVisible}
              onToggleLogs={setLogContentVisible}
              logs={logs}
            />
          ) : selectedFileResult && selectedAnalysis ? (
            <div className="flex h-full w-full flex-col overflow-hidden">
              <div className="sticky top-0 z-10 w-full bg-background px-3 py-2">
                <div>
                  <div className="group/tabs" data-orientation="horizontal">
                    <div
                      data-slot="tabs-list"
                      data-variant="default"
                      className={cn(
                        tabsListVariants({ variant: "default" }),
                         "grid w-full grid-cols-3",
                      )}
                    >
                      {reportSections.map((section) => (
                        <button
                          key={section.id}
                          type="button"
                          data-active={
                            activeSection === section.id ? true : undefined
                          }
                          onClick={() => {
                            const target = document.getElementById(section.id);
                            if (target) {
                              setActiveSection(section.id);
                              target.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }
                            // Fix 10: when clicking Summary (Benefit Extraction), open Benefit Plan on right panel
                            if (section.id === "financialSummary") {
                              setActivePdfFile("benefitPlan");
                            }
                          }}
                           className={cn(
                             "gap-1.5 rounded-md border border-transparent px-1.5 py-1 text-sm font-medium group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg:not([class*='size-'])]:size-4 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center whitespace-nowrap transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                             "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
                             "data-active:bg-background dark:data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 data-active:text-foreground",
                             "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
                            )}
                        >
                          {section.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div
                ref={reportScrollRef}
                className="flex-1 overflow-y-auto scroll-smooth scroll-pt-0 px-3 pb-8 pt-3"
              >
                <section id="patient" className="py-2">
                  <PatientInfoTab
                    fileName={fileName}
                    claimId={state?.claimId}
                    displayAnalysis={displayAnalysis || null}
                    hasChanges={hasChanges}
                    isSaving={isSaving}
                    onSave={handleSave}
                    onUpdateAnalysis={handleAnalysisUpdate}
                    addChangeLogEntry={addChangeLogEntry}
                    claimType={claimType}
                    onScrollToPage={handleScrollToPage}
                    availedAccommodation={availedAccommodation || null}
                    approvedAccommodation="Day-care"
                    facilityOptions={facilityOptionsState.length > 0 ? facilityOptionsState : ((spectraFields?.facilityOptions as Array<{id:string;text:string}>|undefined) ?? [])}
                    selectedAvailedId={selectedAvailedId}
                    selectedApprovedId={selectedApprovedId}
                    onAvailedChange={(id, text) => {
                      setSelectedAvailedId(id);
                      setAvailedAccommodation(text);
                    }}
                    onApprovedChange={(id) => {
                      setSelectedApprovedId(id);
                      // Notify Spectra of approved accommodation change
                      window.parent.postMessage(
                        { source: "claimai", type: "setApprovedAccommodation", facilityId: id },
                        "*"
                      );
                    }}
                  />
                </section>
                <section id="medicalAdmissibility" className="py-2">
                  <MedicalAdmissibilityTab
                    fileName={fileName}
                    medicalAdmissibility={displayAnalysis?.medicalAdmissibility}
                    onScrollToPage={handleScrollToPage}
                    presentingComplaint={presentingComplaint}
                    onPresentingComplaintChange={setPresentingComplaint}
                    onLastIcdCodeChange={setLastIcdCodeFromTab}
                  />
                </section>
                <section id="financialSummary" className="py-2">
                  <FinancialSummaryTab
                    fileName={fileName}
                    claimCalculation={claimCalculation}
                    financialSummaryTotals={financialSummaryTotals}
                    onBenefitExtractionClick={() => setActivePdfFile("benefitPlan")}
                    diagnosis={selectedAnalysis?.medicalAdmissibility?.diagnosis ?? null}
                    finalInsurerPayable={finalInsurerPayable}
                    finalInsurerPayableNotes={finalInsurerPayableNotes}
                    formatAmountValue={formatAmountValue}
                    claimType={claimType}
                    lensType={displayAnalysis?.lensType}
                    lensTypePageNumber={displayAnalysis?.lensTypePageNumber}
                    lensTypeApproved={displayAnalysis?.lensTypeApproved}
                    eyeType={displayAnalysis?.eyeType}
                    isAllInclusivePackage={displayAnalysis?.isAllInclusivePackage ?? false}
                    tariffPageNumber={displayAnalysis?.tariffPageNumber}
                    tariffFileName={tariffFileNameProp ?? displayAnalysis?.tariffFileName}
                    tariffNotes={displayAnalysis?.tariffNotes}
                    tariffClarificationNote={displayAnalysis?.tariffClarificationNote}
                    tariffExtractionItem={displayAnalysis?.tariffExtractionItem}
                    hospitalBillBreakdown={displayAnalysis?.hospitalBillBreakdown}
                    hospitalBillPageNumber={displayAnalysis?.totalAmount?.pageNumber}
                    benefitAmount={dbBenefitPlanLimit ?? null}
                    onBenefitPlanLimitExtracted={(limit) => { if (limit) setDbBenefitPlanLimit(limit); }}
                    dbBenefitPlanLimit={dbBenefitPlanLimit}
                    onHospitalAmountClick={(pageNumber) => {
                      if (pageNumber) {
                        handleScrollToPage(pageNumber);
                      }
                    }}
                    onTariffAmountClick={handleScrollToTariffPage}
                    claimId={state?.claimId}
                    memberPolicyId={(spectraFields?.memberPolicyId as string | undefined) ?? undefined}
                    onAmountsChange={(claimed, tariff, approved) =>
                      setEditedAmounts({ claimed, tariff, approved })
                    }
                  />
                </section>

                <div className="mt-4 space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Processing Remarks
                  </label>
                  <textarea
                    value={processingRemarks}
                    onChange={(e) => setProcessingRemarks(e.target.value)}
                    placeholder="Enter processing remarks..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Processing Doctor Notes
                  </label>
                  <textarea
                    value={doctorNotes}
                    onChange={(e) => setDoctorNotes(e.target.value)}
                    placeholder="Doctor notes..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </div>
                <div className="mt-4 border-t border-border/80 py-4">
                  <SaveDropdown
                    onSave={async () => {
                      await sendAccommodationToSpectra();
                      await handleSave();
                    }}
                    onSaveAndRaiseQuery={async () => {
                      await sendAccommodationToSpectra();
                      await handleSave();
                      const q = buildQueryMessage();
                      if (q.type) setQueryType(q.type);
                      if (q.message) setQueryMessage(q.message);
                      setIsQueryDialogOpen(true);
                    }}
                    onDontSaveAndRaiseQuery={async () => {
                      await sendAccommodationToSpectra();
                      const q = buildQueryMessage();
                      if (q.type) setQueryType(q.type);
                      if (q.message) setQueryMessage(q.message);
                      setIsQueryDialogOpen(true);
                    }}
                    isSaving={isSaving}
                  />
                </div>
                {isQueryDialogOpen ? (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-xl rounded-xl border border-border bg-background p-4 shadow-lg">
                      <div className="mb-3 text-base font-semibold">Raise Query</div>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <div className="text-sm font-medium">Query Type</div>
                          <Select value={queryType} onValueChange={setQueryType}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select query type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="documentation">Documentation</SelectItem>
                              <SelectItem value="coding">Coding Clarification</SelectItem>
                              <SelectItem value="billing">Billing Clarification</SelectItem>
                              <SelectItem value="clinical">Clinical Clarification</SelectItem>
                              <SelectItem value="policy">Policy Clarification</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <div className="text-sm font-medium">Query Details</div>
                          <textarea
                            value={queryMessage}
                            onChange={(event) => setQueryMessage(event.target.value)}
                            placeholder="Enter query details..."
                            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setIsQueryDialogOpen(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            disabled={!queryType || !queryMessage.trim()}
                            onClick={() => {
                              setReviewDecision("query");
                              setIsQueryDialogOpen(false);
                            }}
                          >
                            Submit Query
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : state?.status === "completed" && selectedFileResult ? (
            <Card className="flex-1 overflow-y-auto">
              <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No analysis data found for this file.
              </CardContent>
            </Card>
          ) : (
            <Card className="flex-1 overflow-y-auto">
              <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                Loading...
              </CardContent>
            </Card>
          )}
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-slate-200/90" />

        <ResizablePanel defaultSize={60} className="h-full min-w-0 overflow-hidden bg-white">
          <PdfViewerPanel
            activePdfFile={activePdfFile}
            onActivePdfChange={(value) =>
              setActivePdfFile(value as "hospital" | "tariff" | "benefitPlan")
            }
            hospitalBill={hospitalBill}
            tariffFile={tariffFile}
            claimId={state?.claimId}
            pdfContainerRef={pdfContainerRef}
            onPdfWidthChange={handlePdfWidthChange}
            pdfPages={pdfPages}
            setPdfPages={setPdfPages}
            onDocumentLoadSuccess={onDocumentLoadSuccess}
            onDocumentLoadError={onDocumentLoadError}
            pdfWidth={pdfWidth}
            pdfError={pdfError}
            showSampleData={showSampleData}

          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}