import { NextResponse } from "next/server";

import { registerWithFon } from "@/lib/fonSdk";

import { buildManifest, getRegistrationSecret, setRegistrationSecret } from "@/lib/checkboxDemoApp";

function resolveAppOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    const fonBaseUrl = process.env.FON_BASE_URL?.trim();
    if (!fonBaseUrl) {
      return NextResponse.json({ error: "Set FON_BASE_URL before registering the demo app." }, { status: 400 });
    }

    const result = await registerWithFon(
      fonBaseUrl,
      buildManifest(resolveAppOrigin(request)),
      getRegistrationSecret(),
    );
    setRegistrationSecret(result.registrationSecret);
    return NextResponse.json({
      ok: true,
      result: {
        appId: result.appId,
        appName: result.appName,
        logoUrl: result.logoUrl,
        principles: result.principles,
        syncMode: result.syncMode,
        pollIntervalSeconds: result.pollIntervalSeconds,
      },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to register checkbox demo with FON";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
