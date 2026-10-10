import { NextResponse } from "next/server";

import { clearFlowLogs, listFlowLogs } from "@/lib/flowLogs";

export async function GET() {
  return NextResponse.json({ logs: await listFlowLogs() });
}

export async function DELETE() {
  await clearFlowLogs();
  return NextResponse.json({ ok: true });
}
