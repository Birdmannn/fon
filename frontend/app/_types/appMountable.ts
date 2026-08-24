import type {
  MountableAppPrincipleDefinition,
  MountableJsonObject,
  RegisteredMountableAppManifest,
} from "@/lib/fonMountablesSdk";

export type MountableAppStatus = "pending" | "verified" | "syncing";

export type AppMountableSelectedPrinciple = MountableAppPrincipleDefinition & {
  required: boolean;
};

export type AppMountableConfig = {
  enabled: boolean;
  appId: string;
  appName: string;
  description: string;
  sdkVersion: string;
  appUrl: string;
  iconUrl: string;
  mountableInstanceId: string;
  installationId: string;
  installationLabel: string;
  installTokenMasked: string;
  installTokenUpdatedAt?: string;
  status: MountableAppStatus;
  verifiedAt: string;
  supportsTimestampQuery: boolean;
  startsAt: string;
  endsAt: string;
  principles: MountableAppPrincipleDefinition[];
  selectedPrinciples: AppMountableSelectedPrinciple[];
  config: MountableJsonObject;
  adminNotice: string;
  installationSecretHash: string;
  lastSyncAt?: string;
};

export type RegisteredMountableApp = RegisteredMountableAppManifest & {
  createdAt?: string;
  updatedAt?: string;
};
