import { canAccessLockMountable, isLockMountableEnabled, lockMountableAccessMessage } from "./lockMountable.ts";
import { isFormsMountableEnabled } from "./formsMountable.ts";
import { childFreightMountableSummary } from "./childFreightMountable.ts";
import { formatMountableAppPrincipleSelection, normalizeMountableUrl } from "../../lib/fonMountablesSdk.ts";
import type { CampaignRecord } from "../_types/campaignRecords";

export type ParticipantCriterionRow = {
  participantKind?: unknown;
  mountableType?: unknown;
  mountableInstanceId?: unknown;
  status?: unknown;
  childSatisfied?: unknown;
  criteriaState?: unknown;
};

export type MountableCriterionStatus = {
  key: string;
  mountable: string;
  principle: string;
  description: string;
  cleared: boolean;
  href?: string;
  icon: "app" | "child-freight" | "forms" | "lock" | "signable";
  logoUrl?: string;
};

export function hasRaffleTicketParticipation(rows: ParticipantCriterionRow[]): boolean {
  return rows.some((row) => row.status === "verified" && (
    row.participantKind === "raffle_ticket"
    || ((row.participantKind === null || row.participantKind === undefined)
      && (row.mountableType === null || row.mountableType === undefined))
  ));
}

export function getMountableCriteriaStatus({
  record,
  rows,
  viewerFbars,
  creatorFbars,
  signableCleared,
  childFreightSatisfied,
}: {
  record: CampaignRecord;
  rows: ParticipantCriterionRow[];
  viewerFbars?: number | null;
  creatorFbars?: number | null;
  signableCleared: boolean;
  childFreightSatisfied?: boolean;
}): MountableCriterionStatus[] {
  const criteria: MountableCriterionStatus[] = [];
  if (record.mountables?.childFreight?.enabled) {
    criteria.push({
      key: "child-freight",
      mountable: "Child Freight",
      principle: "Create a child freight",
      description: childFreightMountableSummary(record.mountables.childFreight),
      cleared: childFreightSatisfied === true,
      icon: "child-freight",
    });
  }
  const lock = record.mountables?.lock;
  if (isLockMountableEnabled(lock)) {
    criteria.push({
      key: "lock",
      mountable: "Lock",
      principle: "FBARS",
      description: lockMountableAccessMessage(lock, creatorFbars),
      cleared: canAccessLockMountable(lock, viewerFbars, creatorFbars),
      icon: "lock",
    });
  }

  const forms = record.mountables?.forms;
  if (isFormsMountableEnabled(forms)) {
    criteria.push({
      key: "forms",
      mountable: "Forms",
      principle: "Verified form response",
      description: forms?.proofInstructions?.trim() || "Submit and verify the mounted Google Form.",
      cleared: rows.some((row) => row.participantKind === "forms_claim" && row.status === "verified"),
      href: normalizeMountableUrl(forms?.canonicalFormUrl || forms?.formUrl),
      icon: "forms",
    });
  }

  if ((record.giftDeliverable?.approvers.length ?? 0) > 0) {
    criteria.push({
      key: "signable",
      mountable: "Signable",
      principle: "Required approvals",
      description: "Tagged signers approve this freight before delivery.",
      cleared: signableCleared,
      icon: "signable",
    });
  }

  for (const app of record.mountables?.apps ?? []) {
    if (!app.enabled || !app.mountableInstanceId) continue;
    const row = rows.find((entry) => entry.mountableType === "app" && entry.mountableInstanceId === app.mountableInstanceId);
    const mountable = app.appName || app.appId || "Mounted app";
    const href = normalizeMountableUrl(app.appUrl);
    const logoUrl = app.logoUrl || app.iconUrl;
    const states = Array.isArray(row?.criteriaState) ? row.criteriaState : [];
    if (app.selectedPrinciples.length === 0 && row?.childSatisfied === true) {
      criteria.push({
        key: app.mountableInstanceId,
        mountable,
        principle: "App verification",
        description: "The mounted app has verified this participant.",
        cleared: true,
        href,
        icon: "app",
        logoUrl,
      });
    } else if (app.selectedPrinciples.length === 0) {
      criteria.push({
        key: app.mountableInstanceId,
        mountable,
        principle: "App verification",
        description: "The mounted app verifies this participant.",
        cleared: false,
        href,
        icon: "app",
        logoUrl,
      });
    }
    for (const principle of app.selectedPrinciples) {
      const fulfilled = states.some((value) => {
        if (!value || typeof value !== "object") return false;
        const state = value as { principleId?: unknown; fulfilled?: unknown };
        return state.principleId === principle.principleId && state.fulfilled === true;
      });
      criteria.push({
        key: `${app.mountableInstanceId}:${principle.principleId}`,
        mountable,
        principle: principle.title || principle.principleId,
        description: principle.readableFormat
          ? formatMountableAppPrincipleSelection(principle, principle.params)
          : principle.displayLabel || principle.description || principle.title || principle.principleId,
        cleared: fulfilled,
        href,
        icon: "app",
        logoUrl,
      });
    }
  }

  return criteria.sort((left, right) => left.mountable.localeCompare(right.mountable, undefined, { sensitivity: "base" }) || left.key.localeCompare(right.key));
}
