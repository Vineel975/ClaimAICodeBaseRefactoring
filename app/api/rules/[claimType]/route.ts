/**
 * GET /api/rules/[claimType]
 *
 * Exposes the disease-rules registry as JSON for external consumers
 * (notably the Spectra ASP.NET MVC application, which calls this from
 * both browser JavaScript and server-side C#).
 *
 * Phase 6 of the disease-rules refactor — eliminates duplication where
 * Spectra previously had its own hardcoded copies of:
 *   - The maternityRules JavaScript array in Index.cshtml
 *   - The BillingType_P51 = 201 hardcode in MedicalScrutinyController.cs
 *
 * Both consumers now fetch from this endpoint and get the values from
 * lib/rules/<disease>.ts — the single source of truth.
 *
 * Path:    /api/rules/cataract  → returns CataractRules JSON
 *          /api/rules/maternity → returns MaternityRules JSON
 *          /api/rules/anything-else → returns 'other' fallback JSON
 *
 * CORS:    Enabled. Spectra browser JS calls this directly.
 *
 * Caching: 5-minute Cache-Control so Spectra browsers and C# clients
 *          don't hammer the endpoint. The rules folder rarely changes —
 *          when it does, redeploying ClaimAI invalidates the cache anyway.
 *
 * Output:  A serializable JSON view of DiseaseRules. Functions
 *          (admissibility rule evaluate() methods) are NOT included —
 *          they cannot cross the network boundary. Spectra evaluates
 *          inadmissibility differently (via the existing extract.ts flow);
 *          this endpoint provides only the data Spectra needs: TPA
 *          mappings, coding-row defaults, UI flags, and labels.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRules, coerceClaimType, getAllClaimTypes } from "@/lib/rules";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age":       "86400",  // Cache preflight for 24 hours — matches pattern in classify-claim-type/route.ts
} as const;

// Cache for 5 minutes at the edge + browser. Refresh after redeploy.
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=300",
} as const;

export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ claimType: string }> },
): Promise<NextResponse> {
  const { claimType: raw } = await params;
  const claimType = coerceClaimType(raw);
  const rules = getRules(claimType);

  // Serializable view — strip out evaluate() functions which cannot
  // cross the network boundary. Spectra does not need them: it relies
  // on extract.ts for admissibility, and on this endpoint only for
  // TPA mappings, coding-row defaults, UI flags, and labels.
  const payload = {
    type:  rules.type,
    label: rules.label,

    classification: {
      priority: rules.classification.priority,
      keywords: rules.classification.keywords,
    },

    tpaProcedures: {
      catchAllTpaId: rules.tpaProcedures.catchAllTpaId,
      rules: rules.tpaProcedures.rules.map((r) => ({
        keywords:          r.keywords,
        excludeKeywords:   r.excludeKeywords ?? [],
        targetLevel3Left:  r.targetLevel3Left,
        targetLevel3Right: r.targetLevel3Right,
        priority:          r.priority,
        fallbackTpaId:     r.fallbackTpaId ?? null,
      })),
    },

    codingRow: {
      billingType:       rules.codingRow.billingType,
      treatmentType:     rules.codingRow.treatmentType,
      packageRatio:      rules.codingRow.packageRatio,
      defaultFacilityId: rules.codingRow.defaultFacilityId,
      packageRateNull:   rules.codingRow.packageRateNull,
      customColumns:     rules.codingRow.customColumns ?? null,
    },

    ui: {
      showInadmissibilityFlags: rules.ui.showInadmissibilityFlags,
      showGPLA:                 rules.ui.showGPLA,
      filterAilmentCappings:    rules.ui.filterAilmentCappings,
      showEyeFields:            rules.ui.showEyeFields,
    },

    // Note: admissibilityRules omitted — evaluate() functions cannot serialize.
    // Note: prompts omitted — only used server-side by AI extraction.

    _meta: {
      requestedType: raw,
      resolvedType:  claimType,
      registry:      getAllClaimTypes(),
      generatedAt:   new Date().toISOString(),
    },
  };

  return NextResponse.json(payload, {
    status:  200,
    headers: { ...CORS_HEADERS, ...CACHE_HEADERS },
  });
}
