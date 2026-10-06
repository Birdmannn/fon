"use client";

import { Blocks, HandCoins, LockKeyhole, Scroll, Signature } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

export type CampaignMountableItem = {
  actions?: ReactNode;
  description: string;
  href?: string;
  icon?: "app" | "forms" | "lock" | "rewardable" | "signable";
  key: string;
  logoUrl?: string;
  metadata?: string[];
  proofInstructions?: string;
  title: string;
};

export default function CampaignMountablesPanel({ items }: { items: CampaignMountableItem[] }) {
  if (items.length === 0) return null;

  const visibleItems = items.length >= 4 ? items.slice(0, 3) : items;
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="campaign-card-mountable-icons campaign-detail-mounted-icons" aria-label="Mounted features">
      {visibleItems.map((item, index) => (
        <span
          className={`campaign-card-mounted-icon ${item.icon === "app" && item.logoUrl ? "campaign-card-mounted-icon-logo" : ""}`.trim()}
          title={item.title}
          aria-label={item.title}
          key={item.key}
          style={{ zIndex: index + 1 }}
        >
          {item.icon === "app" ? (
            item.logoUrl ? <Image src={item.logoUrl} alt="" width={38} height={38} unoptimized /> : <Blocks size={20} strokeWidth={2} aria-hidden="true" />
          ) : item.icon === "forms" ? (
            <Scroll size={22} strokeWidth={2} aria-hidden="true" />
          ) : item.icon === "signable" ? (
            <Signature size={22} strokeWidth={2} aria-hidden="true" />
          ) : item.icon === "rewardable" ? (
            <HandCoins size={22} strokeWidth={2} aria-hidden="true" />
          ) : (
            <LockKeyhole size={22} strokeWidth={2} aria-hidden="true" />
          )}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span
          className="campaign-card-mounted-icon campaign-card-mounted-icon-overflow"
          title={`${hiddenCount} more ${hiddenCount === 1 ? "mountable" : "mountables"}`}
          aria-label={`${hiddenCount} more ${hiddenCount === 1 ? "mountable" : "mountables"}`}
          style={{ zIndex: visibleItems.length + 1 }}
        >
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}
