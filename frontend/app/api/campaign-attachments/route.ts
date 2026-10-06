import { Binary } from "mongodb";
import { NextResponse } from "next/server";

import { getCampaignAttachmentsCollection, getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FBARS_PER_PHOTO = 20;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("photo");
    const creatorAddress = typeof form.get("creatorAddress") === "string" ? String(form.get("creatorAddress")).trim().toLowerCase() : "";
    const groupId = typeof form.get("groupId") === "string" ? String(form.get("groupId")).trim() : "";
    if (!(file instanceof File) || !creatorAddress || !groupId) return fail("Photo, creatorAddress, and groupId are required");
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return fail("Choose a JPEG, PNG, WebP, or GIF image");
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) return fail("Each photo must be 5 MB or smaller", 413);

    const profiles = await getUserProfilesCollection();
    const profile = await profiles.findOne({ address: creatorAddress }, { projection: { _id: 0, fbars: 1 } });
    const fbars = typeof profile?.fbars === "number" ? profile.fbars : Number(profile?.fbars ?? 0);
    const allowance = Math.max(0, Math.floor(fbars / FBARS_PER_PHOTO));
    const attachments = await getCampaignAttachmentsCollection();
    const currentCount = await attachments.countDocuments({ creatorAddress, groupId });
    if (currentCount >= allowance) return fail(`Your ${Math.trunc(fbars || 0)} FBARS allow ${allowance} photo${allowance === 1 ? "" : "s"}`, 403);

    const inserted = await attachments.insertOne({
      data: new Binary(Buffer.from(await file.arrayBuffer())),
      contentType: file.type,
      name: file.name.slice(0, 180),
      creatorAddress,
      groupId,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ attachment: { id: inserted.insertedId.toString(), name: file.name.slice(0, 180), contentType: file.type } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to upload photo", 500);
  }
}
