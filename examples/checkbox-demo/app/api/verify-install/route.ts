import { NextResponse } from "next/server";

import { buildManifest, defaultSelectedPrinciples, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => ({}));
    const installToken = typeof payload.installToken === "string" ? payload.installToken.trim() : "";
    if (!installToken) {
      return NextResponse.json({ error: "installToken is required" }, { status: 400 });
    }

    const origin = process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
    const selectedPrinciples = parseSelectedPrinciples(payload.selectedPrinciples);
    const manifest = buildManifest(origin);

    return NextResponse.json({
      installationId: `checkbox-demo-${installToken.slice(-8) || crypto.randomUUID()}`,
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
      sharedSecret: installToken,
      adminNotice: "Demo install verified. Checkbox state is stored in memory while the dev server runs.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify install";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
