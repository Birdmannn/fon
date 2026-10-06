"use client";

import { Blocks, HandCoins, LockKeyhole, Scroll, Signature } from "lucide-react";
import Image from "next/image";

import { appMountableSummary, isAppMountableEnabled, normalizeAppMountableConfigs } from "@/app/_lib/appMountable";
import { formsMountableSummary, isFormsMountableEnabled } from "@/app/_lib/formsMountable";
import { isLockMountableEnabled, lockMountableSummary } from "@/app/_lib/lockMountable";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import { isWinningCampaignType } from "@/lib/fbars";

type FreightMountablesInfoProps = {
  record: CampaignRecord | null;
};

type FreightMountableEntry = {
  description: string;
  key: string;
  kind: "app" | "forms" | "lock" | "rewardable" | "signable";
  logoUrl?: string;
  title: string;
};

export default function FreightMountablesInfo({ record }: FreightMountablesInfoProps) {
  const forms = record?.mountables?.forms;
  const lock = record?.mountables?.lock;
  const entries: FreightMountableEntry[] = [
    ...(forms && isFormsMountableEnabled(forms) ? [{
      description: formsMountableSummary(forms),
      key: "forms",
      kind: "forms" as const,
      title: "Forms",
    }] : []),
    ...(lock && isLockMountableEnabled(lock) ? [{
      description: lockMountableSummary(lock),
      key: "lock",
      kind: "lock" as const,
      title: "Lock",
    }] : []),
    ...(isWinningCampaignType(record?.campaignType ?? -1) ? [{
      description: "May reward participants with CKB.",
      key: "rewardable",
      kind: "rewardable" as const,
      title: "Rewardable",
    }] : []),
    ...((record?.giftDeliverable?.approvers?.length ?? 0) > 0 ? [{
      description: "Requires signing to deliver.",
      key: "signable",
      kind: "signable" as const,
      title: "Signable",
    }] : []),
    ...normalizeAppMountableConfigs(record?.mountables?.apps ?? null)
      .filter(isAppMountableEnabled)
      .map((app) => ({
        description: app.description?.trim() || appMountableSummary(app),
        key: app.mountableInstanceId || app.appId,
        kind: "app" as const,
        logoUrl: app.logoUrl || app.iconUrl,
        title: app.appName || app.appId || "Mounted app",
      })),
  ].sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" }));

  return (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Mountables:</p>
      <div className="create-review-info-mountables">
        {entries.map((entry) => (
          <div className="create-review-info-mountable" key={entry.key}>
            <span className={`create-mountable-option-icon-bg ${entry.kind === "app" && entry.logoUrl ? "create-mountable-option-logo-bg" : ""}`.trim()} aria-hidden="true">
              {entry.kind === "app" && entry.logoUrl ? (
                <Image src={entry.logoUrl} alt="" width={38} height={38} unoptimized />
              ) : entry.kind === "forms" ? (
                <Scroll size={18} strokeWidth={2} />
              ) : entry.kind === "lock" ? (
                <LockKeyhole size={18} strokeWidth={2} />
              ) : entry.kind === "signable" ? (
                <Signature size={18} strokeWidth={2} />
              ) : entry.kind === "rewardable" ? (
                <HandCoins size={18} strokeWidth={2} />
              ) : (
                <Blocks size={18} strokeWidth={2} />
              )}
            </span>
            <div className="create-review-info-mountable-copy">
              <p className="create-review-section-label text-gray-900">{entry.title}</p>
              <p className="create-info-constraint-item text-gray-500"><span>{entry.description}</span></p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
