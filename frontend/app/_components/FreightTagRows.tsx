"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTagDisplayNames } from "@/app/_hooks/useTagDisplayNames";
import { buildFreightTagGroups, fitFreightTagRow, type FreightTag, type FreightTagGroup } from "@/lib/freightTags";
import type { GiftTaggedUser } from "@/lib/giftDeliverables";

const ROLE_LABELS = { approve: "Approvers", claim: "Claimants", receive: "Receivers", other: "Other tagged users" };

function TagRow({ role, users }: FreightTagGroup) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(users.length);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measurement = measureRef.current;
    if (!row || !measurement) return;
    const measure = () => {
      if (!row.isConnected) return;
      const widths = Array.from(measurement.querySelectorAll<HTMLElement>("[data-name]")).map((chip) => chip.getBoundingClientRect().width);
      const overflow = Array.from(measurement.querySelectorAll<HTMLElement>("[data-overflow]")).map((chip) => chip.getBoundingClientRect().width);
      const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
      setVisibleCount(fitFreightTagRow(widths, row.clientWidth, gap, [0, ...overflow]));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    measure();
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [users]);
  const hidden = users.slice(visibleCount);
  const chip = (user: FreightTag) => <span key={user.handle} className="campaign-tag-chip" title={`@${user.displayName}`}>@{user.displayName}</span>;
  return (
    <div className={`campaign-tag-line campaign-tag-line-${role}`} ref={rowRef} role="group" aria-label={ROLE_LABELS[role]}>
      {users.slice(0, visibleCount).map(chip)}
      {hidden.length ? <span className="campaign-tag-chip campaign-tag-chip-overflow" title={hidden.map((user) => `@${user.displayName}`).join(", ")} aria-label={`${hidden.length} more ${ROLE_LABELS[role].toLowerCase()}: ${hidden.map((user) => `@${user.displayName}`).join(", ")}`}>+{hidden.length}</span> : null}
      <div className="campaign-tag-measure" ref={measureRef} aria-hidden="true">
        {users.map((user) => <span key={user.handle} className="campaign-tag-chip" data-name>@{user.displayName}</span>)}
        {users.map((_, index) => <span key={index} className="campaign-tag-chip campaign-tag-chip-overflow" data-overflow>+{index + 1}</span>)}
      </div>
    </div>
  );
}

export default function FreightTagRows({ description, mentions, approvers, claimants, receivers }: {
  description?: string;
  mentions?: string[];
  approvers?: GiftTaggedUser[];
  claimants?: GiftTaggedUser[];
  receivers?: GiftTaggedUser[];
}) {
  const unresolvedGroups = useMemo(() => buildFreightTagGroups({ description, mentions, approvers, claimants, receivers }), [description, mentions, approvers, claimants, receivers]);
  const profiles = useTagDisplayNames(unresolvedGroups.flatMap((group) => group.users.map((user) => user.handle)));
  const groups = useMemo(() => buildFreightTagGroups({ description, mentions, approvers, claimants, receivers, profiles }), [description, mentions, approvers, claimants, receivers, profiles]);
  if (!groups.length) return null;
  return <div className="campaign-tag-rows">{groups.map((group) => <TagRow key={group.role} {...group} />)}</div>;
}
