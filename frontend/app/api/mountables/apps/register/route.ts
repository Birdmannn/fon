import { NextResponse } from "next/server";

import {
  hashMountableSecret,
  normalizeMountableAppId,
  normalizeMountableAppPrinciples,
  normalizeMountableAppSyncMode,
  normalizeMountableJsonObject,
  normalizeMountablePositiveInteger,
  normalizeMountableUrl,
  type RegisterMountableAppRequest,
} from "@/lib/fonMountablesSdk";
import { createMountableRegistrationSecret } from "@/lib/mountableAppRuntime";
import { getMountableAppsCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type RegisterMountableAppPayload = RegisterMountableAppRequest;

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

  const logoUrl = normalizeMountableUrl(typeof payload.logoUrl === "string" ? payload.logoUrl : "");
  if (!logoUrl) {
    throw new Error("logoUrl must be a valid http(s) URL");
  }

  const principles = normalizeMountableAppPrinciples(payload.principles);
  if (principles.length === 0) {
    throw new Error("principles must include at least one principle definition");
  }

  const syncMode = normalizeMountableAppSyncMode(payload.syncMode);
  const activityWebhookUrl = normalizeMountableUrl(typeof payload.activityWebhookUrl === "string" ? payload.activityWebhookUrl : "");
  const pollUpdatesUrl = normalizeMountableUrl(typeof payload.pollUpdatesUrl === "string" ? payload.pollUpdatesUrl : "");
  const pollIntervalSeconds = normalizeMountablePositiveInteger(payload.pollIntervalSeconds);

  if (!activityWebhookUrl) {
    throw new Error("activityWebhookUrl must be a valid http(s) URL");
  }

  if ((syncMode === "poll" || syncMode === "both") && !pollUpdatesUrl) {
    throw new Error("pollUpdatesUrl must be a valid http(s) URL when polling is enabled");
  }

  return {
    appId,
    appName,
    description: typeof payload.description === "string" ? payload.description.trim() : "",
    sdkVersion: typeof payload.sdkVersion === "string" ? payload.sdkVersion.trim() : "",
    appUrl: normalizeMountableUrl(typeof payload.appUrl === "string" ? payload.appUrl : ""),
    logoUrl,
    iconUrl: normalizeMountableUrl(typeof payload.iconUrl === "string" ? payload.iconUrl : ""),
    verifyInstallUrl,
    activityWebhookUrl,
    pollUpdatesUrl,
    syncMode,
    pollIntervalSeconds,
    supportsTimestampQuery: payload.supportsTimestampQuery === true,
    principles,
    configSchema: normalizeMountableJsonObject(payload.configSchema),
    configDefaults: normalizeMountableJsonObject(payload.configDefaults),
    rotateRegistrationSecret: payload.rotateRegistrationSecret === true,
  };
}

export async function POST(request: Request) {
  try {
    const payload = normalizePayload((await request.json()) as RegisterMountableAppPayload);
    const collection = await getMountableAppsCollection();
    const now = new Date();
    const existing = await collection.findOne(
      { appId: payload.appId },
      { projection: { _id: 0, registrationSecret: 1, registrationSecretHash: 1, registrationSecretIssuedAt: 1 } },
    ) as { registrationSecret?: unknown; registrationSecretHash?: unknown; registrationSecretIssuedAt?: unknown } | null;

    const suppliedSecret = request.headers.get("x-fon-registration-secret")?.trim()
      || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
      || "";
    if (existing) {
      const suppliedHash = suppliedSecret ? await hashMountableSecret(suppliedSecret) : "";
      const storedHash = typeof existing.registrationSecretHash === "string" ? existing.registrationSecretHash.trim() : "";
      const legacySecret = typeof existing.registrationSecret === "string" ? existing.registrationSecret.trim() : "";
      const authenticated = Boolean(suppliedSecret) && (storedHash ? suppliedHash === storedHash : suppliedSecret === legacySecret);
      if (!authenticated) {
        return badRequest("This appId is already registered; provide its registration secret to update the manifest", 401);
      }
    }

    const registrationSecret = payload.rotateRegistrationSecret || typeof existing?.registrationSecret !== "string" || !existing.registrationSecret.trim()
      ? createMountableRegistrationSecret()
      : existing.registrationSecret.trim();
    const registrationSecretIssuedAt = payload.rotateRegistrationSecret || typeof existing?.registrationSecretIssuedAt !== "string"
      ? now.toISOString()
      : existing.registrationSecretIssuedAt;
    const registrationSecretHash = await hashMountableSecret(registrationSecret);

    await collection.updateOne(
      { appId: payload.appId },
      {
        $set: {
          appId: payload.appId,
          appName: payload.appName,
          description: payload.description,
          sdkVersion: payload.sdkVersion,
          appUrl: payload.appUrl,
          logoUrl: payload.logoUrl,
          iconUrl: payload.iconUrl,
          verifyInstallUrl: payload.verifyInstallUrl,
          activityWebhookUrl: payload.activityWebhookUrl,
          pollUpdatesUrl: payload.pollUpdatesUrl,
          syncMode: payload.syncMode,
          pollIntervalSeconds: payload.pollIntervalSeconds,
          supportsTimestampQuery: payload.supportsTimestampQuery,
          principles: payload.principles,
          configSchema: payload.configSchema,
          configDefaults: payload.configDefaults,
          registrationSecret,
          registrationSecretHash,
          registrationSecretIssuedAt,
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
      registrationSecret,
      logoUrl: payload.logoUrl,
      activityWebhookUrl: payload.activityWebhookUrl,
      pollUpdatesUrl: payload.pollUpdatesUrl,
      syncMode: payload.syncMode,
      pollIntervalSeconds: payload.pollIntervalSeconds,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to register mountable app";
    return badRequest(message);
  }
}
