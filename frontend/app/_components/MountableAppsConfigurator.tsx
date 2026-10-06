"use client";

import { Check } from "lucide-react";
import MountableConfigHeader from "@/app/_components/MountableConfigHeader";
import type { AppMountableConfig, RegisteredMountableApp } from "@/app/_types/appMountable";
import type { MountableAppPrincipleParamDefinition, MountableJsonObject, MountableJsonValue } from "@/lib/fonMountablesSdk";

type MountableAppsConfiguratorProps = {
  errorMessage?: string;
  mountedAppConfigs: AppMountableConfig[];
  onToggleSelectedMountablePrinciple: (principleId: string) => void;
  onUpdateSelectedMountablePrincipleParam: (principleId: string, paramKey: string, value: MountableJsonValue) => void;
  registeredMountableApps: RegisteredMountableApp[];
  selectedMountableAppId: string;
  selectedMountablePrincipleIds: string[];
  selectedMountablePrincipleParams: Record<string, MountableJsonObject>;
};

function parameterValue(params: MountableJsonObject, definition: MountableAppPrincipleParamDefinition) {
  return params[definition.paramKey] ?? definition.defaultValue ?? (definition.valueType === "boolean" ? false : "");
}

export default function MountableAppsConfigurator({
  errorMessage = "",
  mountedAppConfigs,
  onToggleSelectedMountablePrinciple,
  onUpdateSelectedMountablePrincipleParam,
  registeredMountableApps,
  selectedMountableAppId,
  selectedMountablePrincipleIds,
  selectedMountablePrincipleParams,
}: MountableAppsConfiguratorProps) {
  const selectedApp = registeredMountableApps.find((entry) => entry.appId === selectedMountableAppId) ?? null;

  return (
    <div className="create-info-constraints-copy">
      {selectedApp ? (
        <div className="create-info-forms-config">
          <MountableConfigHeader
            kind="app"
            logoUrl={selectedApp.logoUrl}
            name={selectedApp.appName || selectedApp.appId}
            description={selectedApp.description?.trim() || "No description yet."}
          />
          {errorMessage ? <p className="create-info-forms-inline-error mt-3">{errorMessage}</p> : null}
          {mountedAppConfigs.some((config) => config.appId === selectedApp.appId) ? (
            <p className="create-info-constraint-item mt-3 text-green-600"><span>Verified</span></p>
          ) : null}
          <div className="create-mountable-principles">
            <p className="create-review-section-label text-gray-900">Principles:</p>
            {selectedApp.principles?.length ? selectedApp.principles.map((principle) => {
              const isSelected = selectedMountablePrincipleIds.includes(principle.principleId);
              const params = { ...principle.paramsDefaults, ...(selectedMountablePrincipleParams[principle.principleId] ?? {}) };
              return (
                <div className="create-mountable-principle-wrap" key={principle.principleId}>
                  <button
                    type="button"
                    className={`create-mountable-principle ${isSelected ? "create-mountable-principle-selected" : ""}`.trim()}
                    onClick={() => onToggleSelectedMountablePrinciple(principle.principleId)}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">{principle.title || principle.principleId}</p>
                        <p className="text-sm text-gray-500">{principle.description?.trim() || "No description yet."}</p>
                        {principle.exampleReadableText ? <p className="text-xs text-gray-400">{principle.exampleReadableText}</p> : null}
                      </div>
                      {isSelected ? <Check size={16} strokeWidth={2.6} className="shrink-0 text-[#961cac]" aria-hidden="true" /> : null}
                    </div>
                  </button>
                  {isSelected && principle.paramsSchema.length > 0 ? (
                    <div className="create-mountable-params create-mountable-principle-params">
                      <p className="create-review-section-label text-gray-900">Params:</p>
                      {principle.paramsSchema.map((definition) => {
                        const value = parameterValue(params, definition);
                        const inputId = `${principle.principleId}-${definition.paramKey}`;
                        return (
                          <label className="create-mountable-param" htmlFor={inputId} key={definition.paramKey}>
                            <span className="create-mountable-param-title">{definition.title}</span>
                            {definition.valueType === "enum" ? (
                              <select
                                id={inputId}
                                className="create-info-ticket-input"
                                value={typeof value === "string" ? value : ""}
                                onChange={(event) => onUpdateSelectedMountablePrincipleParam(principle.principleId, definition.paramKey, event.target.value)}
                              >
                                {(definition.enumOptions ?? []).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                              </select>
                            ) : definition.valueType === "boolean" ? (
                              <input
                                id={inputId}
                                type="checkbox"
                                checked={value === true}
                                onChange={(event) => onUpdateSelectedMountablePrincipleParam(principle.principleId, definition.paramKey, event.target.checked)}
                              />
                            ) : (
                              <input
                                id={inputId}
                                type={definition.valueType === "number" ? "number" : "text"}
                                className="create-info-ticket-input"
                                min={definition.minimum ?? undefined}
                                max={definition.maximum ?? undefined}
                                step={definition.step ?? undefined}
                                placeholder={definition.placeholder || undefined}
                                value={typeof value === "string" || typeof value === "number" ? value : ""}
                                onChange={(event) => onUpdateSelectedMountablePrincipleParam(
                                  principle.principleId,
                                  definition.paramKey,
                                  definition.valueType === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value,
                                )}
                              />
                            )}
                            {definition.description ? <small>{definition.description}</small> : null}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            }) : (
              <p className="create-info-constraint-item text-gray-500">
                <span>This app has not published any selectable principles yet.</span>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="create-info-constraint-item text-red-500"><span>Selected app is unavailable.</span></p>
      )}
    </div>
  );
}
