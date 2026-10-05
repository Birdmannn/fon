import { NextResponse } from "next/server";

import { appId, buildManifest, defaultSelectedPrinciples, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const origin = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
    const selectedPrinciples = parseSelectedPrinciples(payload.selectedPrinciples);
    const manifest = buildManifest(origin);
    const installationId = `checkbox-demo-${crypto.randomUUID()}`;

    return NextResponse.json({
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify install";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
