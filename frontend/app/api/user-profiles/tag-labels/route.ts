import { NextResponse } from "next/server";
import { getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").replace(/\.ckb$/i, "").toLowerCase();
}

export async function GET(request: Request) {
  try {
    const handles = [...new Set((new URL(request.url).searchParams.get("handles") ?? "").split(",").map(normalizeUsername).filter(Boolean))];
    if (handles.length > 100) return NextResponse.json({ error: "Request up to 100 tags at once" }, { status: 400 });
    if (!handles.length) return NextResponse.json({ profiles: {} });
    const names = handles.map((handle) => new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.ckb)?$`, "i"));
    const collection = await getUserProfilesCollection();
    const profiles = await collection.find({ username: { $in: names } }, {
      projection: { _id: 0, username: 1, displayName: 1, address: 1 },
      sort: { updatedAt: -1 },
    }).toArray();
    const labels: Record<string, { displayName: string; address: string | null }> = {};
    for (const profile of profiles) {
      if (typeof profile.username !== "string") continue;
      const handle = normalizeUsername(profile.username);
      if (labels[handle]) continue;
      labels[handle] = {
        displayName: typeof profile.displayName === "string" && profile.displayName.trim() ? profile.displayName.trim() : "Unnamed user",
        address: typeof profile.address === "string" ? profile.address.trim().toLowerCase() : null,
      };
    }
    return NextResponse.json({ profiles: labels });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load tag names" }, { status: 500 });
  }
}
