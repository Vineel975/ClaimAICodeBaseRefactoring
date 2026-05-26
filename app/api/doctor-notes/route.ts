import { NextResponse } from "next/server";
import { getDoctorNotes } from "@/lib/db";

/**
 * GET /api/doctor-notes?claimId=xxx
 * Returns DoctorNotes from Claimsdetails for a given ClaimID.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const claimId = searchParams.get("claimId")?.trim();
  if (!claimId) return NextResponse.json({ doctorNotes: null });
  try {
    const doctorNotes = await getDoctorNotes(claimId);
    return NextResponse.json({ doctorNotes });
  } catch (err) {
    console.error("[doctor-notes]", err);
    return NextResponse.json({ doctorNotes: null });
  }
}