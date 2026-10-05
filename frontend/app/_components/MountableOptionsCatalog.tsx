"use client";

import { Blocks, Check, DollarSign, LockKeyhole, Scroll } from "lucide-react";
import Image from "next/image";

import type { AppMountableConfig, RegisteredMountableApp } from "@/app/_types/appMountable";

type MountableOptionsCatalogProps = {
  appMountablesSelected: number;
  appsMountableSelected: boolean;
  formsMountableSelected: boolean;
  lockMountableSelected: boolean;
  mountedAppConfigs: AppMountableConfig[];
  onConfigureApp: (appId: string) => void;
  onOpenApps: () => void;
  onToggleForms: () => void;
  onToggleLock: () => void;
  registeredMountableApps: RegisteredMountableApp[];
};

type CatalogItem = {
  id: string;
  label: string;
  kind: "apps" | "forms" | "lock" | "payable" | "registered";
  app?: RegisteredMountableApp;
};

const LETTERS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

function groupForLabel(label: string) {
  const firstCharacter = label.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstCharacter) ? firstCharacter : "#";
}

export default function MountableOptionsCatalog({
  appMountablesSelected,
  appsMountableSelected,
  formsMountableSelected,
  lockMountableSelected,
  mountedAppConfigs,
  onConfigureApp,
  onOpenApps,
  onToggleForms,
  onToggleLock,
  registeredMountableApps,
}: MountableOptionsCatalogProps) {
  const builtInItems: CatalogItem[] = [
    { id: "builtin:apps", label: "Apps", kind: "apps" },
    { id: "builtin:forms", label: "Forms", kind: "forms" },
    { id: "builtin:lock", label: "Lock", kind: "lock" },
    { id: "builtin:payable", label: "Payable", kind: "payable" },
  ];
  const items: CatalogItem[] = [
    ...builtInItems,
    ...registeredMountableApps.map((app) => ({
      id: `registered:${app.appId}`,
      label: app.appName?.trim() || app.appId,
      kind: "registered" as const,
      app,
    })),
  ].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));

  const groups = ["#", ...LETTERS]
    .map((label) => ({ label, items: items.filter((item) => groupForLabel(item.label) === label) }))
    .filter((group) => group.label === "#" || group.items.length > 0);

  return (
    <div className="create-mountable-catalog">
      {groups.map((group) => (
        <section key={group.label} className="create-mountable-group" aria-label={`${group.label} mountables`}>
          <div className="create-mountable-group-heading" aria-hidden="true">
            <span>{group.label}</span>
          </div>
          {group.items.length > 0 ? (
            <div className="create-mountable-options-row">
              {group.items.map((item) => {
                const app = item.app;
                const isRegisteredAppMounted = app
                  ? mountedAppConfigs.some((config) => config.appId === app.appId)
                  : false;
                const selected = item.kind === "forms"
                  ? formsMountableSelected
                  : item.kind === "lock"
                    ? lockMountableSelected
                    : item.kind === "apps"
                      ? appsMountableSelected
                      : isRegisteredAppMounted;
                const tooltip = item.kind === "apps" && appMountablesSelected > 0
                  ? `Apps (${appMountablesSelected})`
                  : item.label;
                const ariaLabel = item.kind === "forms"
                  ? `${selected ? "Deselect" : "Select"} forms mountable`
                  : item.kind === "lock"
                    ? `${selected ? "Deselect" : "Select"} lock mountable`
                    : item.kind === "apps"
                      ? selected
                        ? `Manage ${appMountablesSelected} app mountable${appMountablesSelected === 1 ? "" : "s"}`
                        : "Open app mountables"
                      : item.kind === "payable"
                        ? "Payable mountable coming soon"
                        : `Configure ${item.label}`;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`create-mountable-option ${selected ? "create-mountable-option-selected" : ""}`.trim()}
                    aria-label={ariaLabel}
                    aria-pressed={item.kind === "payable" ? undefined : selected}
                    data-tooltip={tooltip}
                    disabled={item.kind === "payable"}
                    onClick={item.kind === "forms"
                      ? onToggleForms
                      : item.kind === "lock"
                        ? onToggleLock
                        : item.kind === "apps"
                          ? onOpenApps
                          : app
                            ? () => onConfigureApp(app.appId)
                            : undefined}
                  >
                    <span className="create-mountable-option-icon-wrap">
                      <span className={`create-mountable-option-icon-bg ${app ? "create-mountable-option-logo-bg" : ""}`.trim()}>
                        {app ? (
                          <Image src={app.logoUrl} alt="" width={38} height={38} unoptimized />
                        ) : item.kind === "forms" ? (
                          <Scroll size={18} strokeWidth={2} aria-hidden="true" />
                        ) : item.kind === "lock" ? (
                          <LockKeyhole size={18} strokeWidth={2} aria-hidden="true" />
                        ) : item.kind === "payable" ? (
                          <DollarSign size={18} strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <Blocks size={18} strokeWidth={2} aria-hidden="true" />
                        )}
                      </span>
                      {item.kind !== "payable" ? (
                        <span className="create-mountable-option-check" aria-hidden="true">
                          <Check size={12} strokeWidth={2.6} aria-hidden="true" />
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
