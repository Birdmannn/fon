export type ChildFreightMountableConfig = {
  enabled: boolean;
  title: string;
};

export const DEFAULT_CHILD_FREIGHT_MOUNTABLE_CONFIG: ChildFreightMountableConfig = {
  enabled: false,
  title: "",
};

export function normalizeChildFreightMountableConfig(value: unknown): ChildFreightMountableConfig {
  if (!value || typeof value !== "object") return DEFAULT_CHILD_FREIGHT_MOUNTABLE_CONFIG;
  const config = value as { enabled?: unknown; title?: unknown };
  return {
    enabled: config.enabled === true,
    title: typeof config.title === "string" ? config.title.trim().slice(0, 30) : "",
  };
}

export function parseChildFreightMountableConfig(value: unknown): ChildFreightMountableConfig | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("mountables.childFreight must be an object");
  const config = value as { enabled?: unknown; title?: unknown };
  if (typeof config.enabled !== "boolean") throw new Error("mountables.childFreight.enabled must be a boolean");
  if (config.title !== undefined && typeof config.title !== "string") throw new Error("mountables.childFreight.title must be a string");
  if (typeof config.title === "string" && config.title.trim().length > 30) throw new Error("mountables.childFreight.title must be 30 characters or fewer");
  return normalizeChildFreightMountableConfig(config);
}

export function childFreightMountableSummary(value: unknown): string {
  const config = normalizeChildFreightMountableConfig(value);
  return config.title
    ? `Create a direct child freight titled "${config.title}" to complete participation.`
    : "Create a direct child freight to complete participation.";
}

export function hasParticipantCreatedChildFreight(
  participantAddress: string,
  config: ChildFreightMountableConfig,
  children: Array<Record<string, unknown>>,
): boolean {
  if (!config.enabled) return true;
  const address = participantAddress.trim().toLowerCase();
  const requiredTitle = config.title.trim().toLocaleLowerCase();
  return Boolean(address) && children.some((child) =>
    typeof child.creatorAddress === "string"
    && child.creatorAddress.trim().toLowerCase() === address
    && (!requiredTitle || (typeof child.title === "string" && child.title.trim().toLocaleLowerCase() === requiredTitle)));
}
