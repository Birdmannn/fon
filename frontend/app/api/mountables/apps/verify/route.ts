import { NextResponse } from "next/server";

import { maskInstallToken, hashMountableSecret, normalizeMountableAppId, normalizeMountableAppPrinciples, normalizeMountableAppPrincipleSelections, normalizeMountableJsonObject, normalizeMountableUrl, resolveSelectedMountableAppPrinciples, type VerifyMountableAppRequest, type VerifyMountableAppResult } from "@/lib/fonMountablesSdk";
import { deriveMountableWindow } from "@/lib/mountableTiming";
import { getMountableAppsCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type VerifyRoutePayload = VerifyMountableAppRequest;
type VerifyRouteResponseEnvelope = {
  error?: string;
  result?: VerifyMountableAppResult | null;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function ensureString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value.trim();
}

function buildMountableInstanceId(appId: string, installationId: string) {
  return `${appId}:${installationId || crypto.randomUUID()}`;
}

function unwrapVerifyResult(
  payload: VerifyRouteResponseEnvelope | VerifyMountableAppResult | null,
): VerifyMountableAppResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("result" in payload) {
    return payload.result ?? null;
  }

  return payload as VerifyMountableAppResult;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VerifyRoutePayload;
    const appId = normalizeMountableAppId(ensureString(payload.appId, "appId"));
    if (!appId) {
      throw new Error("appId is required");
    }

    const installToken = ensureString(payload.installToken, "installToken");
    if (!installToken) {
      throw new Error("installToken is required");
    }

    const collection = await getMountableAppsCollection();
    const manifest = await collection.findOne({ appId }, {
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
        registrationSecretIssuedAt: 1,
        supportsTimestampQuery: 1,
        principles: 1,
        configSchema: 1,
        configDefaults: 1,
      },
    }) as Record<string, unknown> | null;

    if (!manifest) {
      return badRequest("Mountable app not found", 404);
    }

    const verifyInstallUrl = normalizeMountableUrl(typeof manifest.verifyInstallUrl === "string" ? manifest.verifyInstallUrl : "");
    if (!verifyInstallUrl) {
      return badRequest("Registered mountable app is missing a verifyInstallUrl", 409);
    }

    const startsAtWindow = deriveMountableWindow({
      startsAt: payload.campaign?.startsAt ?? null,
      endsAt: payload.campaign?.endsAt ?? null,
      taskStartDelayHours: payload.campaign?.taskStartDelayHours ?? null,
      taskDurationHours: payload.campaign?.taskDurationHours ?? null,
      baseTimestamp: payload.campaign?.chainCreatedAt ?? null,
    });

    const normalizedSelectedPrinciples = normalizeMountableAppPrincipleSelections(
      payload.selectedPrinciples
      ?? (Array.isArray(payload.selectedPrincipleIds)
        ? payload.selectedPrincipleIds.map((principleId) => ({ principleId, required: true }))
        : []),
    );

    const forwardedPayload: VerifyMountableAppRequest = {
      appId,
      installToken,
      selectedPrincipleIds: normalizedSelectedPrinciples.map((entry) => entry.principleId),
      selectedPrinciples: normalizedSelectedPrinciples,
      config: normalizeMountableJsonObject(payload.config),
      campaign: {
        campaignId: payload.campaign?.campaignId ?? null,
        createdByHash: payload.campaign?.createdByHash ?? null,
        chainCreatedAt: payload.campaign?.chainCreatedAt ?? null,
        campaignType: typeof payload.campaign?.campaignType === "number" ? payload.campaign.campaignType : null,
        taskStartDelayHours: payload.campaign?.taskStartDelayHours ?? null,
        taskDurationHours: payload.campaign?.taskDurationHours ?? null,
        startsAt: startsAtWindow.startsAt || (payload.campaign?.startsAt ?? null),
        endsAt: startsAtWindow.endsAt || (payload.campaign?.endsAt ?? null),
      },
    };

    const response = await fetch(verifyInstallUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(forwardedPayload),
      cache: "no-store",
    });
    const verifyPayload = await response.json().catch(() => null) as VerifyRouteResponseEnvelope | VerifyMountableAppResult | null;

    if (!response.ok) {
      const errorMessage = verifyPayload && typeof verifyPayload === "object" && "error" in verifyPayload
        ? verifyPayload.error
        : null;
      throw new Error(errorMessage || "Mountable app verification failed");
    }

    const result = unwrapVerifyResult(verifyPayload);

    const manifestPrinciples = normalizeMountableAppPrinciples(manifest.principles);
    const returnedPrinciples = normalizeMountableAppPrinciples(result?.principles);
    const resolvedPrinciples = returnedPrinciples.length > 0 ? returnedPrinciples : manifestPrinciples;
    const selectedPrinciples = resolveSelectedMountableAppPrinciples(
      resolvedPrinciples,
      result?.selectedPrinciples && Array.isArray(result.selectedPrinciples) && result.selectedPrinciples.length > 0
        ? result.selectedPrinciples
        : normalizedSelectedPrinciples,
    );

    if (selectedPrinciples.length === 0) {
      throw new Error("Select at least one principle before verifying the mountable app");
    }

    const installationId = typeof result?.installationId === "string" && result.installationId.trim()
      ? result.installationId.trim()
      : crypto.randomUUID();
    const sharedSecret = typeof result?.sharedSecret === "string" && result.sharedSecret.trim()
      ? result.sharedSecret.trim()
      : installToken;
    const installationSecretHash = await hashMountableSecret(sharedSecret);
    const mountableInstanceId = buildMountableInstanceId(appId, installationId);
    const verifiedAt = new Date().toISOString();

    return NextResponse.json({
      ok: true,
      appMountable: {
        enabled: true,
        appId,
        appName: typeof manifest.appName === "string" ? manifest.appName.trim() : appId,
        description: typeof result?.description === "string" && result.description.trim()
          ? result.description.trim()
          : typeof manifest.description === "string"
            ? manifest.description.trim()
            : "",
        sdkVersion: typeof manifest.sdkVersion === "string" ? manifest.sdkVersion.trim() : "",
        appUrl: normalizeMountableUrl(typeof result?.appUrl === "string" ? result.appUrl : typeof manifest.appUrl === "string" ? manifest.appUrl : ""),
        iconUrl: normalizeMountableUrl(typeof result?.iconUrl === "string" ? result.iconUrl : typeof manifest.iconUrl === "string" ? manifest.iconUrl : ""),
        mountableInstanceId,
        installationId,
        installationLabel: typeof result?.installationLabel === "string" ? result.installationLabel.trim() : installationId,
        installTokenMasked: maskInstallToken(installToken),
        installTokenUpdatedAt: verifiedAt,
        status: "verified",
        verifiedAt,
        supportsTimestampQuery: result?.supportsTimestampQuery === true || manifest.supportsTimestampQuery === true,
        activityWebhookUrl: typeof manifest.activityWebhookUrl === "string" ? normalizeMountableUrl(manifest.activityWebhookUrl) : "",
        pollUpdatesUrl: typeof manifest.pollUpdatesUrl === "string" ? normalizeMountableUrl(manifest.pollUpdatesUrl) : "",
        syncMode: manifest.syncMode === "poll" || manifest.syncMode === "both" ? manifest.syncMode : "webhook",
        pollIntervalSeconds: typeof manifest.pollIntervalSeconds === "number" ? manifest.pollIntervalSeconds : null,
        registrationSecretIssuedAt: typeof manifest.registrationSecretIssuedAt === "string" ? manifest.registrationSecretIssuedAt : "",
        startsAt: forwardedPayload.campaign?.startsAt ?? "",
        endsAt: forwardedPayload.campaign?.endsAt ?? "",
        principles: resolvedPrinciples,
        selectedPrinciples: selectedPrinciples,
        config: normalizeMountableJsonObject(result?.config ?? payload.config ?? manifest.configDefaults),
        adminNotice: typeof result?.adminNotice === "string" ? result.adminNotice.trim() : "",
        installationSecretHash,
        lastSyncAt: "",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify mountable app";
    return badRequest(message);
  }
}
