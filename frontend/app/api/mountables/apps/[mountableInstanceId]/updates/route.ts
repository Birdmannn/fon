import { NextResponse } from "next/server";

import { normalizeAppMountableConfigs } from "@/app/_lib/appMountable";
import type { AppMountableConfig } from "@/app/_types/appMountable";
import { hashMountableSecret, normalizeIsoTimestamp, normalizeMountableAppId, normalizeMountedAppPrincipleStates, type MountedAppUpdatePayload, type MountedAppPrincipleState } from "@/lib/fonMountablesSdk";
import { dispatchMountableAppEvaluationRequest, finalizeCampaignParticipant } from "@/lib/mountableAppRuntime";
import { getCampaignParticipantsCollection, getMountableAppUpdatesCollection, getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type MountedAppParticipantState = {
  mountableInstanceId?: unknown;
  childSatisfied?: unknown;
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

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function normalizePrincipleStates(value: unknown, selectedPrinciples: AppMountableConfig["selectedPrinciples"]): MountedAppPrincipleState[] {
  return normalizeMountedAppPrincipleStates(value, selectedPrinciples).map((state) => ({
    ...state,
    updatedAt: normalizeIsoTimestamp(state.updatedAt),
  }));
}

function computeChildSatisfied(selectedPrincipleIds: string[], principleStates: MountedAppPrincipleState[]) {
  if (selectedPrincipleIds.length === 0) {
    return false;
  }

  const statesById = new Map(principleStates.map((entry) => [entry.principleId, entry.fulfilled]));
  return selectedPrincipleIds.every((principleId) => statesById.get(principleId) === true);
}

export async function POST(request: Request, context: RouteContext<"/api/mountables/apps/[mountableInstanceId]/updates">) {
  try {
    const { mountableInstanceId } = await context.params;
    const normalizedMountableInstanceId = ensureString(mountableInstanceId, "mountableInstanceId");
    const payload = (await request.json()) as MountedAppUpdatePayload;
    const appId = normalizeMountableAppId(ensureString(payload.appId, "appId"));
    const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
    const participantAddress = normalizeAddress(ensureString(payload.participantAddress, "participantAddress"));
    const effectiveAt = normalizeIsoTimestamp(payload.effectiveAt);
    const sourceUpdatedAt = normalizeIsoTimestamp(payload.sourceUpdatedAt);

    if (!effectiveAt) {
      throw new Error("effectiveAt must be a valid ISO timestamp");
    }

    if (!sourceUpdatedAt) {
      throw new Error("sourceUpdatedAt must be a valid ISO timestamp");
    }

    const installationSecret = request.headers.get("x-fon-installation-secret")?.trim()
      || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
      || "";
    if (!installationSecret) {
      return badRequest("Missing installation secret", 401);
    }

    const recordsCollection = await getMongoCollection();
    const record = await recordsCollection.findOne(
      {
        campaignId,
        "mountables.apps.mountableInstanceId": normalizedMountableInstanceId,
      },
      {
        projection: {
          campaignId: 1,
          createdByHash: 1,
          chainCreatedAt: 1,
          campaignType: 1,
          mountables: 1,
        },
      },
    ) as {
      campaignId?: unknown;
      createdByHash?: unknown;
      chainCreatedAt?: unknown;
      campaignType?: unknown;
      mountables?: { apps?: unknown };
    } | null;

    if (!record) {
      return badRequest("Mounted app record not found", 404);
    }

    const mountedApps = normalizeAppMountableConfigs(record.mountables?.apps);
    const mountedApp = mountedApps.find((entry) => entry.mountableInstanceId === normalizedMountableInstanceId) ?? null;
    if (!mountedApp || !mountedApp.enabled) {
      return badRequest("Mounted app is not enabled for this freight", 409);
    }

    if (mountedApp.appId !== appId) {
      return badRequest("appId does not match the mounted app", 409);
    }

    const incomingSecretHash = await hashMountableSecret(installationSecret);
    if (!mountedApp.installationSecretHash || incomingSecretHash !== mountedApp.installationSecretHash) {
      return badRequest("Invalid installation secret", 403);
    }

    const principleStates = normalizePrincipleStates(payload.principleStates, mountedApp.selectedPrinciples);
    const selectedPrincipleIds = mountedApp.selectedPrinciples.map((principle) => principle.principleId);
    const childSatisfied = computeChildSatisfied(selectedPrincipleIds, principleStates);

    const participantsCollection = await getCampaignParticipantsCollection();
    const siblingDocs = await participantsCollection.find(
      {
        campaignId,
        participantAddress,
        mountableType: "app",
      },
      {
        projection: {
          mountableInstanceId: 1,
          childSatisfied: 1,
        },
      },
    ).toArray() as MountedAppParticipantState[];

    const childSatisfiedByInstanceId = new Map<string, boolean>();
    for (const sibling of siblingDocs) {
      const siblingInstanceId = typeof sibling.mountableInstanceId === "string" ? sibling.mountableInstanceId.trim() : "";
      if (!siblingInstanceId) {
        continue;
      }
      childSatisfiedByInstanceId.set(siblingInstanceId, sibling.childSatisfied === true);
    }
    childSatisfiedByInstanceId.set(normalizedMountableInstanceId, childSatisfied);

    const parentSatisfied = mountedApps.every((entry) => {
      if (!entry.enabled) {
        return true;
      }

      return childSatisfiedByInstanceId.get(entry.mountableInstanceId) === true;
    });

    const now = new Date();
    const status = childSatisfied ? "verified" : "pending";
    const statusMessage = typeof payload.statusMessage === "string" ? payload.statusMessage.trim() : "";

    await participantsCollection.updateOne(
      {
        campaignId,
        participantAddress,
        mountableType: "app",
        mountableInstanceId: normalizedMountableInstanceId,
      },
      {
        $set: {
          campaignId,
          createdByHash: typeof record.createdByHash === "string" ? record.createdByHash.trim().toLowerCase() : "",
          chainCreatedAt: typeof record.chainCreatedAt === "string" ? record.chainCreatedAt.trim() : "",
          campaignType: typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0),
          participantAddress,
          participantTxHash: null,
          joinedAt: effectiveAt,
          status,
          participantKind: "app_update",
          mountableType: "app",
          mountableInstanceId: normalizedMountableInstanceId,
          mountableKey: `${appId}:${normalizedMountableInstanceId}`,
          verificationProvider: appId,
          criteriaState: principleStates,
          effectiveAt,
          sourceUpdatedAt,
          childSatisfied,
          parentSatisfied,
          statusMessage,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    await participantsCollection.updateMany(
      {
        campaignId,
        participantAddress,
        mountableType: "app",
      },
      {
        $set: {
          parentSatisfied,
          updatedAt: now,
        },
      },
    );

    const historyCollection = await getMountableAppUpdatesCollection();
    await historyCollection.insertOne({
      campaignId,
      participantAddress,
      appId,
      mountableInstanceId: normalizedMountableInstanceId,
      effectiveAt,
      sourceUpdatedAt,
      childSatisfied,
      parentSatisfied,
      status,
      statusMessage,
      criteriaState: principleStates,
      createdAt: now,
      updatedAt: now,
    });

    await recordsCollection.updateOne(
      {
        campaignId,
        "mountables.apps.mountableInstanceId": normalizedMountableInstanceId,
      },
      {
        $set: {
          "mountables.apps.$.lastSyncAt": now.toISOString(),
          "mountables.apps.$.status": "syncing",
        },
      },
    );

    const canonicalVerification = await finalizeCampaignParticipant({
      campaignId,
      participantAddress,
      record,
    });

    if (canonicalVerification) {
      await dispatchMountableAppEvaluationRequest({
        record,
        mountedApp,
        participant: {
          participantAddress,
          participantKind: "app_update",
          status,
          mountableType: "app",
          mountableInstanceId: normalizedMountableInstanceId,
          childSatisfied,
          parentSatisfied,
          statusMessage,
          effectiveAt,
          sourceUpdatedAt,
          criteriaState: principleStates,
        },
        canonicalVerification,
        eventType: canonicalVerification.status === "verified" ? "participant.finalized" : "participant.updated",
        source: "app-update-ingest",
      });
    }

    return NextResponse.json({
      ok: true,
      childSatisfied,
      parentSatisfied,
      status,
      effectiveAt,
      sourceUpdatedAt,
      canonicalVerification,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ingest mountable app update";
    return badRequest(message);
  }
}
