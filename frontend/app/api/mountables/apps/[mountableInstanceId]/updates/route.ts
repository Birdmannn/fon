import { NextResponse } from "next/server";

import type { MountedAppUpdatePayload } from "@/lib/fonMountablesSdk";
import { ingestMountedAppUpdate, MountableAppRuntimeError } from "@/lib/mountableAppRuntime";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/mountables/apps/[mountableInstanceId]/updates">) {
  try {
    const { mountableInstanceId } = await context.params;
    const installationSecret = request.headers.get("x-fon-installation-secret")?.trim()
      || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
      || "";
    const result = await ingestMountedAppUpdate({
      mountableInstanceId,
      payload: await request.json() as MountedAppUpdatePayload,
      installationSecret,
      source: "app-update-ingest",
    });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const status = error instanceof MountableAppRuntimeError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Failed to ingest mountable app update";
    return NextResponse.json({ error: message }, { status });
  }
}
