import { NextResponse } from "next/server";

import { pollMountedApps } from "@/lib/mountableAppRuntime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const expected = process.env.FON_POLL_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  return supplied === expected;
}

async function run(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized poll worker request" }, { status: 401 });
  }
  const results = await pollMountedApps();
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
