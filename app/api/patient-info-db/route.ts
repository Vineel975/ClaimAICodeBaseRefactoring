import { NextResponse } from "next/server";
import { getPatientInfoDbByClaimId } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { claimId?: string };
    const claimId = body?.claimId?.trim();

    if (!claimId) {
      return NextResponse.json({ error: "claimId is required" }, { status: 400 });
    }

    const snapshot = await getPatientInfoDbByClaimId(claimId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch patient DB data",
      },
      { status: 500 },
    );
  }
}
