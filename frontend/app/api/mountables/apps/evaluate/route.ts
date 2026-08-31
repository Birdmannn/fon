import { NextResponse } from "next/server";

import { normalizeAppMountableConfigs } from "@/app/_lib/appMountable";
import { type PollMountableAppResult, normalizeMountableAppId, normalizeMountableUrl } from "@/lib/fonMountablesSdk";
import { dispatchMountableAppEvaluationRequest, finalizeCampaignParticipant, type CampaignParticipantRuntimeRow, type CampaignRecordMountableRuntime } from "@/lib/mountableAppRuntime";
import { getCampaignParticipantsCollection, getMongoCollection, getMountableAppsCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type EvaluateMountedAppsPayload = {
  campaignId?: unknown;
  participantAddress?: unknown;
  appId?: unknown;
  mountableInstanceId?: unknown;
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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as EvaluateMountedAppsPayload;
    const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
    const participantAddress = normalizeAddress(ensureString(payload.participantAddress, "participantAddress"));
    const requestedAppId = typeof payload.appId === "string" ? normalizeMountableAppId(payload.appId) : "";
    const requestedMountableInstanceId = typeof payload.mountableInstanceId === "string" ? payload.mountableInstanceId.trim() : "";

    const recordCollection = await getMongoCollection();
    const record = await recordCollection.findOne(
      { campaignId },
      {
        projection: {
          _id: 0,
          campaignId: 1,
          createdByHash: 1,
          chainCreatedAt: 1,
          campaignType: 1,
          argsDraft: 1,
          mountables: 1,
        },
      },
    ) as CampaignRecordMountableRuntime | null;
    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const mountedApps = normalizeAppMountableConfigs(record.mountables?.apps).filter((entry) => {
      if (!entry.enabled) {
        return false;
      }
      if (requestedAppId && entry.appId !== requestedAppId) {
        return false;
      }
      if (requestedMountableInstanceId && entry.mountableInstanceId !== requestedMountableInstanceId) {
        return false;
      }
      return true;
    });

    if (mountedApps.length === 0) {
      return NextResponse.json({ ok: true, requested: 0, deliveries: [] });
    }

    const participantsCollection = await getCampaignParticipantsCollection();
    const participant = await participantsCollection.findOne(
      {
        campaignId,
        participantAddress,
        participantKind: { $ne: "canonical_verification" },
      },
      {
        sort: { updatedAt: -1 },
        projection: {
          _id: 0,
          participantAddress: 1,
          participantKind: 1,
          status: 1,
          mountableType: 1,
          mountableInstanceId: 1,
          childSatisfied: 1,
          parentSatisfied: 1,
          statusMessage: 1,
          effectiveAt: 1,
          sourceUpdatedAt: 1,
          criteriaState: 1,
          updatedAt: 1,
        },
      },
    ) as CampaignParticipantRuntimeRow | null;
    if (!participant) {
      return badRequest("Participant not found for this freight", 404);
    }

    const canonicalVerification = await finalizeCampaignParticipant({ campaignId, participantAddress, record });
    const deliveries = await Promise.all(
      mountedApps.map((mountedApp) => dispatchMountableAppEvaluationRequest({
        record,
        mountedApp,
        participant,
        canonicalVerification,
        source: "manual-evaluate",
      }).then((result) => ({ mountedApp, result }))),
    );

    return NextResponse.json({
      ok: true,
      requested: mountedApps.length,
      deliveries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to request mounted app evaluation";
    return badRequest(message);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const appId = normalizeMountableAppId(url.searchParams.get("appId")?.trim() ?? "");
    if (!appId) {
      return badRequest("appId is required");
    }

    const collection = await getMountableAppsCollection();
    const manifest = await collection.findOne(
      { appId },
      {
        projection: {
          _id: 0,
          pollUpdatesUrl: 1,
          syncMode: 1,
          appId: 1,
        },
      },
    ) as { appId?: unknown; pollUpdatesUrl?: unknown; syncMode?: unknown } | null;
    if (!manifest) {
      return badRequest("Mountable app not found", 404);
    }

    const pollUpdatesUrl = typeof manifest.pollUpdatesUrl === "string" ? normalizeMountableUrl(manifest.pollUpdatesUrl) : "";
    if (!pollUpdatesUrl) {
      return badRequest("Registered mountable app is missing a pollUpdatesUrl", 409);
    }

    const response = await fetch(pollUpdatesUrl, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as PollMountableAppResult | { error?: string } | null;
    if (!response.ok) {
      throw new Error(payload && typeof payload === "object" && "error" in payload ? payload.error ?? "Mountable app poll failed" : "Mountable app poll failed");
    }

    return NextResponse.json({ ok: true, result: payload ?? { updates: [] } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to poll mountable app";
    return badRequest(message);
  }
}
