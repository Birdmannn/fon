import { NextResponse } from "next/server";
import type { CredentialKeyType, SigningAlg } from "@joyid/ckb";

import { appendFlowLog } from "@/lib/flowLogs";
import { createJoyIdSession, deleteJoyIdSession, getJoyIdSession, JOYID_SESSION_COOKIE } from "@/lib/joyidSession";

export async function GET(request: Request) {
  const session = await getJoyIdSession(request);
  return NextResponse.json({ authenticated: Boolean(session), address: session?.address ?? null });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as {
    address?: unknown;
    challengeId?: unknown;
    challenge?: unknown;
    pubkey?: unknown;
    keyType?: unknown;
    alg?: unknown;
    message?: unknown;
    signature?: unknown;
  } | null;
  try {
    const result = await createJoyIdSession({
      challengeId: typeof payload?.challengeId === "string" ? payload.challengeId : "",
      challenge: typeof payload?.challenge === "string" ? payload.challenge : "",
      address: typeof payload?.address === "string" ? payload.address : "",
      pubkey: typeof payload?.pubkey === "string" ? payload.pubkey : "",
      keyType: payload?.keyType as CredentialKeyType,
      alg: payload?.alg as SigningAlg,
      message: typeof payload?.message === "string" ? payload.message : "",
      signature: typeof payload?.signature === "string" ? payload.signature : "",
    });
    const response = NextResponse.json({ authenticated: true, address: result.address });
    response.cookies.set(JOYID_SESSION_COOKIE, result.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    await appendFlowLog({
      kind: "auth",
      direction: "inbound",
      method: "POST",
      source: "JoyID",
      target: "/api/auth/joyid",
      status: 200,
      summary: `JoyID wallet connected: ${result.address}`,
      request: payload,
      response: { authenticated: true, address: result.address },
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "JoyID login failed";
    await appendFlowLog({ kind: "auth", direction: "inbound", method: "POST", source: "JoyID", target: "/api/auth/joyid", status: 401, summary: message, request: payload, response: { error: message } });
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(request: Request) {
  const address = (await getJoyIdSession(request))?.address ?? null;
  await deleteJoyIdSession(request);
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(JOYID_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  await appendFlowLog({ kind: "auth", direction: "internal", method: "DELETE", source: address ?? "browser", target: "/api/auth/joyid", status: 200, summary: "JoyID wallet disconnected" });
  return response;
}
