import { NextResponse } from "next/server";

import { appId, buildManifest, defaultSelectedPrinciples, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";
import { appendFlowLog } from "@/lib/flowLogs";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const origin = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
    const selectedPrinciples = parseSelectedPrinciples(payload.selectedPrinciples);
    await appendFlowLog({ kind: "request", direction: "inbound", method: "POST", source: "FON", target: "/api/verify-install", summary: "Received mount configuration verification", request: payload });
    const manifest = buildManifest(origin);
    const installationId = `checkbox-demo-${crypto.randomUUID()}`;

    const responsePayload = {
      installationId,
      installationLabel: "Checkbox Demo Install",
      appUrl: manifest.appUrl,
      iconUrl: manifest.iconUrl,
      description: manifest.description,
      supportsTimestampQuery: manifest.supportsTimestampQuery,
      principles: manifest.principles,
      selectedPrinciples: selectedPrinciples.length ? selectedPrinciples : defaultSelectedPrinciples(),
      config: {
        allowSelfReportedCheckboxes: true,
      },
      adminNotice: "Demo mount configuration verified. The event grant will arrive through the registered activity webhook after the freight is published.",
    };
    await appendFlowLog({ kind: "response", direction: "outbound", method: "POST", source: "/api/verify-install", target: "FON", status: 200, summary: "Mount configuration verified", response: responsePayload });
    return NextResponse.json(responsePayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify install";
    await appendFlowLog({ kind: "response", direction: "outbound", method: "POST", source: "/api/verify-install", target: "FON", status: 400, summary: message, response: { error: message } });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
