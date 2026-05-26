import { NextResponse } from "next/server";
import { getBalanceSumInsured } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { claimId?: string };
    const claimId = body?.claimId?.trim();

    if (!claimId) {
      return NextResponse.json(
        { error: "claimId is required" },
        { status: 400 },
      );
    }

    const bsiData = await getBalanceSumInsured(claimId);

    if (!bsiData) {
      return NextResponse.json(
        { error: `BSI data not found for claim ${claimId}. Check DB connection and MemberSI records.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ bsiData });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch BSI data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
