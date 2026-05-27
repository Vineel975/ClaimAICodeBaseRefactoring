/**
 * GET /api/rules
 *
 * Returns ALL registered disease rules in a single response.
 * Spectra's Index.cshtml uses this at page load to populate JS variables
 * for all claim types at once — avoids N separate fetches.
 *
 * Phase 6 of the disease-rules refactor.
 *
 * Output shape:
 *   {
 *     cataract:  { ...rules... },
 *     maternity: { ...rules... },
 *     other:     { ...rules... },
 *     // any future diseases will appear here automatically
 *     _meta: {
 *       registry: ["cataract", "maternity", "other"],
 *       generatedAt: "2026-..."
 *     }
 *   }
 *
 * Same caching strategy as /api/rules/[claimType]: 5 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRules, getAllClaimTypes } from "@/lib/rules";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age":       "86400",  // Cache preflight for 24 hours — matches pattern in classify-claim-type/route.ts
} as const;

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=300",
} as const;

export const dynamic = "force-dynamic";

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const allTypes = getAllClaimTypes();

  const payload: Record<string, unknown> = {};

  for (const claimType of allTypes) {
    const rules = getRules(claimType);
    payload[claimType] = {
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
    };
  }

  payload._meta = {
    registry:    allTypes,
    count:       allTypes.length,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(payload, {
    status:  200,
    headers: { ...CORS_HEADERS, ...CACHE_HEADERS },
  });
}
