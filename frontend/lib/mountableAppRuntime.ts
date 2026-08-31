import { randomBytes } from "node:crypto";

import { normalizeAppMountableConfigs } from "@/app/_lib/appMountable";
import { normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import {
  type MountedAppActivityEvent,
  type MountedAppCanonicalVerificationSnapshot,
  type MountableAppPrincipleSelection,
  type MountedAppActivityParticipantSnapshot,
  type RegisteredMountableAppManifest,
  type VerifyMountableAppCampaignContext,
} from "@/lib/fonMountablesSdk";
import { getCampaignParticipantFinalizationsCollection, getCampaignParticipantsCollection, getMountableAppDeliveriesCollection, getMountableAppsCollection, getMongoCollection } from "@/lib/mongodb";
import { deriveMountableWindow } from "@/lib/mountableTiming";

export type CampaignRecordMountableRuntime = {
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  argsDraft?: {
    taskStartDelayHours?: unknown;
    taskDurationHours?: unknown;
  } | null;
  mountables?: {
    forms?: unknown;
    apps?: unknown;
  } | null;
};

export type CampaignParticipantRuntimeRow = {
  participantAddress?: unknown;
  participantKind?: unknown;
  status?: unknown;
  mountableType?: unknown;
  mountableInstanceId?: unknown;
  childSatisfied?: unknown;
  parentSatisfied?: unknown;
  statusMessage?: unknown;
  effectiveAt?: unknown;
  sourceUpdatedAt?: unknown;
  criteriaState?: unknown;
  updatedAt?: unknown;
};

type RegisteredMountableAppRuntime = RegisteredMountableAppManifest & {
  registrationSecret?: string;
  registrationSecretHash?: string;
  registrationSecretIssuedAt?: string;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAddress(value: unknown) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

export function createMountableRegistrationSecret() {
  return randomBytes(24).toString("base64url");
}

export function buildMountableRegistrationHeaders(secret: string) {
  const trimmed = secret.trim();
  return {
    authorization: `Bearer ${trimmed}`,
    "x-fon-registration-secret": trimmed,
  };
}

export function buildSelectedPrincipleSnapshots(value: Array<{
  principleId: string;
  params?: unknown;
  displayLabel?: unknown;
  required?: unknown;
}>): MountableAppPrincipleSelection[] {
  return value.map((entry) => ({
    principleId: entry.principleId,
    params: typeof entry.params === "object" && entry.params ? entry.params as MountableAppPrincipleSelection["params"] : {},
    displayLabel: normalizeString(entry.displayLabel),
    required: entry.required !== false,
  }));
}

export function buildFreightContext(record: CampaignRecordMountableRuntime): VerifyMountableAppCampaignContext {
  const startsAtWindow = deriveMountableWindow({
    baseTimestamp: normalizeString(record.chainCreatedAt) || null,
    taskStartDelayHours: normalizeString(record.argsDraft?.taskStartDelayHours) || null,
    taskDurationHours: normalizeString(record.argsDraft?.taskDurationHours) || null,
  });

  return {
    campaignId: normalizeString(record.campaignId) || null,
    createdByHash: normalizeString(record.createdByHash).toLowerCase() || null,
    chainCreatedAt: normalizeString(record.chainCreatedAt) || null,
    campaignType: typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0),
    taskStartDelayHours: normalizeString(record.argsDraft?.taskStartDelayHours) || null,
    taskDurationHours: normalizeString(record.argsDraft?.taskDurationHours) || null,
    startsAt: startsAtWindow.startsAt || null,
    endsAt: startsAtWindow.endsAt || null,
  };
}

export function buildParticipantSnapshot(row: CampaignParticipantRuntimeRow): MountedAppActivityParticipantSnapshot {
  return {
    participantAddress: normalizeAddress(row.participantAddress),
    participantKind: normalizeString(row.participantKind) || null,
    status: normalizeString(row.status) || "pending",
    mountableType: normalizeString(row.mountableType) || null,
    mountableInstanceId: normalizeString(row.mountableInstanceId) || null,
    childSatisfied: row.childSatisfied === null || row.childSatisfied === undefined ? null : normalizeBoolean(row.childSatisfied),
    parentSatisfied: row.parentSatisfied === null || row.parentSatisfied === undefined ? null : normalizeBoolean(row.parentSatisfied),
    statusMessage: normalizeString(row.statusMessage) || null,
    effectiveAt: normalizeString(row.effectiveAt) || null,
    sourceUpdatedAt: normalizeString(row.sourceUpdatedAt) || null,
    criteriaState: Array.isArray(row.criteriaState) ? row.criteriaState : undefined,
  };
}

async function loadCampaignRecordByCampaignId(campaignId: string) {
  const recordCollection = await getMongoCollection();
  return recordCollection.findOne(
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
  ) as Promise<CampaignRecordMountableRuntime | null>;
}

export async function finalizeCampaignParticipant(params: {
  campaignId: string;
  participantAddress: string;
  record?: CampaignRecordMountableRuntime | null;
}) {
  const campaignId = normalizeString(params.campaignId).toLowerCase();
  const participantAddress = normalizeAddress(params.participantAddress);
  if (!campaignId || !participantAddress) {
    return null;
  }

  const record = params.record ?? await loadCampaignRecordByCampaignId(campaignId);
  if (!record) {
    return null;
  }

  const participantsCollection = await getCampaignParticipantsCollection();
  const finalizationsCollection = await getCampaignParticipantFinalizationsCollection();
  const rows = await participantsCollection.find(
    {
      campaignId,
      participantAddress,
      participantKind: { $ne: "canonical_verification" },
    },
    {
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
  ).toArray() as CampaignParticipantRuntimeRow[];

  const enabledMountedApps = normalizeAppMountableConfigs(record.mountables?.apps).filter((entry) => entry.enabled);
  const formsMountable = normalizeFormsMountableConfig(record.mountables?.forms ?? null);
  const hasBaseParticipation = rows.length > 0;
  const formsSatisfied = !formsMountable.enabled || rows.some((row) => normalizeString(row.participantKind) === "forms_claim" && normalizeString(row.status) === "verified");
  const appPrinciplesSatisfied = enabledMountedApps.length === 0 || enabledMountedApps.every((mountable) => rows.some((row) => normalizeString(row.mountableType) === "app" && normalizeString(row.mountableInstanceId) === mountable.mountableInstanceId && row.childSatisfied === true));

  const reasons: string[] = [];
  if (!hasBaseParticipation) {
    reasons.push("No participant activity recorded yet");
  }
  if (!formsSatisfied) {
    reasons.push("Forms verification is still pending");
  }
  if (!appPrinciplesSatisfied) {
    reasons.push("Mounted app principles are not all fulfilled yet");
  }

  const nowIso = new Date().toISOString();
  const snapshot: MountedAppCanonicalVerificationSnapshot = {
    status: hasBaseParticipation && formsSatisfied && appPrinciplesSatisfied ? "verified" : "pending",
    formsSatisfied,
    appPrinciplesSatisfied,
    baseParticipationSatisfied: hasBaseParticipation,
    verifiedAt: hasBaseParticipation && formsSatisfied && appPrinciplesSatisfied ? nowIso : null,
    reasons,
  };

  await finalizationsCollection.updateOne(
    { campaignId, participantAddress },
    {
      $set: {
        campaignId,
        participantAddress,
        canonicalVerification: snapshot,
        updatedAt: nowIso,
      },
      $setOnInsert: {
        createdAt: nowIso,
      },
    },
    { upsert: true },
  );

  await participantsCollection.updateOne(
    {
      campaignId,
      participantAddress,
      participantKind: "canonical_verification",
    },
    {
      $set: {
        campaignId,
        participantAddress,
        participantTxHash: null,
        joinedAt: nowIso,
        status: snapshot.status,
        participantKind: "canonical_verification",
        mountableType: null,
        childSatisfied: snapshot.appPrinciplesSatisfied,
        parentSatisfied: snapshot.appPrinciplesSatisfied,
        statusMessage: reasons.join("; "),
        effectiveAt: nowIso,
        sourceUpdatedAt: nowIso,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  return snapshot;
}

async function loadRegisteredAppById(appId: string) {
  const collection = await getMountableAppsCollection();
  return collection.findOne(
    { appId },
    {
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
        registrationSecret: 1,
        registrationSecretHash: 1,
        registrationSecretIssuedAt: 1,
      },
    },
  ) as Promise<RegisteredMountableAppRuntime | null>;
}

export async function dispatchMountableAppEvaluationRequest(params: {
  record: CampaignRecordMountableRuntime;
  mountedApp: {
    appId: string;
    mountableInstanceId: string;
    selectedPrinciples: Array<{
      principleId: string;
      params?: unknown;
      displayLabel?: unknown;
      required?: unknown;
    }>;
  };
  participant: CampaignParticipantRuntimeRow;
  canonicalVerification?: MountedAppCanonicalVerificationSnapshot | null;
  eventType?: MountedAppActivityEvent["eventType"];
  source?: string;
}) {
  const appId = normalizeString(params.mountedApp.appId);
  const mountableInstanceId = normalizeString(params.mountedApp.mountableInstanceId);
  const participantAddress = normalizeAddress(params.participant.participantAddress);
  if (!appId || !mountableInstanceId || !participantAddress) {
    return { ok: false, skipped: true };
  }

  const manifest = await loadRegisteredAppById(appId);
  const deliveriesCollection = await getMountableAppDeliveriesCollection();
  const selectedPrinciples = buildSelectedPrincipleSnapshots(params.mountedApp.selectedPrinciples);
  const freight = buildFreightContext(params.record);
  const event: MountedAppActivityEvent = {
    eventId: crypto.randomUUID(),
    eventType: params.eventType ?? (params.canonicalVerification?.status === "verified" ? "participant.finalized" : "participant.updated"),
    appId,
    mountableInstanceId,
    occurredAt: new Date().toISOString(),
    freight,
    selectedPrinciples,
    participant: buildParticipantSnapshot(params.participant),
    canonicalVerification: params.canonicalVerification ?? undefined,
    source: params.source,
  };

  if (!manifest) {
    await deliveriesCollection.insertOne({
      appId,
      mountableInstanceId,
      participantAddress,
      status: "skipped_missing_manifest",
      event,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { ok: false, skipped: true };
  }

  if ((manifest.syncMode === "poll" || !normalizeString(manifest.activityWebhookUrl))) {
    await deliveriesCollection.insertOne({
      appId,
      mountableInstanceId,
      participantAddress,
      status: "skipped_no_webhook",
      event,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { ok: false, skipped: true };
  }

  try {
    const response = await fetch(normalizeString(manifest.activityWebhookUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(manifest.registrationSecret ? buildMountableRegistrationHeaders(manifest.registrationSecret) : {}),
        "x-fon-event-id": event.eventId,
        "x-fon-event-type": event.eventType,
      },
      body: JSON.stringify(event),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);

    await deliveriesCollection.insertOne({
      appId,
      mountableInstanceId,
      participantAddress,
      status: response.ok ? "delivered" : "failed",
      responseStatus: response.status,
      responsePayload: payload,
      event,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      ok: response.ok,
      responseStatus: response.status,
      payload,
    };
  } catch (error) {
    await deliveriesCollection.insertOne({
      appId,
      mountableInstanceId,
      participantAddress,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      event,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { ok: false, error };
  }
}

export async function dispatchMountedAppRequestsForParticipant(params: {
  campaignId: string;
  participantAddress: string;
  record?: CampaignRecordMountableRuntime | null;
  participant?: CampaignParticipantRuntimeRow | null;
  canonicalVerification?: MountedAppCanonicalVerificationSnapshot | null;
  source?: string;
}) {
  const campaignId = normalizeString(params.campaignId).toLowerCase();
  const participantAddress = normalizeAddress(params.participantAddress);
  if (!campaignId || !participantAddress) {
    return [];
  }

  const record = params.record ?? await loadCampaignRecordByCampaignId(campaignId);
  if (!record) {
    return [];
  }

  const mountedApps = normalizeAppMountableConfigs(record.mountables?.apps).filter((entry) => entry.enabled);
  if (mountedApps.length === 0) {
    return [];
  }

  const participantsCollection = await getCampaignParticipantsCollection();
  const participant = params.participant ?? await participantsCollection.findOne(
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
    return [];
  }

  const canonicalVerification = params.canonicalVerification ?? await finalizeCampaignParticipant({
    campaignId,
    participantAddress,
    record,
  });

  return Promise.all(
    mountedApps.map((mountedApp) => dispatchMountableAppEvaluationRequest({
      record,
      mountedApp,
      participant,
      canonicalVerification,
      source: params.source,
    })),
  );
}
