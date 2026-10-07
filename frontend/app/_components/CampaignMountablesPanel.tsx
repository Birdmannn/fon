"use client";

import { Blocks, HandCoins, LockKeyhole, Scroll, Signature } from "lucide-react";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

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

export function CampaignMountableIcon({ item, className = "", style }: {
  item: Pick<CampaignMountableItem, "icon" | "logoUrl" | "title">;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`campaign-card-mounted-icon ${item.icon === "app" && item.logoUrl ? "campaign-card-mounted-icon-logo" : ""} ${className}`.trim()}
      title={item.title} aria-label={item.title} style={style}>
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
  );
}

export default function CampaignMountablesPanel({ items }: { items: CampaignMountableItem[] }) {
  if (items.length === 0) return null;

  const visibleItems = items.length >= 4 ? items.slice(0, 3) : items;
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="campaign-card-mountable-icons campaign-detail-mounted-icons" aria-label="Mounted features">
      {visibleItems.map((item, index) => (
        <CampaignMountableIcon key={item.key} item={item} style={{ zIndex: index + 1 }} />
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
