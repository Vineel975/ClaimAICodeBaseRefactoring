"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type {
  ConditionTestCheck,
  ConditionTestStatus,
  PdfAnalysis,
} from "@/src/types";

interface MedicalAdmissibilityTabProps {
  fileName: string;
  medicalAdmissibility?: PdfAnalysis["medicalAdmissibility"] | null;
  onScrollToPage?: (pageNumber: number) => void;
  presentingComplaint?: string;
  onPresentingComplaintChange?: (value: string) => void;
  /** Called whenever doctor changes ICD codes — passes the last populated code */
  onLastIcdCodeChange?: (code: string) => void;
}

type ConditionKey = string;

type TestRule = {
  key: string;
  label: string;
  expected: string;
  concern: string;
  evaluate: (input: {
    rawValue?: string;
    numericValue?: number;
    source?: ConditionTestCheck;
  }) => { status: ConditionTestStatus; reason?: string };
  matchers?: string[];
};

type ConditionRule = {
  key: ConditionKey;
  label: string;
  diagnosisKeywords: string[];
  tests: TestRule[];
  icdCode?: string;
};

type ConditionRow = {
  condition: string;
  test: string;
  reported: "Yes" | "No";
  icdCode?: string;
  pageNumber?: number;
  conditionKey?: string;
  matchedDiagnosis?: string;
};

function inferDefaultCataractIcdCode(
  medicalAdmissibility?: PdfAnalysis["medicalAdmissibility"] | null
): string {
  const diagnosis = (medicalAdmissibility?.diagnosis || "").toLowerCase();
  const doctorNotes = (medicalAdmissibility?.doctorNotes || "").toLowerCase();
  const conditionTestsText = (
    ((medicalAdmissibility as { conditionTests?: ConditionTestCheck[] })
      ?.conditionTests || []) as ConditionTestCheck[]
  )
    .map((ct) => {
      return `${ct.condition || ""} ${ct.matchedDiagnosis || ""} ${ct.testName || ""} ${ct.reportValue || ""} ${ct.sourceText || ""}`.toLowerCase();
    })
    .join(" ");

  const combined = `${diagnosis} ${doctorNotes} ${conditionTestsText}`.trim();

  if (
    combined.includes("secondary cataract") ||
    combined.includes("after cataract")
  ) {
    return "H26.40";
  }
  if (combined.includes("cortical")) {
    return "H25.9";
  }

  // Safe default starting point for cataract, user can change from dropdown.
  return "H25.9";
}

function matchesTestName(testName: string, rule: TestRule): boolean {
  const normalized = testName.toLowerCase();
  if (normalized.includes(rule.label.toLowerCase())) return true;
  if (rule.matchers) {
    return rule.matchers.some((matcher) => normalized.includes(matcher));
  }
  return false;
}

function matchesConditionName(
  condition: string | undefined,
  rule: ConditionRule
): boolean {
  if (!condition) return false;
  const normalized = condition.toLowerCase();
  return (
    normalized.includes(rule.label.toLowerCase()) ||
    normalized.includes(rule.key)
  );
}

/**
 * Fetches ICD-10-CM code for a medical condition using NLM API
 * Extracts the base condition name (removes parenthetical test info) for better search results
 */
interface IcdOption { code: string; description: string; level?: number; }

async function searchIcdCodes(query: string): Promise<IcdOption[]> {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`/api/icd?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return [];
    const data = await res.json() as { codes?: IcdOption[] };
    return data.codes ?? [];
  } catch { return []; }
}

async function fetchICDCode(condition: string): Promise<string | undefined> {
  const codes = await searchIcdCodes(condition.split("(")[0].trim());
  if (!codes.length) return undefined;
  if (condition.toLowerCase().includes("cataract")) {
    const h25 = codes.find((c) => c.code.startsWith("H25"));
    if (h25) return h25.code;
  }
  return codes[0].code;
}

async function fetchICDDescription(code: string): Promise<string> {
  if (!code) return "";
  try {
    const res = await fetch(`/api/icd?code=${encodeURIComponent(code)}`);
    if (!res.ok) return "";
    const data = await res.json() as { codes?: IcdOption[] };
    const codes = data.codes ?? [];
    const exact = codes.find((c) => c.code.toLowerCase() === code.toLowerCase());
    return exact?.description ?? codes[0]?.description ?? "";
  } catch { return ""; }
}

async function fetchICDOptions(condition: string): Promise<IcdOption[]> {
  return searchIcdCodes(condition.split("(")[0].trim());
}

// ── Searchable ICD Combobox ─────────────────────────────────────────────────
// ── ICD Dropdown Combobox ────────────────────────────────────────────────────
// Portal-based dropdown — renders outside the table so it never gets clipped.
// Trigger button shows current code; click opens a search input + results list
// anchored to the button position using fixed coordinates.
function IcdCombobox({
  value,
  onChange,
  placeholder = "Search…",
  levelLabel,
}: {
  value: string;
  onChange: (code: string, description: string) => void;
  placeholder?: string;
  levelLabel?: string;
}) {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<IcdOption[]>([]);
  const [loading, setLoading]   = useState(false);
  const [desc, setDesc]         = useState("");
  const [dropPos, setDropPos]   = useState({ top: 0, left: 0, width: 0 });
  const triggerRef              = useRef<HTMLButtonElement>(null);
  const inputRef                = useRef<HTMLInputElement>(null);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load description for current value
  useEffect(() => {
    if (value) fetchICDDescription(value).then((d) => setDesc(d ?? ""));
    else setDesc("");
  }, [value]);

  // Position dropdown below trigger button using fixed coords
  const openDropdown = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropPos({
      top:   rect.bottom + window.scrollY + 4,
      left:  rect.left   + window.scrollX,
      width: Math.max(rect.width, 320),
    });
    setQuery("");
    setResults([]);
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as Node;
      const portal = document.getElementById("icd-portal");
      if (portal && portal.contains(target)) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchIcdCodes(q);
      setResults(res);
      setLoading(false);
    }, 200);
  };

  const handleSelect = (opt: IcdOption) => {
    onChange(opt.code, opt.description);
    setDesc(opt.description);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("", "");
    setDesc("");
  };

  // Portal dropdown rendered at fixed position — never clipped by overflow:hidden parents
  const portal = typeof document !== "undefined"
    ? document.getElementById("icd-portal") ?? (() => {
        const el = document.createElement("div");
        el.id = "icd-portal";
        el.style.cssText = "position:absolute;top:0;left:0;z-index:9999;";
        document.body.appendChild(el);
        return el;
      })()
    : null;

  const dropdown = open && portal ? (
    <div
      style={{ position: "absolute", top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
      className="rounded-lg border border-gray-200 bg-white shadow-2xl overflow-hidden"
    >
      {/* Search input */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 bg-gray-50">
        <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Type ICD code or disease name…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
        />
        {query && (
          <button type="button" onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            className="text-gray-300 hover:text-gray-500">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Results */}
      <div className="max-h-60 overflow-y-auto">
        {!query && (
          <div className="px-4 py-3 text-xs text-gray-400">
            Start typing to search ICD-10 codes or disease names…
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            Searching…
          </div>
        )}
        {!loading && query && results.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-400">No results for &ldquo;{query}&rdquo;</div>
        )}
        {!loading && results.map((opt, i) => (
          <button
            key={opt.code}
            type="button"
            onClick={() => handleSelect(opt)}
            className={`flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-blue-50 transition-colors ${i > 0 ? "border-t border-gray-50" : ""}`}
          >
            <span className="shrink-0 mt-0.5 rounded bg-blue-100 px-2 py-0.5 font-mono text-xs font-bold text-blue-700">
              {opt.code}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-800 leading-snug">{opt.description}</div>
              {opt.level && (
                <div className="mt-0.5 text-[10px] text-gray-400">Level {opt.level}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="w-full">
        {/* Trigger button — shows current value or placeholder */}
        <button
          ref={triggerRef}
          type="button"
          onClick={openDropdown}
          className={`flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:border-blue-300 hover:bg-blue-50 ${
            value
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-400"
          }`}
        >
          <span className="flex-1 truncate font-mono font-medium">
            {value || placeholder}
          </span>
          <svg className="h-3 w-3 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        {/* Description below button */}
        {value && desc && (
          <div className="mt-0.5 flex items-start justify-between gap-1">
            <span className="truncate text-[10px] text-blue-500 leading-tight flex-1" title={desc}>
              {desc}
            </span>
            <button type="button" onClick={handleClear}
              className="shrink-0 text-gray-300 hover:text-red-400 transition-colors"
              title="Clear">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Portal — renders outside table DOM to avoid overflow clipping */}
      {portal && typeof window !== "undefined" && dropdown &&
        require("react-dom").createPortal(dropdown, portal)
      }
    </>
  );
}

const conditionRules: ConditionRule[] = [
  {
    key: "cataract",
    label: "Cataract (A-scan)",
    diagnosisKeywords: ["cataract"],
    icdCode: "H25.9", // Valid dropdown default (can be overridden by API/user)
    tests: [
      {
        key: "a_scan",
        label: "A-scan",
        expected: "",
        concern: "",
        evaluate: ({ rawValue }) => {
          // Check if A-scan is reported (Yes) or not (No)
          if (!rawValue) {
            return { status: "missing" };
          }
          const value = rawValue.toLowerCase();
          if (
            value === "yes" ||
            value.includes("a-scan") ||
            value.includes("ascan") ||
            value.includes("axial length")
          ) {
            return { status: "expected" };
          }
          return { status: "missing" };
        },
        matchers: ["a-scan", "ascan", "axial length", "axl"],
      },
    ],
  },
];

// Cataract ICD-10-CM codes with descriptions (2026)
const cataractICDCodes = [
  { code: "H26.9", description: "Unspecified cataract" },
  { code: "H25.9", description: "Unspecified age-related (senile) cataract" },
  { code: "H25.011", description: "Cortical age-related cataract, right eye" },
  { code: "H25.012", description: "Cortical age-related cataract, left eye" },
  { code: "H25.013", description: "Cortical age-related cataract, bilateral" },
  { code: "H26.40", description: "Secondary cataract, unspecified eye" },
  { code: "H26.41", description: "Secondary cataract, right eye" },
  { code: "H26.42", description: "Secondary cataract, left eye" },
  { code: "H26.43", description: "Secondary cataract, bilateral" },
];

function buildConditionRows(
  diagnosisText: string,
  conditionTests?: ConditionTestCheck[],
  icdCodeMap?: Map<string, string>
): ConditionRow[] {
  const rows: ConditionRow[] = [];

  for (const rule of conditionRules) {
    const aiCondition = conditionTests?.find((condition) =>
      matchesConditionName(condition.condition, rule)
    );
    const matchedByDiagnosis = rule.diagnosisKeywords.some((keyword) =>
      diagnosisText.includes(keyword)
    );

    if (!aiCondition && !matchedByDiagnosis) {
      continue;
    }

    // Get ICD code from map or rule
    const icdCode = icdCodeMap?.get(rule.key) || rule.icdCode || undefined;

    for (const testRule of rule.tests) {
      const fallbackConditionByTest = conditionTests?.find((condition) =>
        matchesTestName(condition.testName || "", testRule)
      );
      const aiTest =
        (aiCondition &&
        matchesTestName(aiCondition.testName || "", testRule)
          ? aiCondition
          : undefined) || fallbackConditionByTest;
      const selectedCondition = aiTest || aiCondition || fallbackConditionByTest;
      const rawValue = aiTest?.reportValue || aiTest?.sourceText;

      const evaluation = testRule.evaluate({
        rawValue,
        numericValue: undefined,
        source: aiTest,
      });

      // Determine if reported (Yes) or not (No)
      const reported: "Yes" | "No" =
        evaluation.status === "expected" ||
        (rawValue && rawValue.toLowerCase() === "yes") ||
        (aiTest && aiTest.status === "expected")
          ? "Yes"
          : "No";

      // Get page number from condition
      const conditionPageNumber = selectedCondition?.pageNumber;

      rows.push({
        condition: rule.label,
        test: testRule.label,
        reported,
        icdCode,
        pageNumber: conditionPageNumber,
        conditionKey: rule.key, // Add condition key for dropdown
      });
    }
  }

  return rows;
}

/**
 * Builds rows for AI-extracted conditions that don't match any hardcoded rule.
 * Handles any condition — maternity, glaucoma, diabetes, etc.
 */
function buildDynamicConditionRows(
  conditionTests: ConditionTestCheck[],
  icdCodeMap?: Map<string, string>,
): ConditionRow[] {
  const rows: ConditionRow[] = [];

  for (const ct of conditionTests) {
    const matchesRule = conditionRules.some((r) =>
      matchesConditionName(ct.condition, r)
    );
    if (matchesRule) continue;

    const conditionKey = (ct.condition || ct.matchedDiagnosis || "")
      .toLowerCase()
      .trim();
    if (!conditionKey) continue;

    const icdCode = icdCodeMap?.get(conditionKey) || undefined;
    const reported: "Yes" | "No" =
      ct.status === "expected" ||
      (ct.reportValue || "").toLowerCase() === "yes"
        ? "Yes"
        : "No";

    rows.push({
      condition: ct.condition || ct.matchedDiagnosis || "—",
      test: ct.testName || "—",
      reported,
      icdCode,
      pageNumber: ct.pageNumber,
      conditionKey,
    });
  }
  return rows;
}

export function MedicalAdmissibilityTab({
  fileName,
  medicalAdmissibility,
  onScrollToPage,
  presentingComplaint,
  onPresentingComplaintChange,
  onLastIcdCodeChange,
}: MedicalAdmissibilityTabProps) {
  const [icdCodeMap, setIcdCodeMap] = useState<Map<string, string>>(new Map());
  // 7 levels of ICD codes per condition key
  const [icdLevels, setIcdLevels] = useState<Map<string, string>[]>(
    Array.from({ length: 7 }, () => new Map<string, string>())
  );
  const [icdDescriptions, setIcdDescriptions] = useState<Map<string, string>>(new Map());
  const [icdOptionsMap, setIcdOptionsMap] = useState<Map<string, IcdOption[]>>(new Map());

  // Auto-generate all 7 ICD levels from diagnosis text
  useEffect(() => {
    const fetchICDCodes = async () => {
      if (!medicalAdmissibility) return;

      const diagnosisText = (medicalAdmissibility.diagnosis || "").trim();
      const conditionTests =
        (medicalAdmissibility as { conditionTests?: ConditionTestCheck[] }).conditionTests || [];
      const fallbackCataractIcd = inferDefaultCataractIcdCode(medicalAdmissibility);

      // AI-extracted code1 — use as override for the hierarchy lookup if available
      const aiCode1 = (medicalAdmissibility as { icdCode1?: string })?.icdCode1?.trim() || null;

      // ── Find present conditions (for conditionRows table) ─────────────────────
      const diagLower = diagnosisText.toLowerCase();
      const presentConditions = new Set<string>();
      for (const rule of conditionRules) {
        const aiCondition = conditionTests.find((ct) => matchesConditionName(ct.condition, rule));
        const matchedByDiagnosis = rule.diagnosisKeywords.some((kw) => diagLower.includes(kw));
        if (aiCondition || matchedByDiagnosis) presentConditions.add(rule.key);
      }
      for (const ct of conditionTests) {
        if (!conditionRules.some((r) => matchesConditionName(ct.condition, r))) {
          const key = (ct.condition || ct.matchedDiagnosis || "").toLowerCase().trim();
          if (key) presentConditions.add(key);
        }
      }
      if (presentConditions.size === 0) {
        presentConditions.add(diagLower.split(",")[0].trim() || "cataract");
      }

      // ── Auto-generate 7 levels ────────────────────────────────────────────────
      // Strategy 1: if aiCode1 is available, use hierarchy endpoint
      // Strategy 2: use diagnosis text with diagnosis endpoint
      let slots: Array<{ code: string; description: string; level: number } | null> = Array(7).fill(null);

      try {
        let hierarchyUrl: string;
        if (aiCode1) {
          hierarchyUrl = `/api/icd?hierarchy=${encodeURIComponent(aiCode1)}`;
        } else {
          hierarchyUrl = `/api/icd?diagnosis=${encodeURIComponent(diagnosisText)}`;
        }
        const res = await fetch(hierarchyUrl);
        if (res.ok) {
          const data = await res.json() as { slots: typeof slots };
          slots = data.slots ?? Array(7).fill(null);
        }
      } catch { /* use empty slots */ }

      // ── Build icdDescriptions from slots ─────────────────────────────────────
      const newDescMap = new Map<string, string>();
      slots.forEach((slot) => { if (slot) newDescMap.set(slot.code, slot.description); });
      setIcdDescriptions(newDescMap);

      // ── Seed icdCodeMap for conditionRows (Code-1 per condition key) ──────────
      const newIcdCodeMap = new Map<string, string>();
      const code1 = slots[0]?.code || aiCode1 || null;
      // Seed all condition keys AND the global key
      const allKeys = new Set([...Array.from(presentConditions), "__icd__"]);
      if (code1) allKeys.forEach((k) => newIcdCodeMap.set(k, code1));
      if (newIcdCodeMap.size === 0) {
        const fallback = aiCode1 || fallbackCataractIcd || (await fetchICDCode(diagLower.split(",")[0].trim()));
        if (fallback) allKeys.forEach((k) => newIcdCodeMap.set(k, fallback || ""));
      }
      setIcdCodeMap(newIcdCodeMap);

      // ── Seed all 7 level maps (keyed by condition key AND "__icd__") ──────────
      const newLevels = slots.map((slot) => {
        const m = new Map<string, string>();
        if (slot) allKeys.forEach((k) => m.set(k, slot.code));
        return m;
      });
      setIcdLevels(newLevels);

      // Notify parent of last populated ICD code from auto-population
      if (onLastIcdCodeChange) {
        let lastAutoCode = "";
        for (let lvl = 6; lvl >= 0; lvl--) {
          if (slots[lvl]?.code) { lastAutoCode = slots[lvl]!.code; break; }
        }
        if (lastAutoCode) onLastIcdCodeChange(lastAutoCode);
      }

      // ── Build options map for search fallback ─────────────────────────────────
      const newOptionsMap = new Map<string, IcdOption[]>();
      await Promise.all(
        Array.from(presentConditions).map(async (conditionKey) => {
          const rule = conditionRules.find((r) => r.key === conditionKey);
          const opts = conditionKey === "cataract"
            ? [...cataractICDCodes]
            : await fetchICDOptions(rule?.label || conditionKey);
          newOptionsMap.set(conditionKey, opts.length ? opts : [...cataractICDCodes]);
        })
      );
      setIcdOptionsMap(newOptionsMap);
    };

    fetchICDCodes();
  }, [medicalAdmissibility]);

  const conditionTests = medicalAdmissibility
    ? ((medicalAdmissibility as { conditionTests?: ConditionTestCheck[] }).conditionTests || [])
    : [];

  const conditionRows = medicalAdmissibility
    ? [
        ...buildConditionRows(
          (medicalAdmissibility.diagnosis || "").toLowerCase(),
          conditionTests,
          icdCodeMap,
        ),
        ...buildDynamicConditionRows(conditionTests, icdCodeMap),
      ]
    : [];

  // Handle ICD code selection for cataract
  const handleICDLevelChange = (level: number, conditionKey: string, code: string, desc: string) => {
    setIcdLevels((prev) => {
      const next = prev.map((m) => new Map(m));
      next[level].set(conditionKey, code);

      // Find last populated code across all levels and all condition keys
      let lastCode = "";
      for (let lvl = 6; lvl >= 0; lvl--) {
        for (const val of next[lvl].values()) {
          if (val) { lastCode = val; break; }
        }
        if (lastCode) break;
      }
      // Also check newly entered code
      if (code && level >= (lastCode ? 0 : 0)) {
        // Walk from highest level down to find actual last
        let found = "";
        for (let lvl = 6; lvl >= 0; lvl--) {
          const map = lvl === level
            ? (() => { const m = new Map(next[lvl]); m.set(conditionKey, code); return m; })()
            : next[lvl];
          for (const val of map.values()) { if (val) { found = val; break; } }
          if (found) break;
        }
        if (found) lastCode = found;
      }
      if (onLastIcdCodeChange) onLastIcdCodeChange(lastCode);
      return next;
    });
    if (code && desc) {
      setIcdDescriptions((prev) => { const m = new Map(prev); m.set(code, desc); return m; });
    }
  };

  const getICDLevel = (level: number, conditionKey: string, fallback?: string) =>
    icdLevels[level]?.get(conditionKey) || fallback || "";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Medical Admissibility Check</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!medicalAdmissibility ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed bg-muted/40 text-sm text-muted-foreground">
            No medical admissibility data available for this file.
          </div>
        ) : (
          <div className="space-y-4">
              {/* Diagnosis + Supporting Report 2-column table — replaces plain Diagnosis text */}
              {(medicalAdmissibility.diagnosis || conditionRows.length > 0) && (
                <div className="space-y-2">
                  <div className="rounded-md border bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          <TableHead className="font-semibold text-gray-700 w-1/2">Diagnosis</TableHead>
                          <TableHead className="font-semibold text-gray-700 w-1/2">Supporting Report</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {conditionRows.length > 0 ? (
                          conditionRows.map((row, idx) => (
                            <TableRow key={`diag-row-${idx}`}>
                              <TableCell className="align-top w-1/2">
                                <input
                                  type="text"
                                  defaultValue={`${row.condition}${row.matchedDiagnosis ? ` (${row.matchedDiagnosis})` : ""}`}
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm text-gray-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </TableCell>
                              <TableCell
                                className="align-top w-1/2 cursor-pointer"
                                onClick={() => onScrollToPage && row.pageNumber && onScrollToPage(row.pageNumber)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-gray-700">{row.test}</span>
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                    row.reported === "Yes" ? "bg-green-100 text-green-800" : "bg-red-50 text-red-700"
                                  }`}>
                                    {row.reported === "Yes" ? "Available" : "Missing"}
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={2} className="text-sm text-gray-700 p-3">
                              {medicalAdmissibility.diagnosis}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              {medicalAdmissibility.doctorNotes && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-700">
                    Doctor Notes From Hospital
                  </div>
                  <div
                    className={`text-sm text-gray-900 bg-gray-50 rounded-md p-3 border whitespace-pre-wrap ${
                      onScrollToPage &&
                      medicalAdmissibility.doctorNotesPageNumber
                        ? "cursor-pointer hover:bg-gray-100 transition-colors"
                        : ""
                    }`}
                    onClick={() => {
                      if (
                        onScrollToPage &&
                        medicalAdmissibility.doctorNotesPageNumber
                      ) {
                        onScrollToPage(
                          medicalAdmissibility.doctorNotesPageNumber
                        );
                      }
                    }}
                  >
                    {medicalAdmissibility.doctorNotes}
                  </div>
                </div>
              )}
              {/* Presenting Complaint — moved here from result-view bottom */}
              {(presentingComplaint !== undefined) && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-700">Presenting Complaint</div>
                  <textarea
                    value={presentingComplaint ?? ""}
                    onChange={(e) => onPresentingComplaintChange?.(e.target.value)}
                    placeholder="Enter presenting complaint..."
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 resize-none"
                  />
                </div>
              )}

              {conditionRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-gray-700">
                    Medical Coding
                  </div>
                  <div className="rounded-md border bg-white overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50">
                          {Array.from({ length: 7 }, (_, i) => (
                            <TableHead key={i} className="min-w-[140px] font-semibold text-gray-700">{`ICD Code-${i + 1}`}</TableHead>
                          ))}
                          <TableHead className="font-semibold text-gray-700">Description</TableHead>
                          <TableHead className="font-semibold text-gray-700">Reported</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {/* Deduplicate by conditionKey — one ICD row per unique condition */}
                        {conditionRows
                          .filter((row, idx, arr) =>
                            arr.findIndex((r) => r.conditionKey === row.conditionKey) === idx
                          )
                          .map((row, idx) => (
                          <TableRow key={`icd-row-${idx}`} className={onScrollToPage && row.pageNumber ? "cursor-pointer hover:bg-gray-50" : ""}>
                            {Array.from({ length: 7 }, (_, i) => (
                              <TableCell key={i} className="align-top p-1">
                                <IcdCombobox
                                  value={getICDLevel(i, row.conditionKey!, i === 0 ? row.icdCode : undefined)}
                                  onChange={(code, desc) => handleICDLevelChange(i, row.conditionKey!, code, desc)}
                                  placeholder={`L${i + 1} code`}
                                />
                              </TableCell>
                            ))}
                            <TableCell className="align-top text-xs text-gray-600">
                              {(() => {
                                for (let lvl = 6; lvl >= 0; lvl--) {
                                  const code = getICDLevel(lvl, row.conditionKey!);
                                  if (code) return icdDescriptions.get(code) || code;
                                }
                                return "-";
                              })()}
                            </TableCell>
                            <TableCell className="align-top" onClick={() => onScrollToPage && row.pageNumber && onScrollToPage(row.pageNumber)}>
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                row.reported === "Yes" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                              }`}>
                                {row.reported}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
              {!medicalAdmissibility.diagnosis &&
                !medicalAdmissibility.doctorNotes &&
                conditionRows.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    No diagnosis or doctor notes available.
                  </div>
                )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
