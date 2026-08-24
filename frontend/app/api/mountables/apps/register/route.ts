import { NextResponse } from "next/server";

import {
  normalizeMountableAppId,
  normalizeMountableAppPrinciples,
  normalizeMountableJsonObject,
  normalizeMountableUrl,
} from "@/lib/fonMountablesSdk";
import { getMountableAppsCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type RegisterMountableAppPayload = {
  appId?: unknown;
  appName?: unknown;
  description?: unknown;
  sdkVersion?: unknown;
  appUrl?: unknown;
  iconUrl?: unknown;
  verifyInstallUrl?: unknown;
  supportsTimestampQuery?: unknown;
  principles?: unknown;
  configSchema?: unknown;
  configDefaults?: unknown;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizePayload(payload: RegisterMountableAppPayload) {
  const appId = normalizeMountableAppId(typeof payload.appId === "string" ? payload.appId : "");
  if (!appId) {
    throw new Error("appId is required");
  }

  const appName = typeof payload.appName === "string" ? payload.appName.trim() : "";
  if (!appName) {
    throw new Error("appName is required");
  }

  const verifyInstallUrl = normalizeMountableUrl(typeof payload.verifyInstallUrl === "string" ? payload.verifyInstallUrl : "");
  if (!verifyInstallUrl) {
    throw new Error("verifyInstallUrl must be a valid http(s) URL");
  }

  const principles = normalizeMountableAppPrinciples(payload.principles);
  if (principles.length === 0) {
    throw new Error("principles must include at least one principle definition");
  }

  return {
    appId,
    appName,
    description: typeof payload.description === "string" ? payload.description.trim() : "",
    sdkVersion: typeof payload.sdkVersion === "string" ? payload.sdkVersion.trim() : "",
    appUrl: normalizeMountableUrl(typeof payload.appUrl === "string" ? payload.appUrl : ""),
    iconUrl: normalizeMountableUrl(typeof payload.iconUrl === "string" ? payload.iconUrl : ""),
    verifyInstallUrl,
    supportsTimestampQuery: payload.supportsTimestampQuery === true,
    principles,
    configSchema: normalizeMountableJsonObject(payload.configSchema),
    configDefaults: normalizeMountableJsonObject(payload.configDefaults),
  };
}

export async function POST(request: Request) {
  try {
    const payload = normalizePayload((await request.json()) as RegisterMountableAppPayload);
    const collection = await getMountableAppsCollection();
    const now = new Date();

    await collection.updateOne(
      { appId: payload.appId },
      {
        $set: {
          ...payload,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      ok: true,
      appId: payload.appId,
      appName: payload.appName,
      principles: payload.principles,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to register mountable app";
    return badRequest(message);
  }
}
