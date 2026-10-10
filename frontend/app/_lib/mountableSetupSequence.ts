export type MountableSetupStep = {
  key: string;
  label: string;
  mode: "mountables-child-freight" | "mountables-forms" | "mountables-lock" | "mountables-apps" | "mountables-approval";
  appId?: string;
};

/** Implicit approval is configured after every explicitly selected mountable. */
export function buildMountableSetupSequence(selected: MountableSetupStep[], approvalSelected: boolean): MountableSetupStep[] {
  return [
    ...selected.toSorted((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })),
    ...(approvalSelected ? [{ key: "approval", label: "Approval", mode: "mountables-approval" as const }] : []),
  ];
}
