import { NextResponse } from "next/server";

import { clearFlowLogs, listFlowLogs } from "@/lib/flowLogs";

export async function GET() {
  return NextResponse.json({ logs: listFlowLogs() });
}

export async function DELETE() {
  clearFlowLogs();
  return NextResponse.json({ ok: true });
}
