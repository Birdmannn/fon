import { NextResponse } from "next/server";

import { appendFlowLog } from "@/lib/flowLogs";
import { createJoyIdChallenge } from "@/lib/joyidSession";

export async function POST() {
  const challenge = await createJoyIdChallenge();
  await appendFlowLog({
    kind: "auth",
    direction: "outbound",
    method: "POST",
    source: "/api/auth/joyid/challenge",
    target: "browser",
    status: 200,
    summary: "Issued one-time JoyID login challenge",
    response: challenge,
  });
  return NextResponse.json(challenge);
}
