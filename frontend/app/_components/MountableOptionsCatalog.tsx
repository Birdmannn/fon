"use client";

import { Blocks, Check, DollarSign, GitBranchPlus, LockKeyhole, Scroll } from "lucide-react";
import Image from "next/image";

import type { RegisteredMountableApp } from "@/app/_types/appMountable";

type MountableOptionsCatalogProps = {
  childFreightMountableSelected: boolean;
  formsMountableSelected: boolean;
  lockMountableSelected: boolean;
  onToggleApp: (appId: string) => void;
  onToggleChildFreight: () => void;
  onToggleForms: () => void;
  onToggleLock: () => void;
  registeredMountableApps: RegisteredMountableApp[];
  selectedMountableAppIds: string[];
};

type CatalogItem = {
  id: string;
  label: string;
  kind: "child-freight" | "forms" | "lock" | "payable" | "registered";
  app?: RegisteredMountableApp;
};

const LETTERS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));

function groupForLabel(label: string) {
  const firstCharacter = label.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(firstCharacter) ? firstCharacter : "#";
}

export default function MountableOptionsCatalog({
  childFreightMountableSelected,
  formsMountableSelected,
  lockMountableSelected,
  onToggleApp,
  onToggleChildFreight,
  onToggleForms,
  onToggleLock,
  registeredMountableApps,
  selectedMountableAppIds,
}: MountableOptionsCatalogProps) {
  const builtInItems: CatalogItem[] = [
    { id: "builtin:child-freight", label: "Child Freight", kind: "child-freight" },
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
                const isRegisteredAppSelected = app
                  ? selectedMountableAppIds.includes(app.appId)
                  : false;
                const selected = item.kind === "forms"
                  ? formsMountableSelected
                  : item.kind === "child-freight"
                    ? childFreightMountableSelected
                  : item.kind === "lock"
                    ? lockMountableSelected
                    : isRegisteredAppSelected;
                const ariaLabel = item.kind === "forms"
                  ? `${selected ? "Deselect" : "Select"} forms mountable`
                  : item.kind === "child-freight"
                    ? `${selected ? "Deselect" : "Select"} child freight mountable`
                  : item.kind === "lock"
                    ? `${selected ? "Deselect" : "Select"} lock mountable`
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
                    data-tooltip={item.label}
                    disabled={item.kind === "payable"}
                    onClick={item.kind === "forms"
                      ? onToggleForms
                      : item.kind === "child-freight"
                        ? onToggleChildFreight
                      : item.kind === "lock"
                        ? onToggleLock
                        : app
                          ? () => onToggleApp(app.appId)
                          : undefined}
                  >
                    <span className="create-mountable-option-icon-wrap">
                      <span className={`create-mountable-option-icon-bg ${app ? "create-mountable-option-logo-bg" : item.kind === "child-freight" ? "create-mountable-option-child-freight" : ""}`.trim()}>
                        {app ? (
                          <Image src={app.logoUrl} alt="" width={38} height={38} unoptimized />
                        ) : item.kind === "forms" ? (
                          <Scroll size={18} strokeWidth={2} aria-hidden="true" />
                        ) : item.kind === "child-freight" ? (
                          <GitBranchPlus size={18} strokeWidth={2} aria-hidden="true" />
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
