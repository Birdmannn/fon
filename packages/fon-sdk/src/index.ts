export type {
  EvaluateMountableAppFreightContext,
  EvaluateMountableAppParticipantContext,
  EvaluateMountableAppPrincipleRequest,
  EvaluateMountableAppPrincipleResult,
  FonMountableHostedAppSdk,
  MountableAppPrincipleDefinition,
  MountableAppPrincipleHandler,
  MountableAppPrincipleSelection,
  MountableAppSyncMode,
  MountableJsonObject,
  MountedAppActivityEvent,
  MountedAppActivityEventType,
  MountedAppActivityParticipantSnapshot,
  MountedAppCanonicalVerificationSnapshot,
  MountedAppPrincipleState,
  MountedAppUpdatePayload,
  PollMountableAppRequest,
  PollMountableAppResult,
  RegisterMountableAppRequest,
  RegisterMountableAppResult,
  RegisteredMountableAppManifest,
  VerifyMountableAppRequest,
  VerifyMountableAppResult,
} from "../../../frontend/lib/fonMountablesSdk";

import {
  type EvaluateMountableAppPrincipleRequest,
  type EvaluateMountableAppPrincipleResult,
  type FonMountableHostedAppSdk,
  type MountableAppPrincipleDefinition,
  type MountableAppPrincipleHandler,
  type MountableAppPrincipleSelection,
  type MountableJsonObject,
  type MountedAppUpdatePayload,
  formatMountableAppPrincipleSelection,
} from "../../../frontend/lib/fonMountablesSdk";

function buildSecretHeaders(secret: string) {
  const trimmed = secret.trim();
  return {
    authorization: `Bearer ${trimmed}`,
    "x-fon-installation-secret": trimmed,
  };
}

export function createHostedAppSdk(): FonMountableHostedAppSdk {
  const handlers = new Map<string, MountableAppPrincipleHandler>();

  return {
    addPrinciple(definition, handler) {
      handlers.set(definition.principleId, {
        definition,
        ...handler,
      });
      return this;
    },
    async evaluatePrinciple(request: EvaluateMountableAppPrincipleRequest): Promise<EvaluateMountableAppPrincipleResult> {
      const handler = handlers.get(request.principleId);
      if (!handler) {
        throw new Error(`Unknown principle: ${request.principleId}`);
      }

      const result = await handler.evaluate(request);
      return {
        principleId: handler.definition.principleId,
        title: handler.definition.title,
        description: handler.definition.description,
        supportsTimestampQuery: handler.definition.supportsTimestampQuery,
        params: request.params,
        displayLabel: handler.formatSelection
          ? handler.formatSelection(request.params ?? {} as MountableJsonObject)
          : formatMountableAppPrincipleSelection(handler.definition, request.params),
        fulfilled: result.fulfilled === true,
        detail: result.detail,
        updatedAt: result.updatedAt,
      };
    },
    listPrinciples(): MountableAppPrincipleDefinition[] {
      return Array.from(handlers.values()).map((entry) => entry.definition);
    },
  };
}

export async function registerWithFon(baseUrl: string, request: Omit<import("../../../frontend/lib/fonMountablesSdk").RegisterMountableAppRequest, "principles"> & {
  principles: MountableAppPrincipleDefinition[];
}) {
  const response = await fetch(new URL("/api/mountables/apps/register", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to register hosted app with FON");
  }

  return payload as import("../../../frontend/lib/fonMountablesSdk").RegisterMountableAppResult;
}

export async function verifyInstall(verifyInstallUrl: string, request: import("../../../frontend/lib/fonMountablesSdk").VerifyMountableAppRequest) {
  const response = await fetch(verifyInstallUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to verify install with FON host app");
  }

  return payload as import("../../../frontend/lib/fonMountablesSdk").VerifyMountableAppResult;
}

export async function sendParticipantUpdate(baseUrl: string, mountableInstanceId: string, payload: MountedAppUpdatePayload, secret: string) {
  const response = await fetch(new URL(`/api/mountables/apps/${encodeURIComponent(mountableInstanceId)}/updates`, baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildSecretHeaders(secret),
    },
    body: JSON.stringify(payload),
  });
  const responsePayload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responsePayload?.error ?? "Failed to send participant update to FON");
  }

  return responsePayload;
}

export function buildInstallationSecretHeaders(secret: string) {
  return buildSecretHeaders(secret);
}

export function buildSelectedPrinciple(principleId: string, params: MountableJsonObject = {}, displayLabel = "", required = true): MountableAppPrincipleSelection {
  return {
    principleId,
    params,
    displayLabel,
    required,
  };
}
