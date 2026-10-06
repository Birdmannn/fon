import { NextResponse } from "next/server";

import { buildManifest } from "@/lib/checkboxDemoApp";
import { appendFlowLog } from "@/lib/flowLogs";

function resolveOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
}

export async function GET(request: Request) {
  const manifest = buildManifest(resolveOrigin(request));
  appendFlowLog({ kind: "response", direction: "outbound", method: "GET", source: "/api/manifest", target: "FON/client", status: 200, summary: "Returned app manifest", response: manifest });
  return NextResponse.json(manifest);
}
