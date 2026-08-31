import { NextResponse } from "next/server";

import {
  normalizeMountableAppId,
  normalizeMountableAppPrinciples,
  normalizeMountableAppSyncMode,
  normalizeMountableJsonObject,
  normalizeMountablePositiveInteger,
  normalizeMountableUrl,
} from "@/lib/fonMountablesSdk";
import { getMountableAppsCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function sanitizeManifest(value: Record<string, unknown>) {
  return {
    appId: normalizeMountableAppId(typeof value.appId === "string" ? value.appId : ""),
    appName: typeof value.appName === "string" ? value.appName.trim() : "",
    description: typeof value.description === "string" ? value.description.trim() : "",
    sdkVersion: typeof value.sdkVersion === "string" ? value.sdkVersion.trim() : "",
    appUrl: normalizeMountableUrl(typeof value.appUrl === "string" ? value.appUrl : ""),
    iconUrl: normalizeMountableUrl(typeof value.iconUrl === "string" ? value.iconUrl : ""),
    verifyInstallUrl: normalizeMountableUrl(typeof value.verifyInstallUrl === "string" ? value.verifyInstallUrl : ""),
    activityWebhookUrl: normalizeMountableUrl(typeof value.activityWebhookUrl === "string" ? value.activityWebhookUrl : ""),
    pollUpdatesUrl: normalizeMountableUrl(typeof value.pollUpdatesUrl === "string" ? value.pollUpdatesUrl : ""),
    syncMode: normalizeMountableAppSyncMode(value.syncMode),
    pollIntervalSeconds: normalizeMountablePositiveInteger(value.pollIntervalSeconds),
    supportsTimestampQuery: value.supportsTimestampQuery === true,
    principles: normalizeMountableAppPrinciples(value.principles),
    configSchema: normalizeMountableJsonObject(value.configSchema),
    configDefaults: normalizeMountableJsonObject(value.configDefaults),
    registrationSecretIssuedAt: typeof value.registrationSecretIssuedAt === "string" ? value.registrationSecretIssuedAt : "",
    createdAt: value.createdAt instanceof Date ? value.createdAt.toISOString() : typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: value.updatedAt instanceof Date ? value.updatedAt.toISOString() : typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
}

export async function GET() {
  try {
    const collection = await getMountableAppsCollection();
    const manifests = await collection
      .find({}, {
        sort: { appName: 1, updatedAt: -1 },
        projection: {
          _id: 0,
          appId: 1,
          appName: 1,
          description: 1,
          sdkVersion: 1,
          appUrl: 1,
          iconUrl: 1,
          verifyInstallUrl: 1,
          activityWebhookUrl: 1,
          pollUpdatesUrl: 1,
          syncMode: 1,
          pollIntervalSeconds: 1,
          supportsTimestampQuery: 1,
          principles: 1,
          configSchema: 1,
          configDefaults: 1,
          registrationSecretIssuedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      })
      .toArray();

    return NextResponse.json({
      apps: manifests.map((entry) => sanitizeManifest(entry as Record<string, unknown>)).filter((entry) => entry.appId && entry.appName),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch mountable apps";
    return badRequest(message, 500);
  }
}
