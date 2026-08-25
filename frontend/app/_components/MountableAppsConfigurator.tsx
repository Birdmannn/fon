"use client";

import { Blocks, Check, LoaderCircle, Trash2 } from "lucide-react";

import { appMountableSummary } from "@/app/_lib/appMountable";
import type { AppMountableConfig, RegisteredMountableApp } from "@/app/_types/appMountable";

type MountableAppsConfiguratorProps = {
  errorMessage?: string;
  isMountableAppsLoading: boolean;
  isVerifyingMountableApp: boolean;
  mountedAppConfigs: AppMountableConfig[];
  mountableAppInstallToken: string;
  onInstallTokenChange: (value: string) => void;
  onRemoveMountedAppConfig: (mountableInstanceId: string) => void;
  onSelectMountableAppId: (appId: string) => void;
  onToggleSelectedMountablePrinciple: (principleId: string) => void;
  onVerifySelectedMountableApp: () => Promise<unknown>;
  registeredMountableApps: RegisteredMountableApp[];
  selectedMountableAppId: string;
  selectedMountablePrincipleIds: string[];
};

export default function MountableAppsConfigurator({
  errorMessage = "",
  isMountableAppsLoading,
  isVerifyingMountableApp,
  mountedAppConfigs,
  mountableAppInstallToken,
  onInstallTokenChange,
  onRemoveMountedAppConfig,
  onSelectMountableAppId,
  onToggleSelectedMountablePrinciple,
  onVerifySelectedMountableApp,
  registeredMountableApps,
  selectedMountableAppId,
  selectedMountablePrincipleIds,
}: MountableAppsConfiguratorProps) {
  const selectedApp = registeredMountableApps.find((entry) => entry.appId === selectedMountableAppId) ?? null;

  return (
    <div className="create-info-constraints-copy">
      <div className="create-review-card-heading-row">
        <p className="create-review-section-label text-gray-900">Apps</p>
        {errorMessage ? <p className="create-info-forms-inline-error">{errorMessage}</p> : null}
      </div>

      {mountedAppConfigs.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {mountedAppConfigs.map((config) => (
            <div key={config.mountableInstanceId || `${config.appId}:${config.installationId}`} className="rounded-lg border border-black/10 bg-black/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-gray-900">
                    <Blocks size={16} strokeWidth={2} aria-hidden="true" />
                    <p className="font-semibold">{config.appName || config.appId || "Mounted app"}</p>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{appMountableSummary(config)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                    {config.installationLabel ? <span>{config.installationLabel}</span> : null}
                    {config.selectedPrinciples.length > 0 ? <span>{config.selectedPrinciples.length} principle{config.selectedPrinciples.length === 1 ? "" : "s"} selected</span> : null}
                    {config.supportsTimestampQuery ? <span>As-of queries supported</span> : null}
                    {config.lastSyncAt ? <span>Last sync {new Date(config.lastSyncAt).toLocaleString()}</span> : null}
                  </div>
                  {config.adminNotice ? <p className="mt-2 text-xs text-gray-500">{config.adminNotice}</p> : null}
                </div>
                <button
                  type="button"
                  className="create-modal-action-btn shrink-0"
                  aria-label={`Remove ${config.appName || config.appId || "mounted app"}`}
                  data-tooltip="Remove app"
                  onClick={() => onRemoveMountedAppConfig(config.mountableInstanceId)}
                >
                  <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="create-info-constraint-item mt-3 text-gray-500">
          <span>No app mountables added yet.</span>
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <p className="create-review-section-label text-gray-900">Registered apps:</p>
        {isMountableAppsLoading ? (
          <p className="create-info-constraint-item text-gray-500">
            <span className="inline-flex items-center gap-2">
              <LoaderCircle size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />
              Loading SDK apps...
            </span>
          </p>
        ) : registeredMountableApps.length > 0 ? (
          registeredMountableApps.map((app) => {
            const isSelected = app.appId === selectedMountableAppId;
            return (
              <button
                key={app.appId}
                type="button"
                className={`rounded-lg border px-3 py-2 text-left transition ${isSelected ? "border-[#961cac] bg-[#961cac]/10" : "border-black/10 bg-white hover:bg-black/[0.03]"}`.trim()}
                onClick={() => onSelectMountableAppId(isSelected ? "" : app.appId)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{app.appName || app.appId}</p>
                    <p className="text-sm text-gray-500">{app.description?.trim() || "No description yet."}</p>
                  </div>
                  {isSelected ? <Check size={16} strokeWidth={2.6} className="shrink-0 text-[#961cac]" aria-hidden="true" /> : null}
                </div>
              </button>
            );
          })
        ) : (
          <p className="create-info-constraint-item text-gray-500">
            <span>No SDK apps have registered yet.</span>
          </p>
        )}
      </div>

      {selectedApp ? (
        <div className="create-info-forms-config mt-4">
          <div className="create-review-card-heading-row">
            <p className="create-review-section-label text-gray-900">Configure {selectedApp.appName || selectedApp.appId}</p>
          </div>
          <p className="create-info-constraint-item text-gray-500">
            <span>{selectedApp.description?.trim() || "No description yet."}</span>
          </p>
          <div className="create-info-forms-row mt-3">
            <input
              type="text"
              value={mountableAppInstallToken}
              onChange={(event) => onInstallTokenChange(event.target.value)}
              placeholder="Enter install token"
              className="create-info-ticket-input"
              aria-label={`${selectedApp.appName || selectedApp.appId} install token`}
            />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <p className="create-review-section-label text-gray-900">Principles:</p>
            {selectedApp.principles?.length ? selectedApp.principles.map((principle) => {
              const isSelected = selectedMountablePrincipleIds.includes(principle.principleId);
              return (
                <button
                  key={principle.principleId}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-left transition ${isSelected ? "border-[#961cac] bg-[#961cac]/10" : "border-black/10 bg-white hover:bg-black/[0.03]"}`.trim()}
                  onClick={() => onToggleSelectedMountablePrinciple(principle.principleId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900">{principle.title || principle.principleId}</p>
                      <p className="text-sm text-gray-500">{principle.description?.trim() || "No description yet."}</p>
                    </div>
                    {isSelected ? <Check size={16} strokeWidth={2.6} className="shrink-0 text-[#961cac]" aria-hidden="true" /> : null}
                  </div>
                </button>
              );
            }) : (
              <p className="create-info-constraint-item text-gray-500">
                <span>This app has not published any selectable principles yet.</span>
              </p>
            )}
          </div>
          <div className="create-info-confirm-actions mt-4">
            <button
              type="button"
              className="create-info-confirm-btn"
              onClick={() => onSelectMountableAppId("")}
              disabled={isVerifyingMountableApp}
            >
              Clear
            </button>
            <button
              type="button"
              className="create-info-confirm-btn create-info-confirm-btn-primary"
              onClick={() => {
                void onVerifySelectedMountableApp();
              }}
              disabled={isVerifyingMountableApp || !selectedApp.principles?.length}
            >
              {isVerifyingMountableApp ? "Verifying..." : "Verify app"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
