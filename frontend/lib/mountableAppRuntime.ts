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
  type MountedAppPrincipleState,
  type MountedAppUpdatePayload,
  type PollMountableAppRequest,
  type PollMountableAppResult,
  hashMountableSecret,
  normalizeIsoTimestamp,
  normalizeMountableAppId,
  normalizeMountedAppPrincipleStates,
} from "@/lib/fonMountablesSdk";
import { getCampaignParticipantFinalizationsCollection, getCampaignParticipantsCollection, getMountableAppDeliveriesCollection, getMountableAppsCollection, getMountableAppUpdatesCollection, getMongoCollection } from "@/lib/mongodb";
import { deriveMountableWindow, mountableWindowDurationSeconds } from "@/lib/mountableTiming";
import { areRequiredPrinciplesSatisfied, isCanonicalParticipantVerified, isMountedAppPollDue, mountedAppWindowState } from "@/lib/mountableAppRuntimeRules";

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

export class MountableAppRuntimeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

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
    freightId: normalizeString(record.campaignId) || null,
    campaignId: normalizeString(record.campaignId) || null,
    createdByHash: normalizeString(record.createdByHash).toLowerCase() || null,
    chainCreatedAt: normalizeString(record.chainCreatedAt) || null,
    campaignType: typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0),
    taskStartDelayHours: normalizeString(record.argsDraft?.taskStartDelayHours) || null,
    taskDurationHours: normalizeString(record.argsDraft?.taskDurationHours) || null,
    startsAt: startsAtWindow.startsAt || null,
    endsAt: startsAtWindow.endsAt || null,
    timeframeSeconds: mountableWindowDurationSeconds(startsAtWindow.startsAt, startsAtWindow.endsAt),
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
  const hasBaseParticipation = rows.some((row) => {
    const participantKind = normalizeString(row.participantKind);
    const mountableType = normalizeString(row.mountableType);
    return normalizeString(row.status) === "verified"
      && mountableType !== "app"
      && mountableType !== "forms"
      && participantKind !== "app_update"
      && participantKind !== "forms_claim";
  });
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

  const previousFinalization = await finalizationsCollection.findOne(
    { campaignId, participantAddress },
    { projection: { _id: 0, canonicalVerification: 1 } },
  ) as { canonicalVerification?: MountedAppCanonicalVerificationSnapshot } | null;
  const nowIso = new Date().toISOString();
  const isVerified = isCanonicalParticipantVerified({
    baseParticipationSatisfied: hasBaseParticipation,
    formsSatisfied,
    appPrinciplesSatisfied,
  });
  const previousVerifiedAt = previousFinalization?.canonicalVerification?.status === "verified"
    ? normalizeString(previousFinalization.canonicalVerification.verifiedAt)
    : "";
  const snapshot: MountedAppCanonicalVerificationSnapshot = {
    status: isVerified ? "verified" : "pending",
    formsSatisfied,
    appPrinciplesSatisfied,
    baseParticipationSatisfied: hasBaseParticipation,
    verifiedAt: isVerified ? previousVerifiedAt || nowIso : null,
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

export async function ingestMountedAppUpdate(params: {
  mountableInstanceId: string;
  payload: MountedAppUpdatePayload;
  installationSecret?: string;
  trusted?: boolean;
  notifyHostedApps?: boolean;
  source?: string;
}) {
  const mountableInstanceId = normalizeString(params.mountableInstanceId);
  const appId = normalizeMountableAppId(params.payload.appId);
  const campaignId = normalizeString(params.payload.campaignId).toLowerCase();
  const participantAddress = normalizeAddress(params.payload.participantAddress);
  const effectiveAt = normalizeIsoTimestamp(params.payload.effectiveAt);
  const sourceUpdatedAt = normalizeIsoTimestamp(params.payload.sourceUpdatedAt);
  if (!mountableInstanceId || !appId || !campaignId || !participantAddress) {
    throw new MountableAppRuntimeError("appId, campaignId, participantAddress, and mountableInstanceId are required");
  }
  if (!effectiveAt || !sourceUpdatedAt) {
    throw new MountableAppRuntimeError("effectiveAt and sourceUpdatedAt must be valid ISO timestamps");
  }

  const recordsCollection = await getMongoCollection();
  const record = await recordsCollection.findOne(
    { campaignId, "mountables.apps.mountableInstanceId": mountableInstanceId },
    { projection: { campaignId: 1, createdByHash: 1, chainCreatedAt: 1, campaignType: 1, argsDraft: 1, mountables: 1 } },
  ) as CampaignRecordMountableRuntime | null;
  if (!record) {
    throw new MountableAppRuntimeError("Mounted app record not found", 404);
  }

  const mountedApps = normalizeAppMountableConfigs(record.mountables?.apps);
  const mountedApp = mountedApps.find((entry) => entry.mountableInstanceId === mountableInstanceId) ?? null;
  if (!mountedApp?.enabled) {
    throw new MountableAppRuntimeError("Mounted app is not enabled for this freight", 409);
  }
  if (mountedApp.appId !== appId) {
    throw new MountableAppRuntimeError("appId does not match the mounted app", 409);
  }
  if (!params.trusted) {
    const secret = normalizeString(params.installationSecret);
    if (!secret) {
      throw new MountableAppRuntimeError("Missing installation secret", 401);
    }
    if (!mountedApp.installationSecretHash || await hashMountableSecret(secret) !== mountedApp.installationSecretHash) {
      throw new MountableAppRuntimeError("Invalid installation secret", 403);
    }
  }

  const windowState = mountedAppWindowState({ startsAt: mountedApp.startsAt, endsAt: mountedApp.endsAt, at: new Date() });
  if (windowState === "pending") {
    throw new MountableAppRuntimeError("Mounted app event window has not started", 403);
  }
  if (windowState === "expired") {
    throw new MountableAppRuntimeError("Mounted app event secret has expired", 410);
  }
  if (windowState === "invalid") {
    throw new MountableAppRuntimeError("Mounted app event window is invalid", 409);
  }
  if (new Date(effectiveAt).getTime() < new Date(mountedApp.startsAt).getTime() || new Date(effectiveAt).getTime() >= new Date(mountedApp.endsAt).getTime()) {
    throw new MountableAppRuntimeError("Event effectiveAt is outside the mounted freight window", 422);
  }

  const principleStates = normalizeMountedAppPrincipleStates(params.payload.principleStates, mountedApp.selectedPrinciples)
    .map((state) => ({ ...state, updatedAt: normalizeIsoTimestamp(state.updatedAt) }));
  const childSatisfied = areRequiredPrinciplesSatisfied(mountedApp.selectedPrinciples, principleStates);
  const participantsCollection = await getCampaignParticipantsCollection();
  const siblingDocs = await participantsCollection.find(
    { campaignId, participantAddress, mountableType: "app" },
    { projection: { _id: 0, mountableInstanceId: 1, childSatisfied: 1 } },
  ).toArray() as Array<{ mountableInstanceId?: unknown; childSatisfied?: unknown }>;
  const childSatisfiedByInstanceId = new Map(siblingDocs.map((row) => [normalizeString(row.mountableInstanceId), row.childSatisfied === true]));
  childSatisfiedByInstanceId.set(mountableInstanceId, childSatisfied);
  const parentSatisfied = mountedApps.every((entry) => !entry.enabled || childSatisfiedByInstanceId.get(entry.mountableInstanceId) === true);
  const now = new Date();
  const status = childSatisfied ? "verified" : "pending";
  const statusMessage = normalizeString(params.payload.statusMessage);

  await participantsCollection.updateOne(
    { campaignId, participantAddress, mountableType: "app", mountableInstanceId },
    {
      $set: {
        campaignId,
        createdByHash: normalizeAddress(record.createdByHash),
        chainCreatedAt: normalizeString(record.chainCreatedAt),
        campaignType: typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0),
        participantAddress,
        participantTxHash: null,
        joinedAt: effectiveAt,
        status,
        participantKind: "app_update",
        mountableType: "app",
        mountableInstanceId,
        mountableKey: `${appId}:${mountableInstanceId}`,
        verificationProvider: appId,
        criteriaState: principleStates,
        effectiveAt,
        sourceUpdatedAt,
        childSatisfied,
        parentSatisfied,
        statusMessage,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  await participantsCollection.updateMany(
    { campaignId, participantAddress, mountableType: "app" },
    { $set: { parentSatisfied, updatedAt: now } },
  );
  await (await getMountableAppUpdatesCollection()).insertOne({
    campaignId,
    participantAddress,
    appId,
    mountableInstanceId,
    effectiveAt,
    sourceUpdatedAt,
    childSatisfied,
    parentSatisfied,
    status,
    statusMessage,
    criteriaState: principleStates,
    source: params.source ?? "app-update",
    createdAt: now,
    updatedAt: now,
  });
  await recordsCollection.updateOne(
    { campaignId, "mountables.apps.mountableInstanceId": mountableInstanceId },
    { $set: { "mountables.apps.$.lastSyncAt": now.toISOString(), "mountables.apps.$.status": "syncing" } },
  );

  const finalizations = await getCampaignParticipantFinalizationsCollection();
  const previous = await finalizations.findOne(
    { campaignId, participantAddress },
    { projection: { _id: 0, "canonicalVerification.status": 1 } },
  ) as { canonicalVerification?: { status?: unknown } } | null;
  const canonicalVerification = await finalizeCampaignParticipant({ campaignId, participantAddress, record });
  if (!canonicalVerification) {
    throw new MountableAppRuntimeError("Unable to finalize participant", 500);
  }
  const becameVerified = previous?.canonicalVerification?.status !== "verified" && canonicalVerification.status === "verified";

  if (params.notifyHostedApps !== false) {
    await dispatchMountedAppRequestsForParticipant({
      campaignId,
      participantAddress,
      record,
      participant: {
        participantAddress,
        participantKind: "app_update",
        status,
        mountableType: "app",
        mountableInstanceId,
        childSatisfied,
        parentSatisfied,
        statusMessage,
        effectiveAt,
        sourceUpdatedAt,
        criteriaState: principleStates,
      },
      canonicalVerification,
      eventType: becameVerified ? "participant.finalized" : "participant.updated",
      source: params.source ?? "app-update-ingest",
    });
  }

  return { childSatisfied, parentSatisfied, status, effectiveAt, sourceUpdatedAt, canonicalVerification, becameVerified };
}

function responseUpdates(payload: unknown, event: MountedAppActivityEvent): MountedAppUpdatePayload[] {
  if (!payload || typeof payload !== "object" || !event.participant || !event.freight.campaignId) {
    return [];
  }
  const value = payload as { updates?: unknown; principleStates?: unknown; statusMessage?: unknown };
  if (Array.isArray(value.updates)) {
    return (value.updates as MountedAppUpdatePayload[]).filter((update) => (
      normalizeMountableAppId(update.appId) === event.appId
      && normalizeString(update.campaignId).toLowerCase() === event.freight.campaignId
      && normalizeAddress(update.participantAddress) === event.participant?.participantAddress
    ));
  }
  if (!Array.isArray(value.principleStates)) {
    return [];
  }
  const now = new Date().toISOString();
  return [{
    appId: event.appId,
    campaignId: event.freight.campaignId,
    participantAddress: event.participant.participantAddress,
    principleStates: value.principleStates as MountedAppPrincipleState[],
    effectiveAt: now,
    sourceUpdatedAt: now,
    statusMessage: normalizeString(value.statusMessage),
  }];
}

function waitForRetry(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function dispatchMountableAppEvaluationRequest(params: {
  record: CampaignRecordMountableRuntime;
  mountedApp: {
    appId: string;
    mountableInstanceId: string;
    startsAt?: string;
    endsAt?: string;
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

  const windowState = mountedAppWindowState({
    startsAt: normalizeString(params.mountedApp.startsAt) || freight.startsAt,
    endsAt: normalizeString(params.mountedApp.endsAt) || freight.endsAt,
    at: new Date(),
  });
  if (windowState !== "active") {
    await deliveriesCollection.insertOne({
      appId,
      mountableInstanceId,
      participantAddress,
      status: `skipped_window_${windowState}`,
      event,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { ok: false, skipped: true, windowState };
  }

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

  const attempts: Array<{ attempt: number; attemptedAt: string; responseStatus?: number; errorMessage?: string }> = [];
  let responsePayload: unknown = null;
  let responseStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
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
      responseStatus = response.status;
      responsePayload = await response.json().catch(() => null);
      attempts.push({ attempt, attemptedAt: new Date().toISOString(), responseStatus });
      if (response.ok) {
        await deliveriesCollection.insertOne({
          appId,
          mountableInstanceId,
          participantAddress,
          status: "delivered",
          responseStatus,
          responsePayload,
          attempts,
          event,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        let ingestionError = "";
        try {
          if (event.eventType === "participant.updated") {
            for (const update of responseUpdates(responsePayload, event)) {
              const ingestion = await ingestMountedAppUpdate({
                mountableInstanceId,
                payload: update,
                trusted: true,
                notifyHostedApps: false,
                source: "webhook-response",
              });
              if (ingestion.becameVerified) {
                await dispatchMountedAppRequestsForParticipant({
                  campaignId: update.campaignId,
                  participantAddress: update.participantAddress,
                  canonicalVerification: ingestion.canonicalVerification,
                  eventType: "participant.finalized",
                  source: "webhook-response-finalized",
                });
              }
            }
          }
        } catch (error) {
          ingestionError = error instanceof Error ? error.message : String(error);
        }
        return { ok: true, responseStatus, payload: responsePayload, attempts: attempts.length, ingestionError: ingestionError || undefined };
      }
    } catch (error) {
      attempts.push({
        attempt,
        attemptedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (attempt < 3) {
      await waitForRetry(250 * (2 ** (attempt - 1)));
    }
  }

  await deliveriesCollection.insertOne({
    appId,
    mountableInstanceId,
    participantAddress,
    status: "failed",
    responseStatus: responseStatus || undefined,
    responsePayload,
    attempts,
    event,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { ok: false, responseStatus, payload: responsePayload, attempts: attempts.length };
}

export async function dispatchMountedAppRequestsForParticipant(params: {
  campaignId: string;
  participantAddress: string;
  record?: CampaignRecordMountableRuntime | null;
  participant?: CampaignParticipantRuntimeRow | null;
  canonicalVerification?: MountedAppCanonicalVerificationSnapshot | null;
  source?: string;
  eventType?: MountedAppActivityEvent["eventType"];
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
      eventType: params.eventType,
      source: params.source,
    })),
  );
}

export async function dispatchMountRequestedEvent(params: {
  appId: string;
  mountableInstanceId: string;
  freight: VerifyMountableAppCampaignContext;
  selectedPrinciples: MountableAppPrincipleSelection[];
  eventWebhook: NonNullable<MountedAppActivityEvent["eventWebhook"]>;
}) {
  const manifest = await loadRegisteredAppById(params.appId);
  if (!manifest || !normalizeString(manifest.activityWebhookUrl)) {
    return { ok: false, skipped: true };
  }
  const deliveries = await getMountableAppDeliveriesCollection();
  const event: MountedAppActivityEvent = {
    eventId: crypto.randomUUID(),
    eventType: "mount.requested",
    appId: params.appId,
    mountableInstanceId: params.mountableInstanceId,
    occurredAt: new Date().toISOString(),
    freight: params.freight,
    selectedPrinciples: params.selectedPrinciples,
    eventWebhook: params.eventWebhook,
    source: "freight-mount",
  };
  const loggedEvent: MountedAppActivityEvent = {
    ...event,
    eventWebhook: {
      ...params.eventWebhook,
      secret: "[redacted]",
    },
  };
  const attempts: Array<{ attempt: number; attemptedAt: string; responseStatus?: number; errorMessage?: string }> = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(manifest.activityWebhookUrl, {
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
      await response.body?.cancel().catch(() => undefined);
      attempts.push({ attempt, attemptedAt: new Date().toISOString(), responseStatus: response.status });
      if (response.ok) {
        await deliveries.insertOne({
          appId: params.appId,
          mountableInstanceId: params.mountableInstanceId,
          participantAddress: null,
          status: "delivered",
          responseStatus: response.status,
          attempts,
          event: loggedEvent,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        return { ok: true, responseStatus: response.status, attempts: attempts.length };
      }
    } catch (error) {
      attempts.push({ attempt, attemptedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : String(error) });
    }
    if (attempt < 3) {
      await waitForRetry(250 * (2 ** (attempt - 1)));
    }
  }
  await deliveries.insertOne({
    appId: params.appId,
    mountableInstanceId: params.mountableInstanceId,
    participantAddress: null,
    status: "failed",
    attempts,
    event: loggedEvent,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { ok: false, attempts: attempts.length };
}

export async function activateMountedAppsForCampaignRecord(record: CampaignRecordMountableRuntime) {
  const freight = buildFreightContext(record);
  if (!freight.campaignId || !freight.startsAt || !freight.endsAt || freight.timeframeSeconds === null) {
    return [];
  }
  if (mountedAppWindowState({ startsAt: freight.startsAt, endsAt: freight.endsAt, at: new Date() }) === "expired") {
    return [];
  }
  const mountedApps = normalizeAppMountableConfigs(record.mountables?.apps)
    .filter((mountedApp) => mountedApp.enabled && !mountedApp.webhookActivatedAt);
  const recordsCollection = await getMongoCollection();
  const results = await Promise.all(mountedApps.map(async (mountedApp) => {
    if (!mountedApp.updateWebhookUrl) {
      return { mountedApp, delivery: { ok: false, skipped: true, reason: "missing_update_webhook_url" } };
    }

    const secret = createMountableRegistrationSecret();
    const secretHash = await hashMountableSecret(secret);
    await recordsCollection.updateOne(
      { campaignId: freight.campaignId, "mountables.apps.mountableInstanceId": mountedApp.mountableInstanceId },
      {
        $set: {
          "mountables.apps.$.installationSecretHash": secretHash,
          "mountables.apps.$.webhookSecretExpiresAt": freight.endsAt,
          "mountables.apps.$.webhookSecretRevokedAt": "",
        },
      },
    );

    return {
      mountedApp,
      delivery: await dispatchMountRequestedEvent({
        appId: mountedApp.appId,
        mountableInstanceId: mountedApp.mountableInstanceId,
        freight,
        selectedPrinciples: buildSelectedPrincipleSnapshots(mountedApp.selectedPrinciples),
        eventWebhook: {
          mountableInstanceId: mountedApp.mountableInstanceId,
          url: mountedApp.updateWebhookUrl,
          secret,
          validFrom: freight.startsAt,
          validUntil: freight.endsAt,
          timeframeSeconds: freight.timeframeSeconds,
        },
      }),
    };
  }));
  const activatedAt = new Date().toISOString();
  await Promise.all(results.filter(({ delivery }) => delivery.ok).map(({ mountedApp }) => recordsCollection.updateOne(
    { campaignId: freight.campaignId, "mountables.apps.mountableInstanceId": mountedApp.mountableInstanceId },
    { $set: { "mountables.apps.$.webhookActivatedAt": activatedAt } },
  )));
  return results.map(({ delivery }) => delivery);
}

export async function pollMountedApps(params: {
  appId?: string;
  campaignId?: string;
  mountableInstanceId?: string;
  force?: boolean;
} = {}) {
  const requestedAppId = normalizeMountableAppId(params.appId);
  const requestedCampaignId = normalizeString(params.campaignId).toLowerCase();
  const requestedInstanceId = normalizeString(params.mountableInstanceId);
  const recordsCollection = await getMongoCollection();
  const query: Record<string, unknown> = {
    status: "published",
    "mountables.apps.0": { $exists: true },
  };
  if (requestedCampaignId) {
    query.campaignId = requestedCampaignId;
  }
  const records = await recordsCollection.find(query, {
    projection: { _id: 0, campaignId: 1, createdByHash: 1, chainCreatedAt: 1, campaignType: 1, argsDraft: 1, mountables: 1 },
  }).toArray() as CampaignRecordMountableRuntime[];
  const results: Array<Record<string, unknown>> = [];
  const now = new Date();

  for (const record of records) {
    const campaignId = normalizeString(record.campaignId).toLowerCase();
    await activateMountedAppsForCampaignRecord(record);
    const allMountedApps = normalizeAppMountableConfigs(record.mountables?.apps);
    for (const mountedApp of allMountedApps) {
      if (mountedApp.installationSecretHash && mountedAppWindowState({ startsAt: mountedApp.startsAt, endsAt: mountedApp.endsAt, at: now }) === "expired") {
        await recordsCollection.updateOne(
          { campaignId, "mountables.apps.mountableInstanceId": mountedApp.mountableInstanceId },
          {
            $set: {
              "mountables.apps.$.installationSecretHash": "",
              "mountables.apps.$.webhookSecretRevokedAt": now.toISOString(),
            },
          },
        );
      }
    }
    const mountedApps = allMountedApps.filter((mountedApp) => (
      mountedApp.enabled
      && (mountedApp.syncMode === "poll" || mountedApp.syncMode === "both")
      && mountedAppWindowState({ startsAt: mountedApp.startsAt, endsAt: mountedApp.endsAt, at: now }) === "active"
      && (!requestedAppId || mountedApp.appId === requestedAppId)
      && (!requestedInstanceId || mountedApp.mountableInstanceId === requestedInstanceId)
      && isMountedAppPollDue({
        force: params.force === true,
        lastPollAt: mountedApp.lastPollAt,
        pollIntervalSeconds: mountedApp.pollIntervalSeconds,
        now,
      })
    ));
    if (mountedApps.length === 0) {
      continue;
    }

    const participantRows = await (await getCampaignParticipantsCollection()).find(
      { campaignId, participantKind: { $ne: "canonical_verification" } },
      { sort: { updatedAt: -1 } },
    ).toArray() as CampaignParticipantRuntimeRow[];
    const participantsByAddress = new Map<string, MountedAppActivityParticipantSnapshot>();
    for (const row of participantRows) {
      const address = normalizeAddress(row.participantAddress);
      if (address && !participantsByAddress.has(address)) {
        participantsByAddress.set(address, buildParticipantSnapshot(row));
      }
    }

    for (const mountedApp of mountedApps) {
      const manifest = await loadRegisteredAppById(mountedApp.appId);
      if (!manifest?.pollUpdatesUrl) {
        results.push({ campaignId, mountableInstanceId: mountedApp.mountableInstanceId, ok: false, error: "Missing pollUpdatesUrl" });
        continue;
      }
      const pollRequest: PollMountableAppRequest = {
        appId: mountedApp.appId,
        mountableInstanceId: mountedApp.mountableInstanceId,
        freight: buildFreightContext(record),
        selectedPrinciples: buildSelectedPrincipleSnapshots(mountedApp.selectedPrinciples),
        participants: Array.from(participantsByAddress.values()),
        asOf: now.toISOString(),
      };
      try {
        const response = await fetch(manifest.pollUpdatesUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(manifest.registrationSecret ? buildMountableRegistrationHeaders(manifest.registrationSecret) : {}),
          },
          body: JSON.stringify(pollRequest),
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null) as PollMountableAppResult | null;
        if (!response.ok) {
          throw new Error(`Poll failed with HTTP ${response.status}`);
        }
        let ingested = 0;
        for (const update of Array.isArray(payload?.updates) ? payload.updates : []) {
          if (!participantsByAddress.has(normalizeAddress(update.participantAddress))) {
            throw new Error("Poll response included a participant that was not requested");
          }
          await ingestMountedAppUpdate({
            mountableInstanceId: mountedApp.mountableInstanceId,
            payload: update,
            trusted: true,
            notifyHostedApps: true,
            source: "poll-response",
          });
          ingested += 1;
        }
        await recordsCollection.updateOne(
          { campaignId, "mountables.apps.mountableInstanceId": mountedApp.mountableInstanceId },
          { $set: { "mountables.apps.$.lastPollAt": now.toISOString() } },
        );
        results.push({ campaignId, appId: mountedApp.appId, mountableInstanceId: mountedApp.mountableInstanceId, ok: true, ingested });
      } catch (error) {
        results.push({
          campaignId,
          appId: mountedApp.appId,
          mountableInstanceId: mountedApp.mountableInstanceId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}
