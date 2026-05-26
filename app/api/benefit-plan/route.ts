import { NextRequest, NextResponse } from "next/server";
import { getBenefitPlanSnapshotByClaimId } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { claimId?: string };
    const claimId = body?.claimId?.trim();

    if (!claimId) {
      return NextResponse.json(
        { error: "claimId is required" },
        { status: 400 },
      );
    }

    const snapshot = await getBenefitPlanSnapshotByClaimId(claimId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch benefit plan data";
    return NextResponse.json(
      {
        error: message,
      },
      {
        status: message.includes("not found") ? 404 : 500,
      },
    );
  }
}
