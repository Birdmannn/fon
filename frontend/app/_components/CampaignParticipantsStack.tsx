"use client";

import { UserRound } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

type ParticipantRow = {
  participantAddress?: unknown;
  participantKind?: unknown;
  status?: unknown;
};

type PublicProfile = {
  address?: unknown;
  displayName?: unknown;
};

function ParticipantAvatar({ address, title, photoVersion, status }: {
  address: string;
  title: string;
  photoVersion?: string | null;
  status?: "verified" | "pending";
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoUrl = `/api/user-profiles/photo?address=${encodeURIComponent(address)}${photoVersion ? `&v=${encodeURIComponent(photoVersion)}` : ""}`;

  return (
    <span
      className={`campaign-participant-avatar${status ? ` campaign-participant-avatar-${status}` : ""}`}
      data-tooltip={title}
      aria-label={title}
    >
      {!photoFailed ? (
        <Image src={photoUrl} alt="" fill unoptimized onError={() => setPhotoFailed(true)} />
      ) : (
        <UserRound size={20} strokeWidth={2} aria-hidden="true" />
      )}
    </span>
  );
}

export default function CampaignParticipantsStack({ campaignId, walletAddress, walletPhotoUpdatedAt, onViewerAvatarClick }: {
  campaignId: string | null;
  walletAddress: string | null;
  walletPhotoUpdatedAt: string | null;
  onViewerAvatarClick?: () => void;
}) {
  const [verifiedAddresses, setVerifiedAddresses] = useState<string[]>([]);
  const [displayNamesByAddress, setDisplayNamesByAddress] = useState<Record<string, string>>({});
  const [loadedCampaignId, setLoadedCampaignId] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    const controller = new AbortController();
    let latestRequest = 0;
    const load = async () => {
      const request = ++latestRequest;
      try {
        const response = await fetch(`/api/campaign-participants?campaignId=${encodeURIComponent(campaignId)}&participantKind=canonical_verification`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to load participant verification");
        const payload = await response.json() as { participants?: ParticipantRow[] };
        const addresses = new Set<string>();
        for (const row of payload.participants ?? []) {
          if (row.participantKind !== "canonical_verification" || row.status !== "verified" || typeof row.participantAddress !== "string") continue;
          const address = row.participantAddress.trim().toLowerCase();
          if (address) addresses.add(address);
        }
        const verified = [...addresses];
        if (!controller.signal.aborted && request === latestRequest) {
          setVerifiedAddresses(verified);
          setLoadedCampaignId(campaignId);
        }
        const viewer = walletAddress?.trim().toLowerCase() ?? "";
        const profileAddresses = verified.slice(0, 3);
        if (viewer && addresses.has(viewer) && !profileAddresses.includes(viewer)) profileAddresses.push(viewer);
        if (profileAddresses.length === 0) {
          if (!controller.signal.aborted && request === latestRequest) setDisplayNamesByAddress({});
          return;
        }
        const profileResponse = await fetch(`/api/user-profiles?addresses=${encodeURIComponent(profileAddresses.join(","))}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!profileResponse.ok) throw new Error("Unable to load participant profiles");
        const profilePayload = await profileResponse.json() as { profiles?: PublicProfile[] };
        const names: Record<string, string> = {};
        for (const profile of profilePayload.profiles ?? []) {
          if (typeof profile.address !== "string" || typeof profile.displayName !== "string") continue;
          const name = profile.displayName.trim();
          if (name) names[profile.address.trim().toLowerCase()] = name;
        }
        if (!controller.signal.aborted && request === latestRequest) setDisplayNamesByAddress(names);
      } catch {
        // Keep the last known state until the next poll succeeds.
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [campaignId, walletAddress]);

  const participants = loadedCampaignId === campaignId ? verifiedAddresses : [];
  const participantNames = loadedCampaignId === campaignId ? displayNamesByAddress : {};
  const viewerAddress = walletAddress?.trim().toLowerCase() ?? "";
  const viewerStatus = loadedCampaignId === campaignId
    ? participants.includes(viewerAddress) ? "verified" : "pending"
    : undefined;
  const visibleParticipants = participants.length >= 4 ? participants.slice(0, 3) : participants;
  const hiddenCount = participants.length - visibleParticipants.length;

  if (!campaignId) return null;

  return (
    <div className="campaign-detail-participants-row">
      <div className="campaign-participant-stack" role="group" aria-label={`${participants.length} verified participants`}>
        {visibleParticipants.map((address, index) => (
          <span className="campaign-participant-stack-item" key={address} style={{ zIndex: index + 1 }}>
            <ParticipantAvatar address={address} title={participantNames[address] || "Verified participant"} />
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span
            className="campaign-participant-avatar campaign-participant-overflow campaign-participant-stack-item"
            style={{ zIndex: 4, fontSize: hiddenCount > 999 ? "0.58rem" : hiddenCount > 99 ? "0.7rem" : undefined }}
            data-tooltip={`${hiddenCount} more verified participants`}
          >
            +{hiddenCount}
          </span>
        ) : null}
      </div>
      {viewerAddress ? (
        <button type="button" className="campaign-participant-avatar-button" onClick={onViewerAvatarClick}
          disabled={!onViewerAvatarClick} aria-label="View criteria status"
          data-tooltip="View criteria status">
          <ParticipantAvatar
            key={`${viewerAddress}:${walletPhotoUpdatedAt ?? ""}`}
            address={viewerAddress}
            title={viewerStatus === "verified" ? participantNames[viewerAddress] || "Verified participant" : viewerStatus === "pending" ? "Your criteria are not yet fulfilled" : "Checking your criteria"}
            photoVersion={walletPhotoUpdatedAt}
            status={viewerStatus}
          />
        </button>
      ) : null}
    </div>
  );
}
