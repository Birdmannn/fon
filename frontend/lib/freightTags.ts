import { normalizeGiftHandle, parseGiftDirectiveSections, type GiftTaggedUser } from "./giftDeliverables.ts";

export type TagDisplayProfile = { displayName: string; address: string | null };
export type FreightTag = GiftTaggedUser & { displayName: string };
export type FreightTagGroup = { role: "approve" | "claim" | "receive" | "other"; users: FreightTag[] };

export function stripFreightUserTags(text: string) {
  // User tags are rendered once in the role rows; leave email addresses intact.
  return text.replace(/(^|\s)@[a-zA-Z0-9_.]+/g, "$1");
}

export function buildFreightTagGroups(args: {
  description?: string;
  mentions?: string[];
  approvers?: GiftTaggedUser[];
  claimants?: GiftTaggedUser[];
  receivers?: GiftTaggedUser[];
  profiles?: Record<string, TagDisplayProfile | null>;
}): FreightTagGroup[] {
  const parsed = parseGiftDirectiveSections(args.description ?? "");
  const tagged = (handles: string[]) => handles.map((handle) => ({ handle }));
  const roles: { role: FreightTagGroup["role"]; users: GiftTaggedUser[] }[] = [
    { role: "approve", users: [...(args.approvers ?? []), ...tagged(parsed.approvers)] },
    { role: "claim", users: [...(args.claimants ?? []), ...tagged(parsed.claimants)] },
    { role: "receive", users: [...(args.receivers ?? []), ...tagged(parsed.receivers)] },
    { role: "other", users: tagged([...parsed.plainMentions, ...(args.mentions ?? [])]) },
  ];
  const handles = new Set<string>();
  const addresses = new Set<string>();
  return roles.map(({ role, users }) => ({
    role,
    users: users.flatMap((user) => {
      const handle = normalizeGiftHandle(user.handle);
      if (!handle || ["approve", "claim", "receive"].includes(handle) || handles.has(handle)) return [];
      const profile = args.profiles?.[handle];
      const address = (profile?.address || user.address)?.trim().toLowerCase();
      handles.add(handle);
      if (address && addresses.has(address)) return [];
      if (address) addresses.add(address);
      return [{ handle, address, displayName: profile?.displayName?.trim() || (profile === undefined ? "Loading…" : "Unknown user") }];
    }),
  })).filter((group) => group.users.length > 0);
}

/** Reserve the overflow box while fitting complete name boxes into one line. */
export function fitFreightTagRow(widths: number[], available: number, gap: number, overflowWidths: number[]): number {
  if (!widths.length || available <= 0) return 0;
  if (widths.length === 1) return 1; // A single long name can use an ellipsis.
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  if (total <= available) return widths.length;
  let occupied = 0;
  let visible = 0;
  for (let count = 1; count < widths.length; count += 1) {
    occupied += widths[count - 1];
    const remaining = widths.length - count;
    if (occupied + gap * count + overflowWidths[remaining] <= available) visible = count;
  }
  return visible;
}
