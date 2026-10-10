"use client";

import { GitBranchPlus, LockKeyhole, Scroll } from "lucide-react";
import Image from "next/image";

import { appMountableSummary } from "@/app/_lib/appMountable";
import { childFreightMountableSummary } from "@/app/_lib/childFreightMountable";
import { lockMountableSummary } from "@/app/_lib/lockMountable";
import type { AppMountableConfig } from "@/app/_types/appMountable";
import type { LockMountableRule } from "@/app/_types/lockMountable";

type CreateReviewMountablesInfoProps = {
  appMountables: AppMountableConfig[];
  childFreightEnabled: boolean;
  childFreightTitle: string;
  formsEnabled: boolean;
  formsUrl: string;
  lockEnabled: boolean;
  lockFbars: string;
  lockRule: LockMountableRule;
};

type MountableInfoEntry = {
  detail: string;
  key: string;
  kind: "app" | "child-freight" | "forms" | "lock";
  logoUrl?: string;
  name: string;
  principles: string[];
};

export default function CreateReviewMountablesInfo({
  appMountables,
  childFreightEnabled,
  childFreightTitle,
  formsEnabled,
  formsUrl,
  lockEnabled,
  lockFbars,
  lockRule,
}: CreateReviewMountablesInfoProps) {
  const entries: MountableInfoEntry[] = [
    ...(childFreightEnabled ? [{
      detail: childFreightMountableSummary({ enabled: true, title: childFreightTitle }),
      key: "child-freight",
      kind: "child-freight" as const,
      name: "Child Freight",
      principles: ["Create a child freight"],
    }] : []),
    ...(formsEnabled ? [{
      detail: formsUrl.trim() || "Google Forms responder link pending",
      key: "forms",
      kind: "forms" as const,
      name: "Forms",
      principles: ["Google Forms"],
    }] : []),
    ...(lockEnabled ? [{
      detail: lockMountableSummary({ enabled: true, criterion: "fbars", rule: lockRule, minimumFbars: lockFbars }),
      key: "lock",
      kind: "lock" as const,
      name: "Lock",
      principles: [lockRule === "block_at_or_above" ? "Block at or above" : "Block below"],
    }] : []),
    ...appMountables.filter((entry) => entry.enabled).map((entry) => ({
      detail: appMountableSummary(entry),
      key: entry.mountableInstanceId || entry.appId,
      kind: "app" as const,
      logoUrl: entry.logoUrl || entry.iconUrl,
      name: entry.appName || entry.appId,
      principles: entry.selectedPrinciples.map((principle) => principle.displayLabel || principle.title || principle.principleId),
    })),
  ].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));

  return (
    <div className="create-review-info-mountables">
      {entries.length > 0 ? entries.map((entry) => (
        <div className="create-review-info-mountable" key={entry.key}>
          <span className={`create-mountable-option-icon-bg ${entry.kind === "app" && entry.logoUrl ? "create-mountable-option-logo-bg" : entry.kind === "child-freight" ? "create-mountable-option-child-freight" : ""}`.trim()} aria-hidden="true">
            {entry.kind === "app" && entry.logoUrl ? (
              <Image src={entry.logoUrl} alt="" width={38} height={38} unoptimized />
            ) : entry.kind === "child-freight" ? (
              <GitBranchPlus size={18} strokeWidth={2} />
            ) : entry.kind === "forms" ? (
              <Scroll size={18} strokeWidth={2} />
            ) : (
              <LockKeyhole size={18} strokeWidth={2} />
            )}
          </span>
          <div className="create-review-info-mountable-copy">
            <p className="create-review-section-label text-gray-900">{entry.name}</p>
            <p className="create-info-constraint-item text-gray-500"><span>{entry.detail}</span></p>
            {entry.principles.length > 0 ? (
              <p className="create-review-info-mountable-principles">Principles: {entry.principles.join(", ")}</p>
            ) : null}
          </div>
        </div>
      )) : (
        <p className="create-info-constraint-item text-gray-500"><span>No mountables selected.</span></p>
      )}
    </div>
  );
}
