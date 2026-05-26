import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────
interface IcdEntry { c: string; n: string; l: number; }
interface IcdSlot  { code: string; description: string; level: number; }

// ── Master data (loaded once, cached in module scope) ─────────────────────────
let _list: IcdEntry[] | null = null;
let _map:  Map<string, IcdEntry> | null = null;
let _prefixChildren: Map<string, IcdEntry[]> | null = null;
let _ranges: IcdEntry[] | null = null;

function loadMaster() {
  if (_list && _map && _prefixChildren && _ranges) {
    return { list: _list, map: _map, prefixChildren: _prefixChildren, ranges: _ranges };
  }
  try {
    const raw = readFileSync(join(process.cwd(), "public", "icd-master.json"), "utf-8");
    _list = JSON.parse(raw) as IcdEntry[];
  } catch {
    _list = [];
  }
  _map = new Map(_list.map((e) => [e.c, e]));
  _ranges = _list.filter((e) => e.c.includes("-") && e.l <= 2);

  // Build prefix → children index (excludes range codes)
  _prefixChildren = new Map<string, IcdEntry[]>();
  for (const entry of _list) {
    if (entry.c.includes("-")) continue;
    for (let len = 1; len < entry.c.length; len++) {
      const prefix = entry.c.slice(0, len);
      if (!_prefixChildren.has(prefix)) _prefixChildren.set(prefix, []);
      _prefixChildren.get(prefix)!.push(entry);
    }
  }
  return { list: _list, map: _map, prefixChildren: _prefixChildren, ranges: _ranges };
}

// ── Laterality extraction ─────────────────────────────────────────────────────
function extractLaterality(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bbilateral\b/.test(t) || /\bboth eyes\b/.test(t)) return "bilateral";
  if (/\bright\b/.test(t)) return "right";
  if (/\bleft\b/.test(t))  return "left";
  return null;
}

function lateralityScore(name: string, lat: string | null): number {
  if (!lat) return 0;
  const n = name.toLowerCase();
  if (lat === "right"     && n.includes("right"))     return 15;
  if (lat === "left"      && n.includes("left"))      return 15;
  if (lat === "bilateral" && n.includes("bilateral")) return 15;
  if (n.includes("unspecified")) return -2;
  if (/right|left|bilateral/.test(n)) return -5; // wrong laterality
  return 0;
}

// ── Hierarchy builder ─────────────────────────────────────────────────────────
function buildHierarchy(
  specificCode: string,
  map: Map<string, IcdEntry>,
  ranges: IcdEntry[],
): Array<IcdSlot | null> {
  const entry = map.get(specificCode);
  if (!entry) return Array(7).fill(null);

  const slots: Array<IcdSlot | null> = Array(7).fill(null);
  const toSlot = (e: IcdEntry): IcdSlot => ({ code: e.c, description: e.n, level: e.l });

  // Place the specific code
  if (entry.l >= 1 && entry.l <= 7) slots[entry.l - 1] = toSlot(entry);

  // Walk up by shortening code
  let code = specificCode;
  while (code.length > 1) {
    if (code.includes(".")) {
      const dot = code.lastIndexOf(".");
      const after = code.slice(dot + 1);
      code = after.length > 1 ? code.slice(0, dot + 1) + after.slice(0, -1) : code.slice(0, dot);
    } else {
      code = code.slice(0, -1);
    }
    const parent = map.get(code);
    if (parent && parent.l >= 1 && parent.l <= 7 && !slots[parent.l - 1]) {
      slots[parent.l - 1] = toSlot(parent);
    }
  }

  // Fill L1 and L2 from range codes
  const prefix3 = specificCode.slice(0, 3);
  for (const lvl of [1, 2] as const) {
    if (slots[lvl - 1]) continue;
    const match = ranges
      .filter((r) => r.l === lvl)
      .find((r) => {
        const [s, e] = r.c.split("-");
        return s.slice(0, 3) <= prefix3 && prefix3 <= e.slice(0, 3);
      });
    if (match) slots[lvl - 1] = toSlot(match);
  }

  return slots;
}

// ── Refinement: find most specific child matching laterality ──────────────────
function refineToSpecific(
  baseCode: string,
  diagLower: string,
  laterality: string | null,
  prefixChildren: Map<string, IcdEntry[]>,
): IcdEntry | null {
  const { map } = loadMaster();
  let best: IcdEntry | null = map.get(baseCode) ?? null;
  let currentPrefix = baseCode;

  for (let step = 0; step < 6; step++) {
    const children = prefixChildren.get(currentPrefix) ?? [];
    if (!children.length) break;

    const scored = children.map((child) => {
      const name = child.n.toLowerCase();
      let score = child.l * 3;
      score += lateralityScore(name, laterality);
      if (name.includes("unspecified")) score -= 5;
      if (name.includes("other")) score -= 2;
      for (const word of diagLower.split(/\W+/)) {
        if (word.length > 3 && name.includes(word)) score += 3;
      }
      return { score, child };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0].child;
    if (!best || top.l > best.l) {
      best = top;
      currentPrefix = top.c;
    } else {
      break;
    }
  }

  return best;
}

// ── Clinical rule layer ───────────────────────────────────────────────────────
const RULES: Array<{ keywords: string[]; base: string; priority: number }> = [
  // Cataract
  { keywords: ["nuclear cataract", "nuclear sclerosis", "nuclear opacity"], base: "H25.1",  priority: 100 },
  { keywords: ["cortical cataract", "cortical age"],                         base: "H25.01", priority: 100 },
  { keywords: ["posterior subcapsular", "psc cataract"],                     base: "H25.04", priority: 100 },
  { keywords: ["anterior subcapsular"],                                       base: "H25.03", priority: 100 },
  { keywords: ["morgagnian", "hypermature cataract"],                         base: "H25.2",  priority: 100 },
  { keywords: ["combined cataract", "mature cataract"],                       base: "H25.81", priority: 90  },
  { keywords: ["senile cataract", "age-related cataract", "cataract senile"], base: "H25.1",  priority: 80  },
  { keywords: ["cataract"],                                                    base: "H26.9",  priority: 50  },
  // Eye
  { keywords: ["glaucoma, suspect", "glaucoma suspect"],                      base: "H40.0",  priority: 90  },
  { keywords: ["open-angle glaucoma", "open angle glaucoma"],                 base: "H40.1",  priority: 90  },
  { keywords: ["angle-closure glaucoma", "angle closure glaucoma"],           base: "H40.2",  priority: 90  },
  { keywords: ["glaucoma"],                                                    base: "H40.9",  priority: 60  },
  { keywords: ["retinal detachment"],                                          base: "H33.0",  priority: 90  },
  { keywords: ["vitreous hemorrhage"],                                         base: "H43.1",  priority: 90  },
  { keywords: ["diabetic retinopathy"],                                        base: "E11.3",  priority: 90  },
  { keywords: ["macular degeneration", "amd"],                                base: "H35.3",  priority: 90  },
  // Cardiovascular
  { keywords: ["essential hypertension", "primary hypertension"],             base: "I10",    priority: 100 },
  { keywords: ["hypertension"],                                                base: "I10",    priority: 70  },
  { keywords: ["myocardial infarction", "heart attack", "ami"],               base: "I21.9",  priority: 90  },
  { keywords: ["angina pectoris", "unstable angina"],                         base: "I20.0",  priority: 90  },
  { keywords: ["angina"],                                                      base: "I20.9",  priority: 70  },
  { keywords: ["heart failure"],                                               base: "I50.9",  priority: 80  },
  { keywords: ["atrial fibrillation"],                                         base: "I48.91", priority: 90  },
  { keywords: ["stroke", "cerebrovascular accident", "cva"],                  base: "I63.9",  priority: 90  },
  { keywords: ["deep vein thrombosis", "dvt"],                                base: "I82.4",  priority: 90  },
  // Digestive
  { keywords: ["appendicitis with abscess", "appendiceal abscess"],           base: "K35.2",  priority: 100 },
  { keywords: ["appendicitis with peritonitis"],                               base: "K35.2",  priority: 100 },
  { keywords: ["appendicitis"],                                                base: "K37",    priority: 80  },
  { keywords: ["acute cholecystitis with cholelithiasis"],                    base: "K80.0",  priority: 100 },
  { keywords: ["acute cholecystitis"],                                         base: "K81.0",  priority: 100 },
  { keywords: ["chronic cholecystitis"],                                       base: "K81.1",  priority: 100 },
  { keywords: ["cholecystitis"],                                               base: "K81.9",  priority: 80  },
  { keywords: ["cholelithiasis", "gallstone", "calculus of gallbladder"],     base: "K80.20", priority: 90  },
  { keywords: ["hernia with obstruction"],                                     base: "K41.3",  priority: 90  },
  { keywords: ["inguinal hernia"],                                             base: "K40.90", priority: 90  },
  { keywords: ["umbilical hernia"],                                            base: "K42.9",  priority: 90  },
  { keywords: ["hernia"],                                                      base: "K46.9",  priority: 60  },
  { keywords: ["gastroesophageal reflux", "gerd"],                            base: "K21.0",  priority: 90  },
  { keywords: ["peptic ulcer"],                                                base: "K27.9",  priority: 80  },
  // Endocrine
  { keywords: ["type 2 diabetes mellitus with cataract", "t2dm with cataract"], base: "E11.36", priority: 100 },
  { keywords: ["type 1 diabetes mellitus with cataract", "t1dm with cataract"], base: "E10.36", priority: 100 },
  { keywords: ["type 2 diabetes", "diabetes mellitus type 2", "t2dm"],       base: "E11.9",  priority: 90  },
  { keywords: ["type 1 diabetes", "diabetes mellitus type 1", "t1dm"],       base: "E10.9",  priority: 90  },
  { keywords: ["hypothyroidism"],                                              base: "E03.9",  priority: 80  },
  { keywords: ["hyperthyroidism"],                                             base: "E05.90", priority: 80  },
  // Respiratory
  { keywords: ["pneumonia"],                                                   base: "J18.9",  priority: 80  },
  { keywords: ["asthma"],                                                      base: "J45.909",priority: 80  },
  { keywords: ["copd", "chronic obstructive pulmonary"],                      base: "J44.9",  priority: 90  },
  { keywords: ["tuberculosis"],                                                base: "A15.9",  priority: 80  },
  // Musculoskeletal
  { keywords: ["fracture of femur"],                                           base: "S72.90", priority: 90  },
  { keywords: ["total knee replacement", "tka"],                              base: "Z96.651",priority: 90  },
  { keywords: ["total hip replacement", "tha"],                               base: "Z96.641",priority: 90  },
  { keywords: ["osteoarthritis of knee"],                                     base: "M17.9",  priority: 90  },
  { keywords: ["osteoarthritis of hip"],                                      base: "M16.9",  priority: 90  },
  { keywords: ["osteoarthritis"],                                              base: "M19.90", priority: 70  },
  { keywords: ["low back pain", "lumbar pain"],                               base: "M54.5",  priority: 90  },
  // Genitourinary
  { keywords: ["urinary tract infection", "uti"],                             base: "N39.0",  priority: 90  },
  { keywords: ["renal failure", "kidney failure"],                            base: "N19",    priority: 80  },
  { keywords: ["kidney stone", "renal calculus", "nephrolithiasis"],          base: "N20.0",  priority: 90  },
  { keywords: ["benign prostatic hyperplasia", "bph"],                        base: "N40.0",  priority: 90  },
  // Neoplasms
  { keywords: ["breast cancer", "carcinoma of breast"],                       base: "C50.91", priority: 90  },
  { keywords: ["lung cancer", "carcinoma of lung"],                           base: "C34.90", priority: 90  },
  { keywords: ["colorectal cancer", "colon cancer"],                          base: "C18.9",  priority: 90  },
  // Blood / Anemia
  { keywords: ["iron deficiency anemia"],                                     base: "D50.9",  priority: 90  },
  { keywords: ["anemia"],                                                      base: "D64.9",  priority: 70  },
];

function applyRules(diagLower: string): string | null {
  const matches: Array<[number, string]> = [];
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (diagLower.includes(kw)) {
        matches.push([rule.priority + kw.length * 2, rule.base]);
        break;
      }
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b[0] - a[0]);
  return matches[0][1];
}

// ── General text search fallback ──────────────────────────────────────────────
function textSearchFallback(diagLower: string, laterality: string | null, list: IcdEntry[]): IcdEntry | null {
  const words = diagLower.split(/\W+/).filter((w) => w.length > 3);
  const candidates = list.filter(
    (e) => !e.c.includes("-") && words.some((w) => e.n.toLowerCase().includes(w))
  );
  if (!candidates.length) return null;

  const scored = candidates.map((e) => {
    let score = e.l * 4;
    score += lateralityScore(e.n, laterality);
    if (e.n.toLowerCase().includes("unspecified")) score -= 5;
    for (const w of words) if (e.n.toLowerCase().includes(w)) score += 4;
    return { score, e };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].e;
}

// ── Main diagnosis coding function ────────────────────────────────────────────
function codeForDiagnosis(diagnosisText: string): Array<IcdSlot | null> {
  const { list, map, prefixChildren, ranges } = loadMaster();
  const diagLower = diagnosisText.toLowerCase();
  const laterality = extractLaterality(diagnosisText);

  // Step 1: Clinical rule matching
  const baseCode = applyRules(diagLower);

  let specificEntry: IcdEntry | null = null;
  if (baseCode && map.has(baseCode)) {
    // Step 2: Refine from base code using laterality and term matching
    specificEntry = refineToSpecific(baseCode, diagLower, laterality, prefixChildren);
  } else {
    // Step 3: General text search fallback
    specificEntry = textSearchFallback(diagLower, laterality, list);
  }

  if (!specificEntry) return Array(7).fill(null);

  // Step 4: Build full 7-level hierarchy
  return buildHierarchy(specificEntry.c, map, ranges);
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const { list, map, ranges } = loadMaster();

  const q          = (searchParams.get("q") ?? searchParams.get("condition") ?? "").trim().toLowerCase();
  const exactCode  = (searchParams.get("code") ?? "").trim();
  const hierarchy  = (searchParams.get("hierarchy") ?? "").trim();
  const diagnosis  = (searchParams.get("diagnosis") ?? "").trim();

  // Hierarchy for a known specific code
  if (hierarchy) {
    const slots = buildHierarchy(hierarchy, map, ranges);
    return NextResponse.json({ slots });
  }

  // Auto-code from diagnosis text → all 7 levels
  if (diagnosis) {
    const slots = codeForDiagnosis(diagnosis);
    return NextResponse.json({ slots });
  }

  // Exact code description lookup
  if (exactCode) {
    const match = map.get(exactCode);
    if (match) return NextResponse.json({ codes: [{ code: match.c, description: match.n, level: match.l }] });
    const prefix = list.filter((e) => e.c.toLowerCase().startsWith(exactCode.toLowerCase())).slice(0, 5);
    return NextResponse.json({ codes: prefix.map((e) => ({ code: e.c, description: e.n, level: e.l })) });
  }

  // Search (code prefix first, then name contains)
  if (!q) return NextResponse.json({ codes: [] });
  const qU = q.toUpperCase();
  const byCode = list.filter((e) => e.c.toUpperCase().startsWith(qU));
  const byName = list.filter((e) => !e.c.toUpperCase().startsWith(qU) && e.n.toLowerCase().includes(q));
  const results = [...byCode, ...byName].slice(0, 80);
  return NextResponse.json({ codes: results.map((e) => ({ code: e.c, description: e.n, level: e.l })) });
}