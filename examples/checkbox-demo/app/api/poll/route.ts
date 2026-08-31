import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    updates: [],
    polledAt: new Date().toISOString(),
    adminNotice: "Checkbox demo uses direct evaluation for the browser flow; no queued updates are pending.",
  });
}

export async function POST() {
  return GET();
}
