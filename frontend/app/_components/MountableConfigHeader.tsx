"use client";

import { GitBranchPlus, LockKeyhole, Scroll } from "lucide-react";
import Image from "next/image";

type MountableConfigHeaderProps = {
  description: string;
  kind: "app" | "child-freight" | "forms" | "lock";
  logoUrl?: string;
  name: string;
};

export default function MountableConfigHeader({
  description,
  kind,
  logoUrl,
  name,
}: MountableConfigHeaderProps) {
  return (
    <div className="create-mountable-config-header">
      <div className="create-mountable-config-header-icon" aria-hidden="true">
        <span className={`create-mountable-option-icon-bg ${kind === "app" && logoUrl ? "create-mountable-option-logo-bg" : kind === "child-freight" ? "create-mountable-option-child-freight" : ""}`.trim()}>
          {kind === "app" && logoUrl ? (
            <Image src={logoUrl} alt="" width={38} height={38} unoptimized />
          ) : kind === "child-freight" ? (
            <GitBranchPlus size={18} strokeWidth={2} />
          ) : kind === "forms" ? (
            <Scroll size={18} strokeWidth={2} />
          ) : (
            <LockKeyhole size={18} strokeWidth={2} />
          )}
        </span>
      </div>
      <div className="create-mountable-config-header-copy">
        <p className="create-review-section-label text-gray-900">{name}</p>
        <p className="create-info-constraint-item text-gray-500"><span>{description}</span></p>
      </div>
    </div>
  );
}
