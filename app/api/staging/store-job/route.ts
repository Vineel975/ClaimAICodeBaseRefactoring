import { NextRequest, NextResponse } from "next/server";

// Staging flow has been disabled — every claim now goes through the on-demand flow.
// This route is kept as a no-op stub so existing callers don't break.
// Build no longer references api.stagingMutations.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { success: false, message: "Staging disabled" },
    { status: 200, headers: corsHeaders() }
  );
}

export async function GET(_request: NextRequest) {
  return NextResponse.json(
    { success: false, message: "Staging disabled" },
    { status: 200, headers: corsHeaders() }
  );
}
