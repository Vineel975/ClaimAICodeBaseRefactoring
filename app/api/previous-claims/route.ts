import { NextResponse } from "next/server";
import { getPreviousClaims } from "@/lib/db";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const claimId        = searchParams.get("claimId")?.trim();
  const memberPolicyId = searchParams.get("memberPolicyId")?.trim();

  console.log("[previous-claims route] called claimId:", claimId, "memberPolicyId:", memberPolicyId);

  if (!claimId) {
    console.log("[previous-claims route] no claimId, returning empty");
    return NextResponse.json({ claims: [] });
  }

  try {
    const claims = await getPreviousClaims(claimId, memberPolicyId);
    console.log("[previous-claims route] returning", claims.length, "claims");
    return NextResponse.json({ claims });
  } catch (err) {
    console.error("[previous-claims route] error:", err);
    return NextResponse.json({ claims: [], error: String(err) });
  }
}