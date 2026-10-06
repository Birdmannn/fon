import { NextResponse } from "next/server";

import { registerWithFon } from "@/lib/fonSdk";

import { buildManifest, getRegistrationSecret, setRegistrationSecret } from "@/lib/checkboxDemoApp";
import { appendFlowLog } from "@/lib/flowLogs";

function resolveAppOrigin(request: Request) {
  return process.env.NEXT_PUBLIC_APP_BASE_URL?.trim() || new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    const fonBaseUrl = process.env.FON_BASE_URL?.trim();
    if (!fonBaseUrl) {
      return NextResponse.json({ error: "Set FON_BASE_URL before registering the demo app." }, { status: 400 });
    }

    const manifest = buildManifest(resolveAppOrigin(request));
    appendFlowLog({ kind: "registration", direction: "outbound", method: "POST", source: "Checkbox Demo", target: `${fonBaseUrl}/api/mountables/apps/register`, summary: "Registering app manifest with FON", request: manifest });
    const result = await registerWithFon(
      fonBaseUrl,
      manifest,
      getRegistrationSecret(),
    );
    setRegistrationSecret(result.registrationSecret);
    const responsePayload = {
      ok: true,
      result: {
        appId: result.appId,
        appName: result.appName,
        logoUrl: result.logoUrl,
        principles: result.principles,
        syncMode: result.syncMode,
        pollIntervalSeconds: result.pollIntervalSeconds,
      },
    };
    appendFlowLog({ kind: "registration", direction: "inbound", method: "POST", source: "FON", target: "Checkbox Demo", status: 201, summary: `Registered ${result.appName}`, response: result });
    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to register checkbox demo with FON";
    appendFlowLog({ kind: "registration", direction: "inbound", method: "POST", source: "FON", target: "Checkbox Demo", status: 400, summary: message, response: { error: message } });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
